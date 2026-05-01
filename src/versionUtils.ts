/** Parse `owner/repo` from common GitHub repository URL shapes. */
export function parseGithubRepoFromGitUrl(url: string): { owner: string; repo: string } | null {
  const u = url.trim();
  const m =
    /github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?\/?$/i.exec(u) ??
    /^([^/]+)\/([^/]+)$/.exec(u);
  if (!m) {
    return null;
  }
  return { owner: m[1], repo: m[2] };
}

export function stripLeadingV(tag: string): string {
  const t = tag.trim();
  return t.startsWith("v") || t.startsWith("V") ? t.slice(1) : t;
}

/** Compare semver `a` vs `b` using only numeric X.Y.Z prefixes (prerelease suffix ignored). Returns negative if a<b, 0 tie, positive if a>b. */
export function compareSemverNumeric(a: string, b: string): number {
  const pa = parseSemverPrefix(a);
  const pb = parseSemverPrefix(b);
  if (!pa || !pb) {
    return 0;
  }
  for (let i = 0; i < 3; i++) {
    const d = pa[i] - pb[i];
    if (d !== 0) {
      return d;
    }
  }
  return 0;
}

function parseSemverPrefix(s: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/i.exec(s.trim());
  if (!m) {
    return null;
  }
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}
