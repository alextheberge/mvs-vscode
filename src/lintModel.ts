/** Parsed shape of `mvs-manager lint --format json` (subset). */

export interface PublicApiSnapshot {
  file: string;
  signature: string;
}

export interface PublicApiInventoryDiff {
  added: PublicApiSnapshot[];
  removed: PublicApiSnapshot[];
}

export interface StringInventoryDiff {
  added: string[];
  removed: string[];
}

export interface InventoryDiff {
  features: StringInventoryDiff;
  protocols: StringInventoryDiff;
  public_api: PublicApiInventoryDiff;
}

export interface LintEvidence {
  feature_hash: string;
  protocol_hash: string;
  public_api_hash: string;
  feature_inventory_count: number;
  protocol_inventory_count: number;
  public_api_inventory_count: number;
  diff: InventoryDiff;
}

export interface LintReport {
  command: string;
  status: string;
  exit_code: number;
  manifest_path: string;
  root: string;
  failure_count: number;
  failures: string[];
  evidence: LintEvidence;
}

export type ParsedLintResult =
  | { ok: true; report: LintReport }
  | { ok: false; error: string };

function emptyDiff(): InventoryDiff {
  return {
    features: { added: [], removed: [] },
    protocols: { added: [], removed: [] },
    public_api: { added: [], removed: [] },
  };
}

export function parseLintReportJson(stdout: string): ParsedLintResult {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { ok: false, error: "empty stdout from mvs-manager lint" };
  }
  try {
    const raw = JSON.parse(trimmed) as Partial<LintReport>;
    if (raw.command !== "lint" || typeof raw.exit_code !== "number") {
      return { ok: false, error: "stdout is not a valid lint report" };
    }
    if (!raw.evidence) {
      return { ok: false, error: "lint report missing evidence" };
    }
    const evidence = raw.evidence as LintEvidence;
    if (!evidence.diff) {
      evidence.diff = emptyDiff();
    } else if (!evidence.diff.public_api) {
      evidence.diff.public_api = { added: [], removed: [] };
    }
    const report: LintReport = {
      command: raw.command,
      status: raw.status ?? "unknown",
      exit_code: raw.exit_code,
      manifest_path: raw.manifest_path ?? "",
      root: raw.root ?? ".",
      failure_count: raw.failure_count ?? 0,
      failures: Array.isArray(raw.failures) ? raw.failures : [],
      evidence,
    };
    return { ok: true, report };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `invalid JSON: ${msg}` };
  }
}
