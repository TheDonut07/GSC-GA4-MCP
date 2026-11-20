import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../env";
import { googleFetch } from "../google-api";
import { flattenGa4Report, ga4Property, gscSite, resolveDate, round, safe, urlPath } from "../util";

export function registerCombinedTools(server: McpServer, env: Env) {
  server.registerTool(
    "seo_landing_page_report",
    {
      title: "SEO landing pages (GSC + GA4)",
      description:
        "Joins Search Console page data (clicks, impressions, CTR, position) with GA4 organic-search landing-page data (sessions, engagement rate, key events) by URL path, and flags opportunities: 'striking distance' pages (position 4-20 with many impressions), 'low CTR' pages, and 'low engagement' pages. Use it to decide which pages to optimise.",
      inputSchema: {
        siteUrl: z.string().optional().describe("Search Console property (see gsc_list_sites)."),
        propertyId: z.string().optional().describe("GA4 property ID (see ga4_list_properties)."),
        startDate: z.string().optional().describe('YYYY-MM-DD or "NdaysAgo". Default 30daysAgo.'),
        endDate: z.string().optional().describe('YYYY-MM-DD or "NdaysAgo". Default 3daysAgo (GSC data lag).'),
        pathContains: z.string().optional().describe('Only pages whose URL contains this, e.g. "/blog/".'),
        limit: z.number().int().min(1).max(1000).default(50).describe("Number of pages to return, sorted by GSC impressions."),
      },
      annotations: { readOnlyHint: true },
    },
    safe(async (a) => {
      const site = gscSite(env, a.siteUrl);
      const id = ga4Property(env, a.propertyId);
      const startDate = resolveDate(a.startDate, 30);
      const endDate = resolveDate(a.endDate, 3);

      const gscBody: Record<string, unknown> = {
        startDate,
        endDate,
        dimensions: ["page"],
        rowLimit: 5000,
        ...(a.pathContains
          ? { dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "contains", expression: a.pathContains }] }] }
          : {}),
      };
      const ga4Expressions: any[] = [
        { filter: { fieldName: "sessionDefaultChannelGroup", stringFilter: { matchType: "EXACT", value: "Organic Search" } } },
      ];
      if (a.pathContains) {
        ga4Expressions.push({ filter: { fieldName: "landingPage", stringFilter: { matchType: "CONTAINS", value: a.pathContains } } });
      }

      const [gsc, ga4] = await Promise.all([
        googleFetch(env, `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
          method: "POST",
          body: gscBody,
        }),
        googleFetch(env, `https://analyticsdata.googleapis.com/v1beta/properties/${id}:runReport`, {
          method: "POST",
          body: {
            dateRanges: [{ startDate, endDate }],
            dimensions: [{ name: "landingPage" }],
            metrics: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "engagementRate" }, { name: "keyEvents" }],
            dimensionFilter: { andGroup: { expressions: ga4Expressions } },
            limit: 10000,
          },
        }),
      ]);

      const ga4ByPath = new Map<string, any>();
      for (const r of flattenGa4Report(ga4).rows) {
        const p = urlPath(String(r.landingPage));
        const prev = ga4ByPath.get(p);
        if (prev) {
          prev.sessions += r.sessions as number;
          prev.engagedSessions += r.engagedSessions as number;
          prev.keyEvents += r.keyEvents as number;
        } else {
          ga4ByPath.set(p, { sessions: r.sessions, engagedSessions: r.engagedSessions, keyEvents: r.keyEvents });
        }
      }

      const gscRows = ((gsc.rows ?? []) as any[]).sort((x, y) => y.impressions - x.impressions);
      const avgCtr =
        gscRows.reduce((s, r) => s + r.clicks, 0) / Math.max(1, gscRows.reduce((s, r) => s + r.impressions, 0));
      const medianImpr = gscRows.length ? gscRows[Math.floor(gscRows.length / 2)].impressions : 0;

      const pages = gscRows.slice(0, a.limit).map((r) => {
        const path = urlPath(r.keys[0]);
        const g = ga4ByPath.get(path);
        const engagementRate = g && g.sessions ? round(g.engagedSessions / g.sessions, 3) : null;
        const flags: string[] = [];
        if (r.position >= 4 && r.position <= 20 && r.impressions >= medianImpr) flags.push("striking-distance");
        if (r.position <= 10 && r.impressions >= medianImpr && r.ctr < avgCtr * 0.5) flags.push("low-ctr");
        if (engagementRate !== null && g.sessions >= 10 && engagementRate < 0.4) flags.push("low-engagement");
        if (!g && r.clicks >= 10) flags.push("no-ga4-data (tracking missing on this page?)");
        return {
          page: r.keys[0],
          clicks: r.clicks,
          impressions: r.impressions,
          ctrPct: round(r.ctr * 100, 2),
          position: round(r.position, 1),
          organicSessions: g?.sessions ?? 0,
          engagementRate,
          keyEvents: g?.keyEvents ?? 0,
          flags,
        };
      });

      return {
        site,
        propertyId: id,
        startDate,
        endDate,
        siteAverageCtrPct: round(avgCtr * 100, 2),
        note: "GA4 numbers are Organic Search sessions only (all search engines, not just Google), matched to GSC pages by URL path.",
        pages,
      };
    }),
  );
}
