// @mvs-feature:vscode_extension_surface
// @mvs-protocol:mvs_cli_json_reports_v1
import * as path from "path";
import * as vscode from "vscode";
import {
  formatUnknownError,
  remediesForLintJsonParse,
  remediesForProcessSpawnError,
  reportCommandFailure,
} from "./commandErrors";
import { MIN_MVS_MANAGER_VERSION } from "./extensionMetadata";
import { checkAndApplyExtensionUpdate, scheduleExtensionAutoUpdate } from "./extensionUpdate";
import { diagnosticsFromLintReport } from "./lintDiagnostics";
import { parseLintReportJson } from "./lintModel";
import { resolveExecutable, runMvsManager } from "./mvsRunner";

const COLLECTION = vscode.languages.createDiagnosticCollection("mvs");
let output: vscode.OutputChannel;
let saveLintTimer: ReturnType<typeof setTimeout> | undefined;

function revealMvsOutput(): void {
  output.show(true);
}

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
    let parsed: { identity?: { mvs?: string } };
    try {
      parsed = JSON.parse(raw) as { identity?: { mvs?: string } };
    } catch (e) {
      const { message } = formatUnknownError(e);
      log(`Workspace manifest at ${manifestAbs} is not valid JSON: ${message}`);
      log("Fix: repair the file or run **MVS: Generate / update manifest** after backing up.");
      return;
    }
    const id = parsed.identity?.mvs;
    if (id) {
      log(`Workspace manifest MVS identity: ${id}`);
    }
  } catch (e) {
    const { message } = formatUnknownError(e);
    log(`Could not read workspace manifest at ${manifestAbs}: ${message}`);
    log("Fix: check **MVS Manager: Root** and **Manifest** settings, or create `mvs.json` under the configured root.");
  }
}

async function runLint(
  wf: vscode.WorkspaceFolder,
  token: vscode.CancellationToken | undefined,
  meta: { commandLabel: string }
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

  let stdout: string;
  let stderr: string;
  let code: number | null;
  try {
    const result = await runMvsManager(exe, args, wf.uri.fsPath, token);
    stdout = result.stdout;
    stderr = result.stderr;
    code = result.code;
  } catch (e) {
    reportCommandFailure(log, revealMvsOutput, {
      command: meta.commandLabel,
      summary: `Could not start mvs-manager (${exe}).`,
      cause: e,
      remedies: remediesForProcessSpawnError(exe, e),
      extraLogLines: [
        `Resolved executable: ${exe}`,
        `Working directory: ${wf.uri.fsPath}`,
        `Arguments: ${args.join(" ")}`,
      ],
    });
    COLLECTION.clear();
    return;
  }

  if (token?.isCancellationRequested) {
    log(`${meta.commandLabel}: cancelled before processing results.`);
    COLLECTION.clear();
    return;
  }

  if (stderr.trim()) {
    log(stderr.trim());
  }

  const parsed = parseLintReportJson(stdout);
  if (!parsed.ok) {
    reportCommandFailure(log, revealMvsOutput, {
      command: meta.commandLabel,
      summary: `MVS lint could not parse CLI output (${parsed.error}).`,
      cause: new Error(parsed.error),
      remedies: remediesForLintJsonParse(stdout.slice(0, 400)),
      extraLogLines: [
        `stdout length: ${stdout.length} characters`,
        `stdout (first 4000 chars):\n${stdout.slice(0, 4000)}`,
        ...(stderr.trim() ? [`stderr:\n${stderr.slice(0, 2000)}`] : []),
        `If mvs-manager printed help text, your build may not support \`lint --format json\`.`,
      ],
    });
    COLLECTION.clear();
    return;
  }

  let pairs: [vscode.Uri, vscode.Diagnostic[]][];
  try {
    pairs = diagnosticsFromLintReport(wf, c.root, c.manifest, parsed.report);
  } catch (e) {
    reportCommandFailure(log, revealMvsOutput, {
      command: meta.commandLabel,
      summary: "MVS: failed while mapping lint JSON to editor diagnostics.",
      cause: e,
      remedies: [
        "This is likely an extension bug or an unexpected lint JSON shape.",
        "Save the stdout from the MVS output channel and report it with your mvs-manager version.",
      ],
      extraLogLines: [`exit_code from report: ${parsed.report.exit_code}`, `status: ${parsed.report.status}`],
    });
    COLLECTION.clear();
    return;
  }

  try {
    COLLECTION.clear();
    for (const [uri, diags] of pairs) {
      COLLECTION.set(uri, diags);
    }
  } catch (e) {
    reportCommandFailure(log, revealMvsOutput, {
      command: meta.commandLabel,
      summary: "MVS: failed while publishing diagnostics to the Problems panel.",
      cause: e,
      remedies: ["Reload the window.", "If a URI in the lint report is invalid for this workspace, report it with a log snippet."],
    });
    COLLECTION.clear();
    return;
  }

  if (code === null) {
    if (token?.isCancellationRequested) {
      log(`${meta.commandLabel}: process ended with no exit code after cancellation.`);
      return;
    }
    reportCommandFailure(log, revealMvsOutput, {
      command: meta.commandLabel,
      summary: "mvs-manager exited without an exit code (process may have been killed).",
      cause: new Error("exit code was null"),
      remedies: [
        "If you cancelled the run, this is expected.",
        "Otherwise check for OOM or OS signals; re-run lint from the command palette.",
      ],
      extraLogLines: [`stderr (tail):\n${stderr.slice(-1500)}`],
    });
    return;
  }

  if (code !== 0) {
    const fc = parsed.report.failure_count ?? 0;
    const failures = parsed.report.failures?.length
      ? parsed.report.failures.slice(0, 12).join("\n")
      : "(no failure strings in report)";
    log(`${meta.commandLabel}: mvs-manager exit ${code}, failure_count=${fc}`);
    log(`Lint failures (truncated):\n${failures}`);
    void vscode.window.showWarningMessage(
      `MVS lint finished with exit code ${code} (${fc} failure(s)). See Problems and the MVS output channel.`,
      { modal: false, detail: `First failures:\n${failures.slice(0, 1200)}` },
      "Open MVS output"
    ).then((sel) => {
      if (sel === "Open MVS output") {
        revealMvsOutput();
      }
    });
  }
}

