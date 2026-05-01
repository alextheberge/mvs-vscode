import * as path from "path";
import * as vscode from "vscode";

export type ManifestIdentityState =
  | { kind: "no_workspace" }
  | { kind: "missing"; manifestAbs: string; manifestUri: vscode.Uri }
  | { kind: "invalid"; manifestAbs: string; manifestUri: vscode.Uri; reason: string }
  | { kind: "ok"; manifestAbs: string; manifestUri: vscode.Uri; identity: string };

export function manifestAbsPathForStatus(
  wf: vscode.WorkspaceFolder,
  rootRel: string,
  manifestRel: string
): string {
  return path.normalize(path.join(wf.uri.fsPath, rootRel, manifestRel));
}

export async function readManifestIdentityState(
  wf: vscode.WorkspaceFolder | undefined,
  rootRel: string,
  manifestRel: string
): Promise<ManifestIdentityState> {
  if (!wf) {
    return { kind: "no_workspace" };
  }
  const manifestAbs = manifestAbsPathForStatus(wf, rootRel, manifestRel);
  const manifestUri = vscode.Uri.file(manifestAbs);
  try {
    await vscode.workspace.fs.stat(manifestUri);
  } catch {
    return { kind: "missing", manifestAbs, manifestUri };
  }
  try {
    const bytes = await vscode.workspace.fs.readFile(manifestUri);
    const raw = Buffer.from(bytes).toString("utf8");
    const parsed = JSON.parse(raw) as { identity?: { mvs?: string } };
    const identity = (parsed.identity?.mvs ?? "").trim();
    return {
      kind: "ok",
      manifestAbs,
      manifestUri,
      identity: identity.length > 0 ? identity : "(empty identity.mvs)",
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { kind: "invalid", manifestAbs, manifestUri, reason };
  }
}

/** Glob relative to workspace folder for createFileSystemWatcher. */
function globForManifestUnderRoot(rootRel: string, manifestRel: string): string {
  const norm = (s: string) => s.replace(/\\/g, "/");
  const root = norm(rootRel);
  const man = norm(manifestRel);
  if (root === "" || root === ".") {
    return man;
  }
  return path.posix.join(root, man);
}

export class MvsStatusBarController implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private fileWatcherGroup: vscode.Disposable | undefined;

  constructor(
    private readonly getWorkspaceFolder: () => vscode.WorkspaceFolder | undefined,
    private readonly readConfig: (wf: vscode.WorkspaceFolder) => { root: string; manifest: string }
  ) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.name = "MVS manifest";
    this.item.command = "mvs.statusBarClick";
    this.item.tooltip = "MVS: manifest identity (click for actions)";
    this.disposables.push(this.item);

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("mvsManager")) {
          this.attachFileWatcher();
          this.scheduleRefresh();
        }
      })
    );
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.attachFileWatcher();
        this.scheduleRefresh();
      })
    );
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        const wf = this.getWorkspaceFolder();
        if (!wf) {
          return;
        }
        const c = this.readConfig(wf);
        const abs = manifestAbsPathForStatus(wf, c.root, c.manifest);
        if (path.normalize(doc.uri.fsPath) === abs) {
          this.scheduleRefresh();
        }
      })
    );

    this.attachFileWatcher();
    this.scheduleRefresh();
  }

  private attachFileWatcher(): void {
    this.fileWatcherGroup?.dispose();
    this.fileWatcherGroup = undefined;
    const wf = this.getWorkspaceFolder();
    if (!wf) {
      return;
    }
    const c = this.readConfig(wf);
    const pattern = new vscode.RelativePattern(wf, globForManifestUnderRoot(c.root, c.manifest));
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.fileWatcherGroup = vscode.Disposable.from(
      watcher,
      watcher.onDidChange(() => this.scheduleRefresh()),
      watcher.onDidCreate(() => this.scheduleRefresh()),
      watcher.onDidDelete(() => this.scheduleRefresh())
    );
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh();
    }, 150);
  }

  async refresh(): Promise<void> {
    const wf = this.getWorkspaceFolder();
    if (!wf) {
      this.item.text = "$(package) MVS";
      this.item.tooltip = "MVS: open a folder workspace to show manifest identity.";
      this.item.backgroundColor = undefined;
      this.item.show();
      return;
    }
    const c = this.readConfig(wf);
    const state = await readManifestIdentityState(wf, c.root, c.manifest);
    switch (state.kind) {
      case "no_workspace":
        this.item.text = "$(package) MVS";
        this.item.tooltip = "MVS: no workspace folder.";
        this.item.backgroundColor = undefined;
        break;
      case "missing":
        this.item.text = "$(package) MVS —";
        this.item.tooltip = new vscode.MarkdownString(
          `**No MVS manifest**\n\n\`${state.manifestAbs}\`\n\nClick to add MVS to this repo.`,
          true
        );
        this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
        break;
      case "invalid":
        this.item.text = "$(error) MVS";
        this.item.tooltip = new vscode.MarkdownString(
          `**Invalid manifest JSON**\n\n\`${state.manifestAbs}\`\n\n${state.reason}\n\nClick for actions.`,
          true
        );
        this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
        break;
      case "ok": {
        const short =
          state.identity.length > 28 ? `${state.identity.slice(0, 25)}…` : state.identity;
        this.item.text = `$(package) ${short}`;
        this.item.tooltip = new vscode.MarkdownString(
          `**MVS** \`${state.identity}\`\n\n\`${state.manifestAbs}\`\n\nClick for actions.`,
          true
        );
        this.item.backgroundColor = undefined;
        break;
      }
    }
    this.item.show();
  }

  dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.fileWatcherGroup?.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.item.dispose();
  }
}
