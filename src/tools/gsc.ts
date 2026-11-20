import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../env";
import { googleFetch } from "../google-api";
import { gscSite, resolveDate, round, safe } from "../util";

const WEBMASTERS = "https://www.googleapis.com/webmasters/v3";
const SEARCHCONSOLE = "https://searchconsole.googleapis.com/v1";

const siteUrlArg = z
  .string()
  .optional()
  .describe(
    'Search Console property, exactly as listed by gsc_list_sites, e.g. "sc-domain:example.com" or "https://www.example.com/". Optional if a default site is configured.',
  );

const dateArg = (what: string) =>
  z
    .string()
    .optional()
    .describe(`${what}: YYYY-MM-DD, "today", "yesterday" or "NdaysAgo" (e.g. "30daysAgo").`);

const gscDimension = z.enum(["query", "page", "country", "device", "searchAppearance", "date"]);

const gscFilter = z.object({
  dimension: z.enum(["query", "page", "country", "device", "searchAppearance"]),
  operator: z
    .enum(["contains", "equals", "notContains", "notEquals", "includingRegex", "excludingRegex"])
    .default("contains"),
  expression: z.string().describe("Value to match. Country uses 3-letter ISO codes (e.g. \"usa\"), device is DESKTOP/MOBILE/TABLET."),
});

const searchType = z
  .enum(["web", "image", "video", "news", "discover", "googleNews"])
  .optional()
  .describe("Search type. Default: web.");

