import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Env } from "./env";
import { registerGscTools } from "./tools/gsc";
import { registerGa4Tools } from "./tools/ga4";
import { registerCombinedTools } from "./tools/combined";

const SERVER_INFO = { name: "gsc-ga4-mcp", version: "1.0.0" };

function buildServer(env: Env): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      "Read-only access to Google Search Console and Google Analytics 4 for the owner's sites. " +
      "Start with gsc_list_sites / ga4_list_properties if you don't know the site URL or property ID. " +
      "Search Console data lags 2-3 days. Use seo_landing_page_report to combine both sources.",
  });
  registerGscTools(server, env);
  registerGa4Tools(server, env);
  registerCombinedTools(server, env);
  return server;
}

async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function authenticate(token: string | null, env: Env): Promise<string | null> {
  if (!token || !env.ACCESS_TOKENS) return null;
  let match: string | null = null;
  for (const entry of env.ACCESS_TOKENS.split(",")) {
    const [name, secret] = entry.trim().split(":");
    if (!name || !secret || secret.length < 24) continue;
    if (await sameSecret(token, secret)) match = name;
  }
  return match;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("gsc-ga4-mcp is running. MCP endpoint: /mcp/<your-token>\n", {
        headers: { "content-type": "text/plain" },
      });
    }

    let token: string | null = null;
    const m = url.pathname.match(/^\/mcp\/([^/]+)\/?$/);
    if (m) {
      token = decodeURIComponent(m[1]);
    } else if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
      const h = request.headers.get("authorization");
      token = h?.startsWith("Bearer ") ? h.slice(7).trim() : null;
    } else {
      return new Response("Not found", { status: 404 });
    }

    const user = await authenticate(token, env);
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    if (request.method === "POST") {
      try {
        const body = await request.clone().json<any>();
        const msgs = Array.isArray(body) ? body : [body];
        for (const msg of msgs) {
          if (msg?.method === "tools/call") console.log(`[${user}] tool: ${msg.params?.name}`);
        }
      } catch {}
    }

    const server = buildServer(env);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
} satisfies ExportedHandler<Env>;
