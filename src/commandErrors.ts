import * as vscode from "vscode";

export function formatUnknownError(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack };
  }
  return { message: String(err) };
}

export function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === "object" && err !== null && "code" in err;
}

export function remediesForProcessSpawnError(executable: string, err: unknown): string[] {
  if (isErrnoException(err) && err.code === "ENOENT") {
    return [
      `Nothing was found at "${executable}". Install mvs-manager from MVSengine or add it to your PATH.`,
      'Set **MVS Manager: Executable Path** (`mvsManager.executablePath`) to the full path of the binary if it is not named `mvs-manager` on PATH.',
      "https://github.com/alextheberge/MVSengine",
    ];
  }
  if (isErrnoException(err) && err.code === "EACCES") {
    return [
      `Permission denied when executing "${executable}".`,
      "On macOS/Linux: `chmod +x <path>` on the binary. On Windows: unblock the file in Properties if it was downloaded from the internet.",
    ];
  }
  if (isErrnoException(err) && err.code === "ENOTDIR") {
    return [
      "Configured executable path may point to a directory instead of a file.",
      "Set `mvsManager.executablePath` to the actual mvs-manager binary file.",
    ];
  }
  return [
    "See the **MVS** output channel for the exact command line and any stderr.",
    "Confirm the same command works in an integrated terminal from the workspace root.",
  ];
}

export function remediesForLintJsonParse(stdoutPreview?: string): string[] {
  const lines = [
    "The CLI did not return valid JSON for `lint --format json`.",
    "Run `mvs-manager lint --format json` in a terminal with the same `--root` and `--manifest` to inspect raw output.",
    "Upgrade **mvs-manager** to a current MVSengine release; older builds may not support JSON lint output.",
  ];
  if (stdoutPreview?.trim()) {
    lines.push(`First characters of stdout (for orientation): ${stdoutPreview.trim().slice(0, 120).replace(/\s+/g, " ")}…`);
  }
  return lines;
}

function buildDetailBlock(parts: { message: string; stack?: string; remedies?: string[]; extra?: string[] }): string {
  const lines: string[] = [`Cause: ${parts.message}`];
  if (parts.remedies?.length) {
    lines.push("", "What to try:");
    for (const r of parts.remedies) {
      lines.push(`• ${r}`);
    }
  }
  if (parts.extra?.length) {
    lines.push("", ...parts.extra);
  }
  if (parts.stack) {
    lines.push("", "Stack trace:", parts.stack);
  }
  return lines.join("\n");
}

/**
 * Logs a full diagnostic block to the output channel and shows a non-silent error toast with optional actions.
 */
export function reportCommandFailure(
  log: (line: string) => void,
  revealOutput: () => void,
  options: {
    command: string;
    /** Short text for the toast (first line). */
    summary: string;
    cause: unknown;
    remedies?: string[];
    /** Additional log-only context (not shown in toast detail if too large — keep summary in detail). */
    extraLogLines?: string[];
  }
): void {
  const { message, stack } = formatUnknownError(options.cause);
  const stamp = new Date().toISOString();
  log("");
  log(`── ${stamp} [${options.command}] FAILED ──`);
  log(options.summary);
  log(`Cause: ${message}`);
  for (const line of options.extraLogLines ?? []) {
    log(line);
  }
  if (stack) {
    log(stack);
  }
  if (options.remedies?.length) {
    log("Suggested fixes:");
    for (const r of options.remedies) {
      log(`  • ${r}`);
    }
  }
  log(`── end [${options.command}] ──`);

  const detail = buildDetailBlock({
    message,
    stack,
    remedies: options.remedies,
  });

  void vscode.window.showErrorMessage(options.summary, { modal: false, detail }, "Open MVS output").then((picked) => {
    if (picked === "Open MVS output") {
      revealOutput();
    }
  });
}

/** Background tasks: full log, optional light UI (avoid spamming toasts on timers). */
export function reportBackgroundFailure(
  log: (line: string) => void,
  revealOutput: () => void,
  options: {
    area: string;
    summary: string;
    cause: unknown;
    remedies?: string[];
    extraLogLines?: string[];
    /** When true, also notify the user (e.g. install step failed). */
    notify: boolean;
  }
): void {
  const { message, stack } = formatUnknownError(options.cause);
  const stamp = new Date().toISOString();
  log("");
  log(`── ${stamp} [${options.area}] (background) FAILED ──`);
  log(options.summary);
  log(`Cause: ${message}`);
  for (const line of options.extraLogLines ?? []) {
    log(line);
  }
  if (stack) {
    log(stack);
  }
  if (options.remedies?.length) {
    log("Suggested fixes:");
    for (const r of options.remedies) {
      log(`  • ${r}`);
    }
  }
  log(`── end [${options.area}] ──`);

  if (options.notify) {
    const detail = buildDetailBlock({ message, remedies: options.remedies });
    void vscode.window.showWarningMessage(options.summary, { detail }, "Open MVS output").then((picked) => {
      if (picked === "Open MVS output") {
        revealOutput();
      }
    });
  }
}

export function githubReleaseFailureDetail(
  url: string,
  status: number,
  statusText: string,
  bodySnippet: string | undefined
): { summary: string; remedies: string[]; logLines: string[] } {
  const logLines = [
    `Request URL: ${url}`,
    `HTTP ${status} ${statusText}`,
    bodySnippet ? `Response body (truncated):\n${bodySnippet}` : "(no response body captured)",
  ];
  const remedies: string[] = [];
  if (status === 404) {
    remedies.push("There is no **latest** release yet, or the repo URL in `package.json` is wrong.");
    remedies.push("Publish at least one GitHub release, or set `mvsManager.autoUpdate.releaseApiUrl` to the correct API base.");
  } else if (status === 403 || status === 429) {
    remedies.push("GitHub API rate limit or access denied. Wait and retry, or use a PAT (future) / check network/VPN.");
  } else if (status >= 500) {
    remedies.push("GitHub server error; retry later.");
  } else {
    remedies.push("Verify network access to api.github.com and that `mvsManager.autoUpdate.releaseApiUrl` is correct if set.");
  }
  const summary = `MVS extension update check failed (HTTP ${status}).`;
  return { summary, remedies, logLines };
}
