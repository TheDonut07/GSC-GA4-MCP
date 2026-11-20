import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../env";
import { googleFetch } from "../google-api";
import { flattenGa4Report, ga4Property, safe } from "../util";

const DATA = "https://analyticsdata.googleapis.com/v1beta";
const ADMIN = "https://analyticsadmin.googleapis.com/v1beta";

const propertyArg = z
  .string()
  .optional()
  .describe('GA4 property ID (numeric, e.g. "123456789"). Optional if a default property is configured. Use ga4_list_properties to find it.');

const ga4Date = (what: string) =>
  z
    .string()
    .optional()
    .describe(`${what}: YYYY-MM-DD, "today", "yesterday" or "NdaysAgo".`);

export const ga4Filter = z.object({
  fieldName: z.string().describe('Dimension to filter on, e.g. "sessionDefaultChannelGroup", "pagePath", "country".'),
  matchType: z
    .enum(["EXACT", "BEGINS_WITH", "ENDS_WITH", "CONTAINS", "FULL_REGEXP", "PARTIAL_REGEXP"])
    .default("EXACT"),
  value: z.string(),
  not: z.boolean().optional().describe("Set true to exclude matches."),
});

export function buildDimensionFilter(filters?: z.infer<typeof ga4Filter>[]) {
  if (!filters || !filters.length) return undefined;
  return {
    andGroup: {
      expressions: filters.map((f) => {
        const expr = {
          filter: { fieldName: f.fieldName, stringFilter: { matchType: f.matchType, value: f.value, caseSensitive: false } },
        };
        return f.not ? { notExpression: expr } : expr;
      }),
    },
  };
}

export function registerGa4Tools(server: McpServer, env: Env) {
  server.registerTool(
    "ga4_list_properties",
    {
      title: "List GA4 properties",
      description: "Lists every GA4 account and property this server can access (property IDs are needed for reports).",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    safe(async () => {
      const res = await googleFetch(env, `${ADMIN}/accountSummaries?pageSize=200`);
      const accounts = (res.accountSummaries ?? []).map((a: any) => ({
        account: a.displayName,
        accountId: a.account?.replace("accounts/", ""),
        properties: (a.propertySummaries ?? []).map((p: any) => ({
          propertyId: p.property?.replace("properties/", ""),
          name: p.displayName,
        })),
      }));
      return accounts.length
        ? { accounts, defaultProperty: env.DEFAULT_GA4_PROPERTY || null }
        : "No GA4 properties found. Add the service account email as a Viewer in GA4 (Admin → Property access management).";
    }),
  );

  server.registerTool(
    "ga4_get_metadata",
    {
      title: "GA4 dimensions & metrics",
      description:
        "Lists the dimension and metric API names available for a GA4 property (including custom ones). Use it to find the right names before running ga4_run_report.",
      inputSchema: {
        propertyId: propertyArg,
        search: z.string().optional().describe('Only return names containing this text, e.g. "page" or "conversion".'),
        customOnly: z.boolean().optional().describe("Only custom dimensions/metrics."),
      },
      annotations: { readOnlyHint: true },
    },
    safe(async (a) => {
      const id = ga4Property(env, a.propertyId);
      const res = await googleFetch(env, `${DATA}/properties/${id}/metadata`);
      const q = a.search?.toLowerCase();
      const keep = (x: any) =>
        (!q || x.apiName.toLowerCase().includes(q) || (x.uiName ?? "").toLowerCase().includes(q)) &&
        (!a.customOnly || x.customDefinition);
      const pick = (x: any) => ({ apiName: x.apiName, uiName: x.uiName, category: x.category });
      return {
        dimensions: (res.dimensions ?? []).filter(keep).map(pick),
        metrics: (res.metrics ?? []).filter(keep).map(pick),
      };
    }),
  );

  server.registerTool(
    "ga4_run_report",
    {
      title: "GA4 report",
      description:
        "Runs a Google Analytics 4 report with any dimensions and metrics. Common metrics: activeUsers, newUsers, sessions, engagedSessions, engagementRate, averageSessionDuration, screenPageViews, keyEvents, conversions, totalRevenue, bounceRate. Common dimensions: date, pagePath, landingPage, sessionDefaultChannelGroup, sessionSource, sessionMedium, sessionCampaignName, country, city, deviceCategory, eventName. Optionally compares with a second date range.",
      inputSchema: {
        propertyId: propertyArg,
        startDate: ga4Date("Start date (default 28daysAgo)"),
        endDate: ga4Date("End date (default yesterday)"),
        compareStartDate: ga4Date("Optional comparison period start"),
        compareEndDate: ga4Date("Optional comparison period end"),
        dimensions: z.array(z.string()).max(9).default([]).describe('Dimension API names, e.g. ["sessionDefaultChannelGroup"].'),
        metrics: z.array(z.string()).min(1).max(10).default(["activeUsers", "sessions"]).describe('Metric API names, e.g. ["sessions","keyEvents"].'),
        filters: z.array(ga4Filter).optional().describe("Dimension filters, combined with AND."),
        orderBy: z.string().optional().describe("Metric or dimension name to sort by. Default: first metric."),
        ascending: z.boolean().optional().describe("Sort ascending instead of descending."),
        limit: z.number().int().min(1).max(10000).default(100),
        offset: z.number().int().min(0).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    safe(async (a) => {
      const id = ga4Property(env, a.propertyId);
      const dateRanges = [{ startDate: a.startDate ?? "28daysAgo", endDate: a.endDate ?? "yesterday", name: "current" }];
      if (a.compareStartDate && a.compareEndDate) {
        dateRanges.push({ startDate: a.compareStartDate, endDate: a.compareEndDate, name: "previous" });
      }
      const orderField = a.orderBy ?? a.metrics[0];
      const orderBys = a.metrics.includes(orderField)
        ? [{ metric: { metricName: orderField }, desc: !a.ascending }]
        : [{ dimension: { dimensionName: orderField }, desc: !a.ascending }];
      const res = await googleFetch(env, `${DATA}/properties/${id}:runReport`, {
        method: "POST",
        body: {
          dateRanges,
          dimensions: a.dimensions.map((name) => ({ name })),
          metrics: a.metrics.map((name) => ({ name })),
          dimensionFilter: buildDimensionFilter(a.filters),
          orderBys,
          limit: a.limit,
          offset: a.offset,
          metricAggregations: ["TOTAL"],
        },
      });
      return { propertyId: id, dateRanges, ...flattenGa4Report(res) };
    }),
  );

  server.registerTool(
    "ga4_realtime_report",
    {
      title: "GA4 realtime",
      description:
        "Shows what is happening on the site right now (last 30 minutes). Useful dimensions: unifiedScreenName, country, city, deviceCategory, eventName. Metrics: activeUsers, eventCount, screenPageViews, keyEvents.",
      inputSchema: {
        propertyId: propertyArg,
        dimensions: z.array(z.string()).max(4).default([]),
        metrics: z.array(z.string()).min(1).max(5).default(["activeUsers"]),
        limit: z.number().int().min(1).max(1000).default(50),
      },
      annotations: { readOnlyHint: true },
    },
    safe(async (a) => {
      const id = ga4Property(env, a.propertyId);
      const res = await googleFetch(env, `${DATA}/properties/${id}:runRealtimeReport`, {
        method: "POST",
        body: {
          dimensions: a.dimensions.map((name) => ({ name })),
          metrics: a.metrics.map((name) => ({ name })),
          limit: a.limit,
          metricAggregations: ["TOTAL"],
        },
      });
      return { propertyId: id, window: "last 30 minutes", ...flattenGa4Report(res) };
    }),
  );
}
