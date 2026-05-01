import { describe, expect, it } from "vitest";
import { compareSemverNumeric, parseGithubRepoFromGitUrl, stripLeadingV } from "../src/versionUtils";

describe("parseGithubRepoFromGitUrl", () => {
  it("parses https github url", () => {
    expect(parseGithubRepoFromGitUrl("https://github.com/foo/bar")).toEqual({
      owner: "foo",
      repo: "bar",
    });
  });
  it("parses git@ url", () => {
    expect(parseGithubRepoFromGitUrl("git@github.com:foo/bar.git")).toEqual({
      owner: "foo",
      repo: "bar",
    });
  });
});

describe("stripLeadingV", () => {
  it("strips v prefix", () => {
    expect(stripLeadingV("v1.2.3")).toBe("1.2.3");
  });
});

describe("compareSemverNumeric", () => {
  it("orders versions", () => {
    expect(compareSemverNumeric("0.3.2", "0.3.1")).toBeGreaterThan(0);
    expect(compareSemverNumeric("0.3.1", "0.3.2")).toBeLessThan(0);
    expect(compareSemverNumeric("1.0.0", "1.0.0")).toBe(0);
  });
  it("accepts v prefix", () => {
    expect(compareSemverNumeric("v0.4.0", "0.3.9")).toBeGreaterThan(0);
  });
});
