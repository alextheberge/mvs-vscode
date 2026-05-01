import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { parseLintReportJson } from "../src/lintModel";

const fixture = (name: string) =>
  fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");

describe("parseLintReportJson", () => {
  it("parses golden public API drift fixture", () => {
    const parsed = parseLintReportJson(fixture("lint_public_api_drift.json"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.report.command).toBe("lint");
    expect(parsed.report.exit_code).toBe(20);
    expect(parsed.report.failures).toHaveLength(1);
    expect(parsed.report.evidence.diff.public_api.added).toHaveLength(1);
    expect(parsed.report.evidence.diff.public_api.added[0]!.file).toBe("src/api.ts");
    expect(parsed.report.evidence.diff.public_api.added[0]!.signature).toContain(
      "rotateToken"
    );
  });

  it("rejects empty stdout", () => {
    const parsed = parseLintReportJson("   \n");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.error).toContain("empty");
  });

  it("rejects non-lint JSON", () => {
    const parsed = parseLintReportJson('{"command":"doctor","exit_code":0}');
    expect(parsed.ok).toBe(false);
  });
});