async function querySearchAnalytics(
  env: Env,
  site: string,
  body: Record<string, unknown>,
) {
  const res = await googleFetch(env, `${WEBMASTERS}/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
    method: "POST",
    body,
  });
  const dims = (body.dimensions as string[] | undefined) ?? [];
  return ((res.rows ?? []) as any[]).map((r) => {
    const o: Record<string, string | number> = {};
    dims.forEach((d, i) => (o[d] = r.keys?.[i] ?? ""));
    o.clicks = r.clicks;
    o.impressions = r.impressions;
    o.ctrPct = round(r.ctr * 100, 2);
    o.position = round(r.position, 1);
    return o;
  });
}

function filterGroups(filters?: z.infer<typeof gscFilter>[]) {
  return filters && filters.length
    ? [{ groupType: "and", filters: filters.map((f) => ({ dimension: f.dimension, operator: f.operator, expression: f.expression })) }]
    : undefined;
}

export function registerGscTools(server: McpServer, env: Env) {
  server.registerTool(
    "gsc_list_sites",
    {
      title: "List Search Console sites",
      description: "Lists every Google Search Console property this server can access, with the permission level.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    safe(async () => {
      const res = await googleFetch(env, `${WEBMASTERS}/sites`);
      const sites = (res.siteEntry ?? []).map((s: any) => ({ siteUrl: s.siteUrl, permission: s.permissionLevel }));
      return sites.length
        ? { sites, defaultSite: env.DEFAULT_GSC_SITE || null }
        : "No sites found. Add the service account email as a user on each Search Console property (Settings → Users and permissions).";
    }),
  );

  server.registerTool(
    "gsc_search_analytics",
    {
      title: "Search Console performance report",
      description:
        "Queries Google Search Console performance data (clicks, impressions, CTR, average position) grouped by any dimensions: query, page, country, device, searchAppearance, date. Supports filters. Data usually lags 2-3 days. Default range: last 28 days ending 3 days ago.",
      inputSchema: {
        siteUrl: siteUrlArg,
        startDate: dateArg("Start date (default 30daysAgo)"),
        endDate: dateArg("End date (default 3daysAgo)"),
        dimensions: z.array(gscDimension).default(["query"]).describe("Group by these dimensions. Default: [\"query\"]."),
        filters: z.array(gscFilter).optional().describe("Filters, combined with AND."),
        searchType,
        rowLimit: z.number().int().min(1).max(25000).default(100).describe("Max rows (default 100, max 25000)."),
        startRow: z.number().int().min(0).optional().describe("Offset for paging."),
        dataState: z.enum(["final", "all"]).optional().describe('"all" includes fresh, not-yet-final data.'),
      },
      annotations: { readOnlyHint: true },
    },
    safe(async (a) => {
      const site = gscSite(env, a.siteUrl);
      const startDate = resolveDate(a.startDate, 30);
      const endDate = resolveDate(a.endDate, 3);
      const rows = await querySearchAnalytics(env, site, {
        startDate,
        endDate,
        dimensions: a.dimensions,
        type: a.searchType,
        dimensionFilterGroups: filterGroups(a.filters),
        rowLimit: a.rowLimit,
        startRow: a.startRow,
        dataState: a.dataState,
      });
      const totals = await querySearchAnalytics(env, site, {
        startDate,
        endDate,
        type: a.searchType,
        dimensionFilterGroups: filterGroups(a.filters),
      });
      return { site, startDate, endDate, totals: totals[0] ?? null, rowCount: rows.length, rows };
    }),
  );

  server.registerTool(
    "gsc_compare_periods",
    {
      title: "Compare Search Console periods",
      description:
        "Compares two date ranges in Search Console for one dimension (e.g. which queries or pages gained/lost clicks). By default compares the last 28 days (ending 3 days ago) against the 28 days before that. Returns the biggest winners and losers.",
      inputSchema: {
        siteUrl: siteUrlArg,
        dimension: z.enum(["query", "page", "country", "device"]).default("page"),
        startDate: dateArg("Current period start (default 30daysAgo)"),
        endDate: dateArg("Current period end (default 3daysAgo)"),
        compareStartDate: dateArg("Previous period start (default: same length right before current)"),
        compareEndDate: dateArg("Previous period end"),
        filters: z.array(gscFilter).optional(),
        searchType,
        limit: z.number().int().min(1).max(200).default(25).describe("How many winners and how many losers to return."),
      },
      annotations: { readOnlyHint: true },
    },
    safe(async (a) => {
      const site = gscSite(env, a.siteUrl);
      const startDate = resolveDate(a.startDate, 30);
      const endDate = resolveDate(a.endDate, 3);
      const days = Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86400000) + 1;
      const prevEnd = a.compareEndDate
        ? resolveDate(a.compareEndDate, 0)
        : new Date(Date.parse(startDate) - 86400000).toISOString().slice(0, 10);
      const prevStart = a.compareStartDate
        ? resolveDate(a.compareStartDate, 0)
        : new Date(Date.parse(prevEnd) - (days - 1) * 86400000).toISOString().slice(0, 10);

      const base = {
        dimensions: [a.dimension],
        type: a.searchType,
        dimensionFilterGroups: filterGroups(a.filters),
        rowLimit: 5000,
      };
      const [cur, prev] = await Promise.all([
        querySearchAnalytics(env, site, { ...base, startDate, endDate }),
        querySearchAnalytics(env, site, { ...base, startDate: prevStart, endDate: prevEnd }),
      ]);

      const map = new Map<string, any>();
      for (const r of prev) map.set(String(r[a.dimension]), { key: r[a.dimension], prev: r });
      for (const r of cur) {
        const k = String(r[a.dimension]);
        map.set(k, { ...(map.get(k) ?? { key: r[a.dimension] }), cur: r });
      }
      const diffs = [...map.values()].map((e) => {
        const c = e.cur ?? { clicks: 0, impressions: 0, position: null };
        const p = e.prev ?? { clicks: 0, impressions: 0, position: null };
        return {
          [a.dimension]: e.key,
          clicks: c.clicks,
          clicksPrev: p.clicks,
          clicksChange: c.clicks - p.clicks,
          impressions: c.impressions,
          impressionsPrev: p.impressions,
          impressionsChange: c.impressions - p.impressions,
          position: c.position,
          positionPrev: p.position,
        };
      });
      const sorted = [...diffs].sort((x, y) => y.clicksChange - x.clicksChange);
      const sum = (rows: any[], f: string) => rows.reduce((s, r) => s + (r[f] ?? 0), 0);
      return {
        site,
        current: { startDate, endDate, clicks: sum(cur, "clicks"), impressions: sum(cur, "impressions") },
        previous: { startDate: prevStart, endDate: prevEnd, clicks: sum(prev, "clicks"), impressions: sum(prev, "impressions") },
        note: "Totals are summed over the top 5000 rows of each period.",
        winners: sorted.filter((r) => r.clicksChange > 0).slice(0, a.limit),
        losers: sorted.filter((r) => r.clicksChange < 0).reverse().slice(0, a.limit),
      };
    }),
  );

  server.registerTool(
    "gsc_inspect_url",
    {
      title: "Inspect URL (index status)",
      description:
        "Runs Google's URL Inspection for one URL: whether it is indexed, coverage state, last crawl time, canonical chosen by Google, mobile usability and rich results. Quota: ~2000 inspections per site per day.",
      inputSchema: {
        url: z.string().describe("Full URL to inspect; must belong to the site."),
        siteUrl: siteUrlArg,
        languageCode: z.string().optional().describe("e.g. \"en-US\" for messages."),
      },
      annotations: { readOnlyHint: true },
    },
    safe(async (a) => {
      const site = gscSite(env, a.siteUrl);
      const res = await googleFetch(env, `${SEARCHCONSOLE}/urlInspection/index:inspect`, {
        method: "POST",
        body: { inspectionUrl: a.url, siteUrl: site, languageCode: a.languageCode },
      });
      return res.inspectionResult ?? res;
    }),
  );

  server.registerTool(
    "gsc_list_sitemaps",
    {
      title: "List sitemaps",
      description: "Lists sitemaps submitted for a Search Console site, with last download time, warnings and errors.",
      inputSchema: { siteUrl: siteUrlArg },
      annotations: { readOnlyHint: true },
    },
    safe(async (a) => {
      const site = gscSite(env, a.siteUrl);
      const res = await googleFetch(env, `${WEBMASTERS}/sites/${encodeURIComponent(site)}/sitemaps`);
      return (res.sitemap ?? []).map((s: any) => ({
        path: s.path,
        type: s.type,
        lastSubmitted: s.lastSubmitted,
        lastDownloaded: s.lastDownloaded,
        isPending: s.isPending,
        warnings: s.warnings,
        errors: s.errors,
        contents: s.contents,
      }));
    }),
  );
}
