import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const mvsPath = path.join(root, "mvs.json");
const pkgPath = path.join(root, "package.json");

const mvs = JSON.parse(fs.readFileSync(mvsPath, "utf8"));
const { arch, feat, prot } = mvs.identity;
const version = `${arch}.${feat}.${prot}`;
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.version = version;
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