async function runGenerate(wf: vscode.WorkspaceFolder): Promise<void> {
  const commandLabel = "MVS: Generate / update manifest";
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

  let stdout: string;
  let stderr: string;
  let code: number | null;
  try {
    const result = await runMvsManager(exe, args, wf.uri.fsPath);
    stdout = result.stdout;
    stderr = result.stderr;
    code = result.code;
  } catch (e) {
    reportCommandFailure(log, revealMvsOutput, {
      command: commandLabel,
      summary: `Could not start mvs-manager (${exe}) for generate.`,
      cause: e,
      remedies: remediesForProcessSpawnError(exe, e),
      extraLogLines: [`Resolved executable: ${exe}`, `cwd: ${wf.uri.fsPath}`],
    });
    return;
  }

  if (stdout.trim()) {
    log(stdout.trim());
  }
  if (stderr.trim()) {
    log(stderr.trim());
  }

  if (code === null) {
    reportCommandFailure(log, revealMvsOutput, {
      command: commandLabel,
      summary: "MVS generate exited without an exit code.",
      cause: new Error("exit code was null"),
      remedies: [
        "The CLI process may have been killed (signal). See stderr in the MVS output channel.",
        "Re-run the same command in a terminal to reproduce outside the editor.",
      ],
      extraLogLines: [`stderr:\n${stderr.slice(0, 3000)}`],
    });
    return;
  }

  if (code !== 0) {
    reportCommandFailure(log, revealMvsOutput, {
      command: commandLabel,
      summary: `MVS generate failed with exit code ${code}.`,
      cause: new Error(stderr.trim() || stdout.trim() || `Process exited with code ${code}`),
      remedies: [
        "Read the MVS output channel for CLI stderr/stdout.",
        "Run the same `mvs-manager generate` line in a terminal from the workspace folder.",
        "Confirm `--root` and `--manifest` paths exist and `mvs-manager` is a recent MVSengine build.",
      ],
      extraLogLines: [
        `manifest path: ${manifestAbs}`,
        `root: ${rootAbs}`,
        ...(stderr.trim() ? [`stderr:\n${stderr.slice(0, 4000)}`] : []),
        ...(stdout.trim() ? [`stdout:\n${stdout.slice(0, 4000)}`] : []),
      ],
    });
    return;
  }

  void vscode.window.showInformationMessage("MVS generate completed.");
  try {
    await runLint(wf, undefined, { commandLabel: `${commandLabel} (post-generate lint)` });
  } catch (e) {
    reportCommandFailure(log, revealMvsOutput, {
      command: commandLabel,
      summary: "Generate succeeded but the follow-up lint step crashed.",
      cause: e,
      remedies: ["Run **MVS: Lint manifest** manually.", "See the MVS output channel for the stack trace."],
    });
  }
}

