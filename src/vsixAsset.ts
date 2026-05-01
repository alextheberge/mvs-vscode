export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Prefer universal-named VSIX, then package-prefixed, then any .vsix. */
export function pickVsixAsset(assets: GitHubReleaseAsset[], packageName: string): GitHubReleaseAsset | undefined {
  const vsix = assets.filter((a) => a.name.toLowerCase().endsWith(".vsix"));
  if (vsix.length === 0) {
    return undefined;
  }
  const universal = vsix.find((a) => /universal/i.test(a.name));
  if (universal) {
    return universal;
  }
  const prefix = new RegExp(`^${escapeRegExp(packageName)}-`, "i");
  const primary = vsix.find((a) => prefix.test(a.name));
  if (primary) {
    return primary;
  }
  return vsix[0];
}
