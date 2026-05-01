import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const mvs = JSON.parse(fs.readFileSync(path.join(root, "mvs.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const { arch, feat, prot } = mvs.identity;
const expected = `${arch}.${feat}.${prot}`;
if (pkg.version !== expected) {
  console.error(
    `Dogfood version mismatch: package.json has "${pkg.version}" but mvs.json identity is ${expected} (${mvs.identity.mvs}). Run: npm run mvs:sync-version`
  );
  process.exit(1);
}
console.log(`Dogfood OK: package.json and mvs.json both at ${expected}`);
