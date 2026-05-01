// @mvs-feature:vscode_extension_surface
// @mvs-protocol:mvs_cli_json_reports_v1
import * as path from "path";
import * as vscode from "vscode";
import { diagnosticsFromLintReport } from "./lintDiagnostics";
import { parseLintReportJson } from "./lintModel";
import { resolveExecutable, runMvsManager } from "./mvsRunner";

const COLLECTION = vscode.languages.createDiagnosticCollection("mvs");
let output: vscode.OutputChannel;
let saveLintTimer: ReturnType<typeof setTimeout> | undefined;

function getWorkspaceFolder(
  wf?: vscode.WorkspaceFolder
): vscode.WorkspaceFolder | undefined {
  if (wf) {
    return wf;
  }
  return vscode.workspace.workspaceFolders?.[0];
}

function readConfig(wf: vscode.WorkspaceFolder) {
  const cfg = vscode.workspace.getConfiguration("mvsManager", wf.uri);
  return {
    executablePath: cfg.get<string>("executablePath", "") ?? "",
    root: cfg.get<string>("root", ".") ?? ".",
    manifest: cfg.get<string>("manifest", "mvs.json") ?? "mvs.json",
    context: cfg.get<string>("context", "cli") ?? "cli",
    aiSchema: cfg.get<string>("aiSchema", "") ?? "",
    runLintOnSave: cfg.get<boolean>("runLintOnSave", false) ?? false,
  };
}

function rootAbsPath(wf: vscode.WorkspaceFolder, rootRel: string): string {
  return path.normalize(path.join(wf.uri.fsPath, rootRel));
}

/** Absolute manifest path: workspace + root + manifest (matches CLI resolution). */
function manifestAbsPath(wf: vscode.WorkspaceFolder, rootRel: string, manifestRel: string): string {
  return path.normalize(path.join(rootAbsPath(wf, rootRel), manifestRel));
}

function log(msg: string) {
  output.appendLine(msg);
}

async function logWorkspaceMvsIdentityIfPresent(wf: vscode.WorkspaceFolder): Promise<void> {
  const c = readConfig(wf);
  const manifestAbs = manifestAbsPath(wf, c.root, c.manifest);
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(manifestAbs));
    const raw = Buffer.from(bytes).toString("utf8");
    const parsed = JSON.parse(raw) as { identity?: { mvs?: string } };
    const id = parsed.identity?.mvs;
    if (id) {
      log(`Workspace manifest MVS identity: ${id}`);
    }
  } catch {
    /* no manifest or unreadable */
  }
}

async function runLint(
  wf: vscode.WorkspaceFolder,
  token?: vscode.CancellationToken
): Promise<void> {
  const c = readConfig(wf);
  const exe = resolveExecutable(c.executablePath, wf.uri.fsPath);
  const rootAbs = rootAbsPath(wf, c.root);
  const manifestAbs = manifestAbsPath(wf, c.root, c.manifest);
  const args = [
    "lint",
    "--root",
    rootAbs,
    "--manifest",
    manifestAbs,
    "--format",
    "json",
  ];
  if (c.aiSchema.trim()) {
    args.push("--ai-schema", path.join(wf.uri.fsPath, c.aiSchema));
  }
  log(`$ ${exe} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`);
  const { stdout, stderr, code } = await runMvsManager(exe, args, wf.uri.fsPath, token);
  if (stderr.trim()) {
    log(stderr.trim());
  }
  const parsed = parseLintReportJson(stdout);
  if (!parsed.ok) {
    vscode.window.showErrorMessage(`MVS: ${parsed.error}`);
    COLLECTION.clear();
    return;
  }
  COLLECTION.clear();
  const pairs = diagnosticsFromLintReport(wf, c.root, c.manifest, parsed.report);
  for (const [uri, diags] of pairs) {
    COLLECTION.set(uri, diags);
  }
  if (code !== 0 && code !== null) {
    vscode.window.showWarningMessage(
      `MVS lint finished with exit code ${code}. See Problems panel.`
    );
  }
}

