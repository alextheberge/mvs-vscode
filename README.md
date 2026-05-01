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

## Commands

- **MVS: Lint manifest** — `lint --format json`; updates Problems.
- **MVS: Generate / update manifest** — runs `generate` after confirmation, then lint.
- **MVS: Report (JSON)** — runs `report` with base and target set to the configured manifest (useful for inspecting JSON shape; compare two manifests via the CLI for real diffs).
- **MVS: Doctor** — `doctor --format json`; opens the MVS output channel.
- **MVS: Clear diagnostics** — clears the MVS diagnostic collection.

## Publishing (maintainers)

- **VS Marketplace:** `npx @vscode/vsce publish` with a [Personal Access Token](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).
- **Open VSX:** `npx ovsx publish` with an [Open VSX token](https://github.com/eclipse/openvsx/wiki/Publishing-Extensions).

CI in this repo runs `check`, `lint`, `test`, `compile`, and packages a VSIX with `vsce package`.

## License

AGPL-3.0-only (see `LICENSE`). Using this extension together with `mvs-manager` does not replace the CLI’s license terms.
