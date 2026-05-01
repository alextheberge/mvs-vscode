import * as path from "path";
import * as vscode from "vscode";
import type { LintReport } from "./lintModel";

/** Resolve a crawl-relative `file` from lint JSON using workspace + configured --root. */
function resolvePublicApiFileUri(
  wf: vscode.WorkspaceFolder,
  configRoot: string,
  reportRoot: string,
  fileRel: string
): vscode.Uri {
  const workspaceFs = wf.uri.fsPath;
  const expectedRoot = path.normalize(path.join(workspaceFs, configRoot));
  const rr = path.normalize(
    reportRoot.replace(/<ROOT>/g, expectedRoot).replace(/<MANIFEST_PATH>/g, "")
  );
  if (path.isAbsolute(rr)) {
    return vscode.Uri.file(path.join(rr, fileRel));
  }
  return vscode.Uri.joinPath(wf.uri, ...path.join(configRoot, fileRel).split(/[/\\]/));
}

export function diagnosticsFromLintReport(
  workspaceFolder: vscode.WorkspaceFolder,
  configRoot: string,
  configManifest: string,
  report: LintReport
): [vscode.Uri, vscode.Diagnostic[]][] {
  const wf = workspaceFolder.uri;
  const map = new Map<string, vscode.Diagnostic[]>();

  const manifestRel = path.join(configRoot, configManifest);
  const manifestUri = vscode.Uri.joinPath(
    wf,
    ...manifestRel.split(/[/\\]/).filter((s) => s.length > 0)
  );
  const manifestDiagnostics: vscode.Diagnostic[] = [];

  const summary =
    report.exit_code === 0
      ? "MVS lint passed"
      : `MVS lint failed (exit ${report.exit_code}, ${report.failure_count} issue(s))`;

  manifestDiagnostics.push(
    new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, Math.min(1, summary.length)),
      summary,
      report.exit_code === 0
        ? vscode.DiagnosticSeverity.Information
        : vscode.DiagnosticSeverity.Error
    )
  );

  for (let i = 0; i < report.failures.length; i++) {
    const text = report.failures[i]!;
    manifestDiagnostics.push(
      new vscode.Diagnostic(
        new vscode.Range(i + 1, 0, i + 1, Math.min(120, text.length)),
        text,
        vscode.DiagnosticSeverity.Error
      )
    );
  }
  map.set(manifestUri.toString(), manifestDiagnostics);

  const { added, removed } = report.evidence.diff.public_api;

  for (const snap of added) {
    const uri = resolvePublicApiFileUri(
      workspaceFolder,
      configRoot,
      report.root,
      snap.file
    );
    const msg = `MVS: public API added (manifest not updated): ${snap.signature}`;
    const list = map.get(uri.toString()) ?? [];
    const d = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 1),
      msg,
      vscode.DiagnosticSeverity.Warning
    );
    d.code = "mvs-public-api-added";
    list.push(d);
    map.set(uri.toString(), list);
  }

  for (const snap of removed) {
    const uri = resolvePublicApiFileUri(
      workspaceFolder,
      configRoot,
      report.root,
      snap.file
    );
    const msg = `MVS: public API removed vs manifest: ${snap.signature}`;
    const list = map.get(uri.toString()) ?? [];
    const d = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 1),
      msg,
      vscode.DiagnosticSeverity.Error
    );
    d.code = "mvs-public-api-removed";
    list.push(d);
    map.set(uri.toString(), list);
  }

  return [...map.entries()].map(([k, v]) => [vscode.Uri.parse(k), v] as const);
}
