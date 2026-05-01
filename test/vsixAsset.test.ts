import { describe, expect, it } from "vitest";
import { pickVsixAsset } from "../src/vsixAsset";

describe("pickVsixAsset", () => {
  it("prefers universal in the filename", () => {
    const a = pickVsixAsset(
      [
        { name: "other-1.vsix", browser_download_url: "https://x/a" },
        { name: "mvs-vscode-1.0.0-universal.vsix", browser_download_url: "https://x/u" },
      ],
      "mvs-vscode"
    );
    expect(a?.name).toBe("mvs-vscode-1.0.0-universal.vsix");
  });

  it("falls back to package prefix", () => {
    const a = pickVsixAsset(
      [{ name: "mvs-vscode-1.0.0.vsix", browser_download_url: "https://x/p" }],
      "mvs-vscode"
    );
    expect(a?.name).toBe("mvs-vscode-1.0.0.vsix");
  });

  it("returns first vsix if no match", () => {
    const a = pickVsixAsset([{ name: "foo.vsix", browser_download_url: "https://x/f" }], "mvs-vscode");
    expect(a?.name).toBe("foo.vsix");
  });
});
