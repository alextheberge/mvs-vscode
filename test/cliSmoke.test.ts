import path from "path";
import { describe, expect, it } from "vitest";
import { parseLintReportJson } from "../src/lintModel";
import { runMvsManager } from "../src/mvsRunner";

const stub = path.join(process.cwd(), "test", "fixtures", "stub-mvs-manager.mjs");

describe("CLI smoke (stub mvs-manager)", () => {
  it("lint --format json round-trip through spawn + parser", async () => {
    const { stdout, stderr, code } = await runMvsManager(
      process.execPath,
      [stub, "lint", "--root", "/", "--manifest", "/tmp/mvs.json", "--format", "json"],
      "/"
    );
    expect(code).toBe(0);
    expect(stderr).toBe("");
    const parsed = parseLintReportJson(stdout);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.report.exit_code).toBe(0);
      expect(parsed.report.command).toBe("lint");
    }
  });
});
