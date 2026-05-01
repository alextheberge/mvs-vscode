# MVS Manager (VS Code / Cursor / VSCodium)

Thin editor wrapper around the [`mvs-manager`](https://github.com/alextheberge/MVSengine) CLI. It runs `mvs-manager lint --format json`, maps results into the **Problems** view, and exposes **MVS:** commands plus an **MVS** output channel.

## Requirements

- [`mvs-manager`](https://github.com/alextheberge/MVSengine) on your `PATH`, **or** set `mvsManager.executablePath` to the binary.
- A workspace folder that contains `mvs.json` (or adjust `mvsManager.manifest`).

Minimum tested CLI version: align with the [MVSengine](https://github.com/alextheberge/MVSengine) release you install; the integration contract is `lint --format json` (`LintReport` JSON).

## Install

### From a VSIX

```bash
npm ci
npm run compile
npm run package
```

Then in the editor: **Extensions: Install from VSIX…** and pick the generated `.vsix`.

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

- **GitHub Release:** push a tag `v` + exact `package.json` version (for example `v0.3.2`). The **Release** workflow builds, runs the same gates as CI, attaches `mvs-vscode-*.vsix`, and opens a release with generated notes. You can also run **Actions → Release → Run workflow** on a branch: it performs the full build and uploads a **vsix-release-dryrun** artifact without creating a GitHub Release (releases still only happen on tag pushes).
- **VS Marketplace:** `npx @vscode/vsce publish` with a [Personal Access Token](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).
- **Open VSX:** `npx ovsx publish` with an [Open VSX token](https://github.com/eclipse/openvsx/wiki/Publishing-Extensions).

CI uses **Node 24** (`actions/setup-node@v6`) and installs the latest `mvs-manager` from MVSengine releases, then runs `mvs:dogfood-check`, `mvs:lint`, `check`, ESLint, tests, compile, and `vsce package`.

## License

AGPL-3.0-only (see `LICENSE`). Using this extension together with `mvs-manager` does not replace the CLI’s license terms.
