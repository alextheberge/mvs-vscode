import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { compareSemverNumeric, parseGithubRepoFromGitUrl, stripLeadingV } from "./versionUtils";

const GH_ACCEPT = "application/vnd.github+json";
const UA = "mvs-vscode-extension-update";

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubReleaseLatest {
  tag_name: string;
  assets: GitHubReleaseAsset[];
}

function readAutoUpdateConfig() {
  const cfg = vscode.workspace.getConfiguration("mvsManager");
  return {
    enabled: cfg.get<boolean>("autoUpdate.enabled", true) ?? true,
    mode: (cfg.get<string>("autoUpdate.mode", "install") === "notify" ? "notify" : "install") as
      | "notify"
      | "install",
    intervalHours: Math.max(1, cfg.get<number>("autoUpdate.intervalHours", 24) ?? 24),
    releaseApiUrl: (cfg.get<string>("autoUpdate.releaseApiUrl", "") ?? "").trim(),
  };
}

function pickVsixAsset(assets: GitHubReleaseAsset[]): GitHubReleaseAsset | undefined {
  const vsix = assets.filter((a) => a.name.toLowerCase().endsWith(".vsix"));
  return vsix[0];
}

async function fetchLatestReleaseJson(
  owner: string,
  repo: string,
  releaseApiBase: string | undefined
): Promise<GitHubReleaseLatest | null> {
  const base = (releaseApiBase ?? `https://api.github.com/repos/${owner}/${repo}`).replace(/\/$/, "");
  const url = `${base}/releases/latest`;
  const res = await fetch(url, {
    headers: { Accept: GH_ACCEPT, "User-Agent": UA },
  });
  if (!res.ok) {
    return null;
  }
  return (await res.json()) as GitHubReleaseLatest;
}

async function downloadToFile(url: string, destFsPath: string): Promise<void> {
  const res = await fetch(url, {
    headers: { Accept: "application/octet-stream", "User-Agent": UA },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Download failed: HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.promises.mkdir(path.dirname(destFsPath), { recursive: true });
  const tmp = `${destFsPath}.part`;
  await fs.promises.writeFile(tmp, buf);
  await fs.promises.rename(tmp, destFsPath);
}

export async function checkAndApplyExtensionUpdate(
  context: vscode.ExtensionContext,
  log: (msg: string) => void,
  opts?: { force?: boolean }
): Promise<void> {
  const { enabled, mode, releaseApiUrl } = readAutoUpdateConfig();
  if (!enabled && !opts?.force) {
    return;
  }

  const pkg = context.extension.packageJSON as {
    version?: string;
    repository?: { url?: string };
  };
  const current = pkg.version ?? "0.0.0";
  const repoUrl = pkg.repository?.url ?? "";
  const parsed = parseGithubRepoFromGitUrl(repoUrl);
  if (!parsed) {
    log("Auto-update: no GitHub repository URL in package.json; skipping.");
    return;
  }

  const release = await fetchLatestReleaseJson(parsed.owner, parsed.repo, releaseApiUrl || undefined);
  if (!release?.tag_name) {
    log("Auto-update: could not read latest release (network or API).");
    if (opts?.force) {
      void vscode.window.showErrorMessage(
        "MVS: could not check for updates. See the MVS output channel for details."
      );
    }
    return;
  }

  const latestVer = stripLeadingV(release.tag_name);
  if (compareSemverNumeric(latestVer, current) <= 0) {
    log(`Auto-update: up to date (${current}).`);
    if (opts?.force) {
      void vscode.window.showInformationMessage(`MVS Manager is up to date (${current}).`);
    }
    return;
  }

  const asset = pickVsixAsset(release.assets ?? []);
  if (!asset?.browser_download_url) {
    log("Auto-update: latest release has no .vsix asset.");
    if (opts?.force) {
      void vscode.window.showWarningMessage(
        "MVS: the latest GitHub release has no .vsix file attached."
      );
    }
    return;
  }

  log(`Auto-update: newer release ${latestVer} available (running ${current}).`);

  if (mode === "notify") {
    const releasePage = `https://github.com/${parsed.owner}/${parsed.repo}/releases/tag/${encodeURIComponent(
      release.tag_name
    )}`;
    const pick = await vscode.window.showInformationMessage(
      `MVS Manager ${latestVer} is available (you have ${current}).`,
      "Download and install",
      "Open release page",
      "Later"
    );
    if (pick === "Open release page") {
      await vscode.env.openExternal(vscode.Uri.parse(releasePage));
      return;
    }
    if (pick !== "Download and install") {
      return;
    }
  }

  const storageRoot = context.globalStorageUri?.fsPath;
  if (!storageRoot) {
    vscode.window.showErrorMessage("MVS: cannot resolve global storage for update download.");
    return;
  }

  const dest = path.join(storageRoot, "download", `mvs-manager-${latestVer}.vsix`);

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Downloading MVS Manager ${latestVer}…`,
        cancellable: false,
      },
      async () => {
        await downloadToFile(asset.browser_download_url, dest);
      }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`Auto-update download failed: ${msg}`);
    vscode.window.showErrorMessage(`MVS update download failed: ${msg}`);
    return;
  }

  try {
    await vscode.commands.executeCommand("workbench.extensions.installExtension", vscode.Uri.file(dest), true);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`Auto-update install failed: ${msg}`);
    vscode.window.showErrorMessage(`MVS update install failed: ${msg}`);
    return;
  }

  const reload = await vscode.window.showInformationMessage(
    `MVS Manager was updated to ${latestVer}. Reload the window to finish.`,
    "Reload Window"
  );
  if (reload === "Reload Window") {
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  }
}

let intervalHandle: ReturnType<typeof setInterval> | undefined;
let startupTimer: ReturnType<typeof setTimeout> | undefined;

export function scheduleExtensionAutoUpdate(context: vscode.ExtensionContext, log: (msg: string) => void): void {
  const run = () => {
    void checkAndApplyExtensionUpdate(context, log).catch((e) => {
      log(`Auto-update error: ${e instanceof Error ? e.message : String(e)}`);
    });
  };

  const { enabled, intervalHours } = readAutoUpdateConfig();
  if (!enabled) {
    return;
  }

  // Defer first check so activation stays light.
  startupTimer = setTimeout(run, 8000);

  const ms = intervalHours * 3600_000;
  intervalHandle = setInterval(run, ms);
  context.subscriptions.push({
    dispose: () => {
      if (startupTimer) {
        clearTimeout(startupTimer);
        startupTimer = undefined;
      }
      if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = undefined;
      }
    },
  });
}
