import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  formatUnknownError,
  githubReleaseFailureDetail,
  reportBackgroundFailure,
  reportCommandFailure,
} from "./commandErrors";
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

type FetchLatestResult =
  | { ok: true; release: GitHubReleaseLatest; requestUrl: string }
  | { ok: false; requestUrl: string; summary: string; remedies: string[]; logLines: string[] };

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
): Promise<FetchLatestResult> {
  const base = (releaseApiBase ?? `https://api.github.com/repos/${owner}/${repo}`).replace(/\/$/, "");
  const requestUrl = `${base}/releases/latest`;
  let res: Response;
  try {
    res = await fetch(requestUrl, {
      headers: { Accept: GH_ACCEPT, "User-Agent": UA },
    });
  } catch (e) {
    const { message, stack } = formatUnknownError(e);
    return {
      ok: false,
      requestUrl,
      summary: "Could not reach GitHub to check for extension updates.",
      remedies: [
        "Check your network, proxy, and VPN.",
        "Confirm `mvsManager.autoUpdate.releaseApiUrl` matches your fork or GitHub Enterprise API host if you use one.",
      ],
      logLines: [`Network error: ${message}`, stack ?? ""].filter(Boolean),
    };
  }

  const bodyText = await res.text();
  if (!res.ok) {
    const { summary, remedies, logLines } = githubReleaseFailureDetail(
      requestUrl,
      res.status,
      res.statusText,
      bodyText.slice(0, 2000)
    );
    return { ok: false, requestUrl, summary, remedies, logLines };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText) as GitHubReleaseLatest;
  } catch (e) {
    const { message } = formatUnknownError(e);
    return {
      ok: false,
      requestUrl,
      summary: "GitHub returned success but the response was not valid JSON.",
      remedies: [
        "You may be hitting a captive portal or a proxy that returns HTML.",
        "Retry later; if `releaseApiUrl` is set, verify it points at the GitHub REST API (`.../repos/owner/repo`).",
      ],
      logLines: [`JSON parse error: ${message}`, `Body (first 1500 chars):\n${bodyText.slice(0, 1500)}`],
    };
  }

  const release = parsed as GitHubReleaseLatest;
  if (!release || typeof release.tag_name !== "string") {
    return {
      ok: false,
      requestUrl,
      summary: "GitHub JSON did not include a string `tag_name` field.",
      remedies: ["The releases API response may have changed or the URL may not be a GitHub repo root."],
      logLines: [`Parsed keys: ${parsed && typeof parsed === "object" ? Object.keys(parsed).join(", ") : typeof parsed}`],
    };
  }
  if (!Array.isArray(release.assets)) {
    return {
      ok: false,
      requestUrl,
      summary: "GitHub release JSON missing `assets` array.",
      remedies: ["Retry later or inspect the release payload in the MVS output channel."],
      logLines: [`tag_name: ${release.tag_name}`],
    };
  }

  return { ok: true, release, requestUrl };
}

