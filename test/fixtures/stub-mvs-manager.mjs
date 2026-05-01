#!/usr/bin/env node
/**
 * Minimal stub for smoke tests: prints fixed lint JSON when invoked like
 * `node stub-mvs-manager.mjs lint ... --format json`
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args[0] === "lint" && args.includes("--format") && args.includes("json")) {
  const body = readFileSync(join(here, "lint_passed_minimal.json"), "utf8");
  process.stdout.write(body);
  process.exit(0);
}
process.stderr.write("stub: unsupported args\n");
process.exit(2);
