# Compatibility contract (extension 1.x line)

This document freezes the **editor integration surface** for semver **1.x** releases of MVS Manager (VS Code extension). It complements the repo’s [`mvs.json`](../mvs.json) (MVS manifest) and [MVSengine `CONTRACT_1X.md`](https://github.com/alextheberge/MVSengine/blob/master/docs/CONTRACT_1X.md).

## `mvs-manager` (CLI)

- **Minimum version tested in CI and development:** see [`MIN_MVS_MANAGER_VERSION`](../src/extensionMetadata.ts) (currently **1.10.0+**). Install matching or newer builds from [MVSengine releases](https://github.com/alextheberge/MVSengine/releases).
- **Integration contract:** `mvs-manager lint --format json` must return JSON compatible with [`src/lintModel.ts`](../src/lintModel.ts) (`LintReport` subset). Other commands use text or JSON as implemented in [`src/extension.ts`](../src/extension.ts).

## VS Code engine

- **`engines.vscode`** in [`package.json`](../package.json) is the minimum editor API level (currently **^1.85.0**). Features used include `MessageOptions.detail`, `onStartupFinished`, and `workbench.extensions.installExtension` for updates.

## Command IDs (frozen for 1.x)

| Command ID | Title |
|------------|--------|
| `mvs.lint` | MVS: Lint manifest |
| `mvs.generate` | MVS: Generate / update manifest |
| `mvs.report` | MVS: Report (JSON) |
| `mvs.doctor` | MVS: Doctor |
| `mvs.clearDiagnostics` | MVS: Clear diagnostics |
| `mvs.checkForUpdates` | MVS: Check for extension updates |

Renaming or removing a command ID is a **breaking** change (reserve for **2.0** or bump MVS architecture per project policy).

## Settings (`mvsManager.*`) — frozen keys for 1.x

| Key | Purpose |
|-----|---------|
| `executablePath` | Path to `mvs-manager` |
| `root` | `--root` relative to workspace |
| `manifest` | Manifest path under `root` |
| `context` | `generate --context` |
| `aiSchema` | Optional `--ai-schema` |
| `runLintOnSave` | Lint manifest on save |
| `autoUpdate.enabled` | GitHub VSIX auto-update |
| `autoUpdate.mode` | `install` \| `notify` |
| `autoUpdate.intervalHours` | Check interval |
| `autoUpdate.releaseApiUrl` | Optional GitHub API base |

New settings should be **additive** (optional with safe defaults). Renaming a key requires a **deprecation cycle** (see below).

## Deprecation policy

1. Prefer **additive** settings and commands through the whole **1.x** line.
2. If a key or command must be replaced: ship **both** old and new for **one minor** (old reads as alias or migration shim), document in CHANGELOG, then remove only in a **major** (semver **2.0** or coordinated MVS **architecture** bump, as decided at release time).

## Security / dependencies

- Run **`npm audit`** before release branches; address **high** severity where practical.
- [Dependabot](../.github/dependabot.yml) opens weekly grouped PRs for dev tooling.

## Stable vs edge (GitHub)

- **Stable:** a normal semver Git tag `v<package.json version>` (for example **`v1.3.2`**). The [Release](../.github/workflows/release.yml) workflow publishes **`mvs-vscode-<version>-universal.vsix`** and updates [**releases/latest**](https://github.com/alextheberge/mvs-vscode/releases/latest). The extension’s GitHub VSIX auto-update follows that **Latest** API.
- **Edge:** every push to **`main`** refreshes the **`edge`** prerelease ([edge-release workflow](../.github/workflows/edge-release.yml)). Prereleases do **not** replace **Latest**, so edge is opt-in (manual download or a pinned tag URL).

## MVS versioning for future 1.x work

- **`package.json` `version`** must stay equal to **`mvs.json` `identity.arch`.`identity.feat`.`identity.prot`** (enforced by `npm run mvs:dogfood-check` and the release workflow’s tag check).
- **Day-to-day:** after code or manifest evidence changes, run **`mvs-manager generate`** (or **MVS: Generate**), then **`npm run mvs:sync-version`** and **`npm run mvs:lint`**. **`feat`** / **`prot`** move when the generator detects inventory drift; ship those as normal **1.x** semver bumps.
- **Rare incompatible breaks:** use **`mvs-manager generate --arch-break --arch-reason "…"`** so **`identity.arch`** increments; sync version and treat the release as a major contract event (document in CHANGELOG). Reserve **semver 2.0** (or another arch bump) for future editor breaking changes per project policy.