async function downloadToFile(url: string, destFsPath: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/octet-stream", "User-Agent": UA },
      redirect: "follow",
    });
  } catch (e) {
    const { message } = formatUnknownError(e);
    throw new Error(`Network error while downloading VSIX: ${message}`);
  }
  if (!res.ok) {
    const hint = await res.text().catch(() => "");
    throw new Error(
      `Download failed: HTTP ${res.status} ${res.statusText}${hint ? `. Body (truncated): ${hint.slice(0, 400)}` : ""}`
    );
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
  revealOutput: () => void,
  opts?: { force?: boolean }
): Promise<void> {
  const commandLabel = opts?.force ? "MVS: Check for extension updates" : "MVS: Auto-update";

  try {
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
      const msg =
        "Auto-update: no GitHub `owner/repo` could be parsed from package.json `repository.url`; skipping.";
      log(msg);
      if (opts?.force) {
        reportCommandFailure(log, revealOutput, {
          command: commandLabel,
          summary: "Cannot check for updates: repository URL is missing or not a GitHub URL.",
          cause: new Error(repoUrl ? `Unrecognized repository.url: ${repoUrl}` : "repository.url is empty"),
          remedies: [
            "The extension must be built from a `package.json` that includes `repository.url` like `https://github.com/owner/repo`.",
            "For forks, set that field (or use **MVS Manager: Auto Update: Release Api Url**).",
          ],
        });
      }
      return;
    }

    const fetched = await fetchLatestReleaseJson(parsed.owner, parsed.repo, releaseApiUrl || undefined);
    if (fetched.ok) {
      log(`Auto-update: release metadata OK (${fetched.requestUrl}).`);
    }

    if (!fetched.ok) {
      if (opts?.force) {
        reportCommandFailure(log, revealOutput, {
          command: commandLabel,
          summary: fetched.summary,
          cause: new Error(fetched.summary),
          remedies: fetched.remedies,
          extraLogLines: [`URL: ${fetched.requestUrl}`, ...fetched.logLines],
        });
      } else {
        reportBackgroundFailure(log, revealOutput, {
          area: commandLabel,
          summary: fetched.summary,
          cause: new Error(fetched.summary),
          remedies: fetched.remedies,
          extraLogLines: [`URL: ${fetched.requestUrl}`, ...fetched.logLines],
          notify: false,
        });
      }
      return;
    }

    const release = fetched.release;
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
      const msg = "Auto-update: latest release has no .vsix asset.";
      log(msg);
      log(`tag_name=${release.tag_name}; asset names: ${(release.assets ?? []).map((a) => a.name).join(", ") || "(none)"}`);
      if (opts?.force) {
        reportCommandFailure(log, revealOutput, {
          command: commandLabel,
          summary: "The latest GitHub release has no .vsix file attached.",
          cause: new Error(msg),
          remedies: [
            "Attach a VSIX to the release (see this repo’s **Release** GitHub workflow), or install manually from the Releases page.",
            `Open: https://github.com/${parsed.owner}/${parsed.repo}/releases`,
          ],
        });
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
      reportCommandFailure(log, revealOutput, {
        command: commandLabel,
        summary: "Cannot download update: global storage path is unavailable.",
        cause: new Error("globalStorageUri.fsPath is empty"),
        remedies: ["Reload the window. If you are in a restricted remote context, install the VSIX on the remote manually."],
      });
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
      reportCommandFailure(log, revealOutput, {
        command: commandLabel,
        summary: "MVS extension update: download failed.",
        cause: e,
        remedies: [
          "Check the asset URL in the MVS output channel and try opening it in a browser.",
          "Corporate proxies sometimes block GitHub `releases/download` URLs.",
        ],
        extraLogLines: [`Destination: ${dest}`, `URL: ${asset.browser_download_url}`],
      });
      return;
    }

    try {
      await vscode.commands.executeCommand("workbench.extensions.installExtension", vscode.Uri.file(dest), true);
    } catch (e) {
      reportCommandFailure(log, revealOutput, {
        command: commandLabel,
        summary: "MVS extension update: install from VSIX failed.",
        cause: e,
        remedies: [
          "Try **Extensions: Install from VSIX…** manually using the downloaded file path from the log.",
          "Ensure you are not in a context where extension installs are blocked (some locked-down remotes).",
        ],
        extraLogLines: [`VSIX path: ${dest}`],
      });
      return;
    }

    const reload = await vscode.window.showInformationMessage(
      `MVS Manager was updated to ${latestVer}. Reload the window to finish.`,
      "Reload Window"
    );
    if (reload === "Reload Window") {
      try {
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
      } catch (e) {
        reportCommandFailure(log, revealOutput, {
          command: commandLabel,
          summary: "Reload window command failed after update.",
          cause: e,
          remedies: ["Run **Developer: Reload Window** from the Command Palette (F1)."],
        });
      }
    }
  } catch (e) {
    reportCommandFailure(log, revealOutput, {
      command: commandLabel,
      summary: "Unexpected error during extension update check.",
      cause: e,
      remedies: ["See the MVS output channel for the stack trace and retry."],
    });
  }
}

let intervalHandle: ReturnType<typeof setInterval> | undefined;
let startupTimer: ReturnType<typeof setTimeout> | undefined;

export function scheduleExtensionAutoUpdate(
  context: vscode.ExtensionContext,
  log: (msg: string) => void,
  revealOutput: () => void
): void {
  const run = () => {
    void checkAndApplyExtensionUpdate(context, log, revealOutput).catch((e) => {
      reportBackgroundFailure(log, revealOutput, {
        area: "MVS: Auto-update",
        summary: "Scheduled extension update check threw an unexpected error.",
        cause: e,
        remedies: ["Open the MVS output channel for details.", "Use **MVS: Check for extension updates** after fixing network or settings."],
        notify: true,
      });
    });
  };

  const { enabled, intervalHours } = readAutoUpdateConfig();
  if (!enabled) {
    return;
  }

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
