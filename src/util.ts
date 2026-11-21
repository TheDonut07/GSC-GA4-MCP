import type { Env } from "./env";

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export function ok(data: unknown): ToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 1);
  return { content: [{ type: "text", text }] };
}

export function fail(err: unknown): ToolResult {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}

export function safe<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A): Promise<ToolResult> => {
    try {
      return ok(await fn(args));
    } catch (e) {
      return fail(e);
    }
  };
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function resolveDate(value: string | undefined, fallbackDaysAgo: number): string {
  const now = new Date();
  const daysAgo = (n: number) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    d.setUTCDate(d.getUTCDate() - n);
    return iso(d);
  };
  if (!value) return daysAgo(fallbackDaysAgo);
  if (value === "today") return daysAgo(0);
  if (value === "yesterday") return daysAgo(1);
  const m = value.match(/^(\d+)daysAgo$/);
  if (m) return daysAgo(Number(m[1]));
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  throw new Error(`Invalid date "${value}". Use YYYY-MM-DD, "today", "yesterday" or "NdaysAgo".`);
}

export function gscSite(env: Env, site: string | undefined): string {
  const s = site || env.DEFAULT_GSC_SITE;
  if (!s) {
    throw new Error(
      "No site given. Pass siteUrl (e.g. \"sc-domain:example.com\" or \"https://www.example.com/\") — use gsc_list_sites to see options.",
    );
  }
  return s;
}

export function ga4Property(env: Env, property: string | undefined): string {
  const p = (property || env.DEFAULT_GA4_PROPERTY || "").replace(/^properties\//, "").trim();
  if (!p) {
    throw new Error(
      "No GA4 property given. Pass propertyId (numeric, e.g. \"123456789\") — use ga4_list_properties to see options.",
    );
  }
  return p;
}

export function flattenGa4Report(r: any) {
  const dims: string[] = (r.dimensionHeaders ?? []).map((h: any) => h.name);
  const mets: string[] = (r.metricHeaders ?? []).map((h: any) => h.name);
  const rows = (r.rows ?? []).map((row: any) => {
    const o: Record<string, string | number> = {};
    dims.forEach((d, i) => (o[d] = row.dimensionValues?.[i]?.value ?? ""));
    mets.forEach((m, i) => {
      const v = row.metricValues?.[i]?.value;
      const n = Number(v);
      o[m] = v !== undefined && v !== "" && !Number.isNaN(n) ? round(n) : (v ?? "");
    });
    return o;
  });
  const totals = r.totals?.[0]?.metricValues
    ? Object.fromEntries(mets.map((m, i) => [m, round(Number(r.totals[0].metricValues[i]?.value))]))
    : undefined;
  return { rowCount: r.rowCount ?? rows.length, rows, ...(totals ? { totals } : {}) };
}

export function round(n: number, dp = 4): number {
  if (!Number.isFinite(n)) return n;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function urlPath(u: string): string {
  try {
    const p = new URL(u).pathname;
    return p.length > 1 ? p.replace(/\/$/, "") : p;
  } catch {
    const p = u.split("?")[0];
    return p.length > 1 ? p.replace(/\/$/, "") : p;
  }
}
