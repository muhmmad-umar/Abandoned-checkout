export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly subcode?: number,
    readonly fbtraceId?: string,
  ) {
    super(message);
    this.name = "MetaApiError";
  }

  /** Throttling codes: app (4), user (17), page (32), custom (613), ads business use case (80000-80014). */
  get isRateLimit(): boolean {
    const c = this.code ?? 0;
    return c === 4 || c === 17 || c === 32 || c === 613 || (c >= 80000 && c <= 80014);
  }

  /** 190 = invalid/expired token; the client must reconnect. */
  get isAuthError(): boolean {
    return this.code === 190 || this.status === 401;
  }

  get isTransient(): boolean {
    return this.isRateLimit || this.status >= 500 || this.code === 1 || this.code === 2;
  }
}

export interface UsageInfo {
  /** Highest usage % reported across call count, CPU time and total time. */
  maxPct: number;
  /** Seconds until access is regained, when throttled. */
  regainAccessSec: number;
}

/** Parses X-Business-Use-Case-Usage / X-App-Usage / X-Ad-Account-Usage headers. */
export function parseUsage(headers: Headers): UsageInfo {
  let maxPct = 0;
  let regainAccessSec = 0;
  const visit = (o: Record<string, unknown>) => {
    for (const k of ["call_count", "total_cputime", "total_time", "acc_id_util_pct"]) {
      const v = Number(o[k] ?? 0);
      if (v > maxPct) maxPct = v;
    }
    const minutes = Number(o["estimated_time_to_regain_access"] ?? 0);
    if (minutes * 60 > regainAccessSec) regainAccessSec = minutes * 60;
    const reset = Number(o["reset_time_duration"] ?? 0);
    if (Number(o["acc_id_util_pct"] ?? 0) >= 100 && reset > regainAccessSec) regainAccessSec = reset;
  };
  for (const h of ["x-business-use-case-usage", "x-app-usage", "x-ad-account-usage"]) {
    const raw = headers.get(h);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) parsed.forEach((x) => visit(x as Record<string, unknown>));
      else if (parsed && typeof parsed === "object") {
        const values = Object.values(parsed as Record<string, unknown>);
        // BUC header: { "<account id>": [ {...} ] }
        if (values.every(Array.isArray)) values.flat().forEach((x) => visit(x as Record<string, unknown>));
        else visit(parsed as Record<string, unknown>);
      }
    } catch {
      // Malformed usage header: ignore rather than fail the call.
    }
  }
  return { maxPct, regainAccessSec };
}