async function runGenerate(wf: vscode.WorkspaceFolder): Promise<void> {
  const pick = await vscode.window.showWarningMessage(
    "Regenerate mvs.json from the codebase?",
    { modal: true },
    "Run generate"
  );
  if (pick !== "Run generate") {
    return;
  }
  const c = readConfig(wf);
  const exe = resolveExecutable(c.executablePath, wf.uri.fsPath);
  const rootAbs = rootAbsPath(wf, c.root);
  const manifestAbs = manifestAbsPath(wf, c.root, c.manifest);
  const args = [
    "generate",
    "--root",
    rootAbs,
    "--manifest",
    manifestAbs,
    "--context",
    c.context,
  ];
  if (c.aiSchema.trim()) {
    args.push("--ai-schema", path.join(wf.uri.fsPath, c.aiSchema));
  }
  log(`$ ${exe} ${args.join(" ")}`);
  const { stdout, stderr, code } = await runMvsManager(exe, args, wf.uri.fsPath);
  if (stdout.trim()) {
    log(stdout.trim());
  }
  if (stderr.trim()) {
    log(stderr.trim());
  }
  if (code !== 0) {
    vscode.window.showErrorMessage(`MVS generate failed (exit ${code}). See MVS output.`);
  } else {
    vscode.window.showInformationMessage("MVS generate completed.");
    await runLint(wf);
  }
}

async function runReport(wf: vscode.WorkspaceFolder): Promise<void> {
  const c = readConfig(wf);
  const exe = resolveExecutable(c.executablePath, wf.uri.fsPath);
  const manifestAbs = manifestAbsPath(wf, c.root, c.manifest);
  const args = [
    "report",
    "--base-manifest",
    manifestAbs,
    "--target-manifest",
    manifestAbs,
    "--format",
    "json",
  ];
  log(`$ ${exe} ${args.join(" ")}`);
  const { stdout, stderr, code } = await runMvsManager(exe, args, wf.uri.fsPath);
  if (stderr.trim()) {
    log(stderr.trim());
  }
  const doc = await vscode.workspace.openTextDocument({
    content: stdout || "(empty stdout)",
    language: "json",
  });
  await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: false });
  if (code !== 0) {
    vscode.window.showWarningMessage(`MVS report exited with code ${code}`);
  }
}

async function runDoctor(wf: vscode.WorkspaceFolder): Promise<void> {
  const c = readConfig(wf);
  const exe = resolveExecutable(c.executablePath, wf.uri.fsPath);
  const rootAbs = rootAbsPath(wf, c.root);
  const args = [
    "doctor",
    "--format",
    "json",
    "--root",
    rootAbs,
    "--manifest",
    c.manifest,
  ];
  log(`$ ${exe} ${args.join(" ")}`);
  const { stdout, stderr, code } = await runMvsManager(exe, args, wf.uri.fsPath);
  output.show(true);
  if (stdout.trim()) {
    log(stdout.trim());
  }
  if (stderr.trim()) {
    log(stderr.trim());
  }
  if (code !== 0) {
    vscode.window.showWarningMessage(`MVS doctor exited with code ${code}`);
  }
}

export function activate(context: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel("MVS");
  context.subscriptions.push(output, COLLECTION);

  const withFolder = async (
    fn: (wf: vscode.WorkspaceFolder) => Promise<void>
  ): Promise<void> => {
    const wf = getWorkspaceFolder();
    if (!wf) {
      vscode.window.showErrorMessage("MVS: open a folder workspace first.");
      return;
    }
    await fn(wf);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("mvs.lint", () =>
      withFolder(async (wf) => {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "MVS lint",
            cancellable: true,
          },
          async (_progress, token) => {
            await runLint(wf, token);
          }
        );
      })
    ),
    vscode.commands.registerCommand("mvs.generate", () => withFolder((wf) => runGenerate(wf))),
    vscode.commands.registerCommand("mvs.report", () => withFolder((wf) => runReport(wf))),
    vscode.commands.registerCommand("mvs.doctor", () => withFolder((wf) => runDoctor(wf))),
    vscode.commands.registerCommand("mvs.clearDiagnostics", () => {
      COLLECTION.clear();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      const wf = vscode.workspace.getWorkspaceFolder(doc.uri);
      if (!wf) {
        return;
      }
      const c = readConfig(wf);
      if (!c.runLintOnSave) {
        return;
      }
      const manifestAbs = manifestAbsPath(wf, c.root, c.manifest);
      if (path.normalize(doc.uri.fsPath) !== manifestAbs) {
        return;
      }
      if (saveLintTimer) {
        clearTimeout(saveLintTimer);
      }
      saveLintTimer = setTimeout(() => {
        saveLintTimer = undefined;
        void runLint(wf);
      }, 800);
    })
  );

  const extVer =
    (context.extension.packageJSON as { version?: string } | undefined)?.version ?? "?";
  log(`MVS extension activated (package ${extVer}).`);
  const wf0 = vscode.workspace.workspaceFolders?.[0];
  if (wf0) {
    void logWorkspaceMvsIdentityIfPresent(wf0);
  }
}

export function deactivate() {
  if (saveLintTimer) {
    clearTimeout(saveLintTimer);
  }
}