async function runReport(wf: vscode.WorkspaceFolder): Promise<void> {
  const commandLabel = "MVS: Report (JSON)";
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

  let stdout: string;
  let stderr: string;
  let code: number | null;
  try {
    const result = await runMvsManager(exe, args, wf.uri.fsPath);
    stdout = result.stdout;
    stderr = result.stderr;
    code = result.code;
  } catch (e) {
    reportCommandFailure(log, revealMvsOutput, {
      command: commandLabel,
      summary: `Could not start mvs-manager (${exe}) for report.`,
      cause: e,
      remedies: remediesForProcessSpawnError(exe, e),
      extraLogLines: [`manifest: ${manifestAbs}`],
    });
    return;
  }

  if (stderr.trim()) {
    log(stderr.trim());
  }

  let doc: vscode.TextDocument;
  try {
    doc = await vscode.workspace.openTextDocument({
      content: stdout || "(empty stdout)",
      language: "json",
    });
  } catch (e) {
    reportCommandFailure(log, revealMvsOutput, {
      command: commandLabel,
      summary: "Could not open a buffer for report JSON.",
      cause: e,
      remedies: ["Try again; if it persists, reload the window."],
      extraLogLines: [`stdout length: ${stdout.length}`],
    });
    return;
  }

  try {
    await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: false });
  } catch (e) {
    reportCommandFailure(log, revealMvsOutput, {
      command: commandLabel,
      summary: "Could not show the report JSON editor.",
      cause: e,
      remedies: ["Close some editors and retry, or copy JSON from the MVS output channel after running report in a terminal."],
    });
    return;
  }

  if (code === null) {
    reportCommandFailure(log, revealMvsOutput, {
      command: commandLabel,
      summary: "MVS report exited without an exit code.",
      cause: new Error("exit code null"),
      remedies: ["See MVS output for stderr."],
      extraLogLines: [`stderr:\n${stderr.slice(0, 2000)}`],
    });
    return;
  }

  if (code !== 0) {
    const detail = [
      `exit code: ${code}`,
      stderr.trim() ? `stderr:\n${stderr.slice(0, 2000)}` : "",
      `stdout preview:\n${stdout.slice(0, 2000)}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    log(`${commandLabel}: non-zero exit ${code}`);
    log(detail);
    void vscode.window.showWarningMessage(
      `MVS report exited with code ${code}. Output is still shown in the editor tab; verify JSON is usable.`,
      { modal: false, detail },
      "Open MVS output"
    ).then((sel) => {
      if (sel === "Open MVS output") {
        revealMvsOutput();
      }
    });
  }
}

async function runDoctor(wf: vscode.WorkspaceFolder): Promise<void> {
  const commandLabel = "MVS: Doctor";
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

  let stdout: string;
  let stderr: string;
  let code: number | null;
  try {
    const result = await runMvsManager(exe, args, wf.uri.fsPath);
    stdout = result.stdout;
    stderr = result.stderr;
    code = result.code;
  } catch (e) {
    reportCommandFailure(log, revealMvsOutput, {
      command: commandLabel,
      summary: `Could not start mvs-manager (${exe}) for doctor.`,
      cause: e,
      remedies: remediesForProcessSpawnError(exe, e),
      extraLogLines: [`--root ${rootAbs}`, `--manifest ${c.manifest}`],
    });
    return;
  }

  output.show(true);
  if (stdout.trim()) {
    log(stdout.trim());
  }
  if (stderr.trim()) {
    log(stderr.trim());
  }

  if (code === null) {
    reportCommandFailure(log, revealMvsOutput, {
      command: commandLabel,
      summary: "MVS doctor exited without an exit code.",
      cause: new Error("exit code null"),
      remedies: ["See stderr in the MVS output channel."],
    });
    return;
  }

  if (code !== 0) {
    const detail = [`exit code: ${code}`, stderr.trim() ? `stderr:\n${stderr.slice(0, 2500)}` : ""]
      .filter(Boolean)
      .join("\n\n");
    log(`${commandLabel}: non-zero exit ${code}`);
    void vscode.window.showWarningMessage(
      `MVS doctor exited with code ${code}. See the MVS output channel for JSON/text.`,
      { modal: false, detail },
      "Open MVS output"
    ).then((sel) => {
      if (sel === "Open MVS output") {
        revealMvsOutput();
      }
    });
  }
}

export function activate(context: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel("MVS");
  context.subscriptions.push(output, COLLECTION);

  const withFolder = async (command: string, fn: (wf: vscode.WorkspaceFolder) => Promise<void>): Promise<void> => {
    const wf = getWorkspaceFolder();
    if (!wf) {
      void vscode.window.showErrorMessage(
        "MVS: open a folder workspace first.",
        {
          modal: false,
          detail:
            "This command needs a folder on disk so **MVS Manager: Root** and the manifest path resolve.\n\nUse **File → Open Folder**, or add a folder to the workspace.",
        }
      );
      return;
    }
    try {
      await fn(wf);
    } catch (e) {
      reportCommandFailure(log, revealMvsOutput, {
        command,
        summary: `${command} failed with an unexpected error.`,
        cause: e,
        remedies: [
          "Open the **MVS** output channel for the stack trace.",
          "Reload the window and retry; if it persists, report the log with your editor and mvs-manager versions.",
        ],
      });
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("mvs.lint", () =>
      withFolder("MVS: Lint manifest", async (wf) => {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "MVS lint",
            cancellable: true,
          },
          async (_progress, token) => {
            await runLint(wf, token, { commandLabel: "MVS: Lint manifest" });
          }
        );
      })
    ),
    vscode.commands.registerCommand("mvs.generate", () => withFolder("MVS: Generate / update manifest", (wf) => runGenerate(wf))),
    vscode.commands.registerCommand("mvs.report", () => withFolder("MVS: Report (JSON)", (wf) => runReport(wf))),
    vscode.commands.registerCommand("mvs.doctor", () => withFolder("MVS: Doctor", (wf) => runDoctor(wf))),
    vscode.commands.registerCommand("mvs.clearDiagnostics", () => {
      try {
        COLLECTION.clear();
      } catch (e) {
        reportCommandFailure(log, revealMvsOutput, {
          command: "MVS: Clear diagnostics",
          summary: "Could not clear the MVS diagnostic collection.",
          cause: e,
          remedies: ["Reload the window and try again."],
        });
      }
    }),
    vscode.commands.registerCommand("mvs.checkForUpdates", async () => {
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "MVS: Checking for updates…",
            cancellable: false,
          },
          async () => {
            await checkAndApplyExtensionUpdate(context, log, revealMvsOutput, { force: true });
          }
        );
      } catch (e) {
        reportCommandFailure(log, revealMvsOutput, {
          command: "MVS: Check for extension updates",
          summary: "Update check failed unexpectedly.",
          cause: e,
          remedies: ["See the MVS output channel for details."],
        });
      }
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
        void runLint(wf, undefined, { commandLabel: "MVS: Lint on save" });
      }, 800);
    })
  );

  const extVer =
    (context.extension.packageJSON as { version?: string } | undefined)?.version ?? "?";
  log(`MVS extension activated (package ${extVer}).`);
  log(
    `Minimum tested mvs-manager (MVSengine): ${MIN_MVS_MANAGER_VERSION}+ — see README Requirements and Compatibility contract.`
  );
  const wf0 = vscode.workspace.workspaceFolders?.[0];
  if (wf0) {
    void logWorkspaceMvsIdentityIfPresent(wf0);
  }

  scheduleExtensionAutoUpdate(context, log, revealMvsOutput);
}

export function deactivate() {
  if (saveLintTimer) {
    clearTimeout(saveLintTimer);
  }
}
