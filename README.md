# MVS Manager (VS Code / Cursor / VSCodium)

Thin editor wrapper around the [`mvs-manager`](https://github.com/alextheberge/MVSengine) CLI. It runs `mvs-manager lint --format json`, maps results into the **Problems** view, and exposes **MVS:** commands plus an **MVS** output channel.

## Requirements

- [`mvs-manager`](https://github.com/alextheberge/MVSengine) on your `PATH`, **or** set `mvsManager.executablePath` to the binary.
- A workspace folder that contains `mvs.json` (or adjust `mvsManager.manifest`).
- **Minimum tested CLI:** **1.10.0** or newer (see [`src/extensionMetadata.ts`](src/extensionMetadata.ts)). Match or exceed the version CI downloads from [MVSengine releases](https://github.com/alextheberge/MVSengine/releases). The integration contract is `lint --format json` (`LintReport` JSON; see [`src/lintModel.ts`](src/lintModel.ts)).

**Compatibility contract (1.x):** frozen command IDs, settings keys, and deprecation rules — [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## Download from GitHub

| What you want | Link |
|----------------|------|
| **Latest stable** universal VSIX (recommended) | [**github.com/alextheberge/mvs-vscode/releases/latest**](https://github.com/alextheberge/mvs-vscode/releases/latest) — open **Assets**, download `mvs-vscode-*-universal.vsix`, then **Extensions: Install from VSIX…** |
| **Bleeding edge** from `main` (prerelease, updated on each push to `main`) | [**…/releases/tag/edge**](https://github.com/alextheberge/mvs-vscode/releases/tag/edge) — same install flow; may be ahead of the latest stable tag |

Stable releases use semver tags (`v1.3.2`, …). The **edge** prerelease does not replace **Latest** on GitHub’s API, so the extension’s auto-update (which uses `releases/latest`) still tracks **stable** builds.

## Install

### From a VSIX

```bash
npm ci
npm run compile
npm run package
```

Then in the editor: **Extensions: Install from VSIX…** and pick **`mvs-vscode-<version>-universal.vsix`** (one **universal** package for Windows, macOS, and Linux; it does not include the native `mvs-manager` CLI).

### Visual Studio Code (Marketplace)

After publishing: search **MVS Manager** in the Extensions view (publisher `alextheberge`).

### Cursor

Same VSIX or Marketplace flow as VS Code. Cursor accepts VS Code extensions; sideload the VSIX via **Extensions: Install from VSIX…** if the extension is not yet on an Open VSX–compatible registry you have enabled.

### VSCodium / Open VSX

VSCodium uses [Open VSX](https://open-vsx.org/) by default. After the extension is published there, install from the registry or use **Install from VSIX…** with a locally built package.

## Settings (`mvsManager.*`)

| Setting | Description |
|--------|-------------|
| `executablePath` | Absolute path to `mvs-manager`, or relative to the workspace folder. Empty = `mvs-manager` on `PATH`. |
| `root` | Value for `--root` (relative to the workspace folder). |
| `manifest` | Manifest path relative to `root` (same as `mvs-manager` `--manifest` resolution under `--root`). |
| `context` | Passed to `generate --context`. |
| `aiSchema` | Optional; if set, passed as `--ai-schema` (path relative to the workspace folder). |
| `runLintOnSave` | When `true`, debounced lint after saving the resolved manifest file (`root` + `manifest`). |
| `autoUpdate.enabled` | When `true` (default), checks GitHub for a newer release VSIX on a timer after startup. |
| `autoUpdate.mode` | `install` (default): download and install automatically. `notify`: prompt before downloading. |
| `autoUpdate.intervalHours` | Minimum hours between background checks (default `24`). |
| `autoUpdate.releaseApiUrl` | Optional `https://api.github.com/repos/owner/repo` override (e.g. fork or GitHub Enterprise API base). |

**Note:** Extensions installed from the Marketplace already update through the editor. Auto-update here targets **GitHub release VSIX** installs (same repo as `package.json` `repository.url`) so sideloaded builds can stay current.

## Commands

- **MVS: Lint manifest** — `lint --format json`; updates Problems.
- **MVS: Generate / update manifest** — runs `generate` after confirmation, then lint.
- **MVS: Report (JSON)** — runs `report` with base and target set to the configured manifest (useful for inspecting JSON shape; compare two manifests via the CLI for real diffs).
- **MVS: Doctor** — `doctor --format json`; opens the MVS output channel.
- **MVS: Clear diagnostics** — clears the MVS diagnostic collection.
- **MVS: Check for extension updates** — queries GitHub releases immediately (same logic as background auto-update).

## Publishing (maintainers)

This repository [dogfoods](https://github.com/alextheberge/MVSengine) MVS: `mvs.json` pins the extension’s public API (`activate` / `deactivate`), feature tags, and protocol tags. After you change tracked surfaces, run `mvs-manager generate` (or **MVS: Generate** in this workspace), then `npm run mvs:sync-version` so `package.json` matches `mvs.json` identity (`arch.feat.prot`). `npm run mvs:dogfood-check` verifies the two stay aligned.

- **Stable GitHub Release:** push an annotated tag `v` + exact `package.json` version (for example `v1.3.2`). The **Release** workflow builds, attaches **`mvs-vscode-<version>-universal.vsix`**, and publishes the release (shown under **Releases** and at `/releases/latest`). **Actions → Release → Run workflow** on a branch only uploads **`vsix-release-dryrun-universal`** (no GitHub Release). See [CHANGELOG.md](CHANGELOG.md) for release notes.
- **Edge prerelease:** every push to **`main`** runs **Edge VSIX (main)** and republishes the **`edge`** prerelease so a VSIX is always on GitHub without tagging (see [Download from GitHub](#download-from-github)).
- **VS Marketplace:** `npx @vscode/vsce publish` with a [Personal Access Token](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).
- **Open VSX:** `npx ovsx publish` with an [Open VSX token](https://github.com/eclipse/openvsx/wiki/Publishing-Extensions).

CI uses **Node 24** (`actions/setup-node@v6`) and installs the latest `mvs-manager` from MVSengine releases, then runs `mvs:dogfood-check`, `mvs:lint`, `check`, ESLint, tests, compile, and `vsce package`.

**Dependency / security:** [Dependabot](.github/dependabot.yml) proposes weekly npm updates. Before tagging a release, run **`npm audit`** and resolve **high** severity issues when feasible (see [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)).

## License

AGPL-3.0-only (see `LICENSE`). Using this extension together with `mvs-manager` does not replace the CLI’s license terms.
