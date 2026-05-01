import * as cp from "child_process";
import * as path from "path";
import type { CancellationToken } from "vscode";

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * Runs `mvs-manager` with the given args. cwd should be the workspace folder root.
 */
export function runMvsManager(
  executable: string,
  args: string[],
  cwd: string,
  token?: CancellationToken
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(executable, args, {
      cwd,
      windowsHide: true,
      env: { ...process.env },
    });
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    const sub = token?.onCancellationRequested(() => {
      child.kill("SIGTERM");
    });

    child.stdout?.on("data", (d: Buffer) => outChunks.push(d));
    child.stderr?.on("data", (d: Buffer) => errChunks.push(d));
    child.on("error", (err) => {
      sub?.dispose();
      reject(err);
    });
    child.on("close", (code) => {
      sub?.dispose();
      resolve({
        stdout: Buffer.concat(outChunks).toString("utf8"),
        stderr: Buffer.concat(errChunks).toString("utf8"),
        code,
      });
    });
  });
}

export function resolveExecutable(
  configuredPath: string | undefined,
  workspaceFolderPath: string
): string {
  const trimmed = (configuredPath ?? "").trim();
  if (trimmed) {
    return path.isAbsolute(trimmed)
      ? trimmed
      : path.join(workspaceFolderPath, trimmed);
  }
  return "mvs-manager";
}
