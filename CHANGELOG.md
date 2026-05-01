# Changelog

All notable changes to this project are documented here. Extension **semver** matches [`mvs.json`](mvs.json) `identity.arch`, `identity.feat`, and `identity.prot` (see `npm run mvs:sync-version`).

## [1.3.2] — 2026-04-30

First release on **MVS architecture 1** (`identity.arch: 1`, dogfood id `1.3.2-vscode`). Feature and protocol counters carry forward from the prior **0.3.2** line, so the published **npm/editor version is 1.3.2** (not 1.0.0).

### Added

- Compatibility contract for the **1.x** extension line: [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) (frozen `mvs.*` commands and `mvsManager.*` settings, deprecation policy).
- Minimum tested `mvs-manager` version surfaced at activate and documented in README (see `src/extensionMetadata.ts`).
- Smoke tests for lint JSON parsing with a stub CLI; unit tests for VSIX asset selection; [Dependabot](.github/dependabot.yml) for npm.

### Changed

- `mvs-manager generate --arch-break` with documented reason; `compatibility` ranges updated per generator (`lock-step` / current protocol).
- README: dependency audit expectations before release tags.

### Notes

- **Download:** [GitHub releases — latest stable universal VSIX](https://github.com/alextheberge/mvs-vscode/releases/latest).
- **CLI:** install `mvs-manager` from [MVSengine releases](https://github.com/alextheberge/MVSengine/releases); extension does not bundle the binary.

[1.3.2]: https://github.com/alextheberge/mvs-vscode/releases/tag/v1.3.2
