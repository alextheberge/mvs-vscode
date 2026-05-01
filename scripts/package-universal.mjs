/**
 * Produce a single platform-independent VSIX (JavaScript extension host only).
 * Filename: <package.name>-<package.version>-universal.vsix
 */
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const outName = `${pkg.name}-${pkg.version}-universal.vsix`;
const outPath = path.join(root, outName);

const vsceCli = path.join(root, "node_modules", "@vscode", "vsce", "vsce");
execFileSync(process.execPath, [vsceCli, "package", "--no-dependencies", "--out", outPath], {
  cwd: root,
  stdio: "inherit",
});

console.log(`Packaged universal VSIX: ${outPath}`);
