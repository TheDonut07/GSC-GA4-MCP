# CLAUDE.md

Remote MCP server that gives Claude **read-only** access to Google Search Console (GSC) and Google Analytics 4 (GA4). It runs on Cloudflare Workers and is used as a claude.ai custom connector by the owner and one other person, each with their own Claude account and token. It is **deployed and live**. `README.md` is the user-facing guide; keep it in sync when behaviour or setup changes.

## Commands (Windows, PowerShell)

```powershell
npm run typecheck          # tsc --noEmit; run after every code change
npm run deploy             # wrangler deploy (needed after src/ or wrangler.jsonc changes)
npm run dev                # local server on :8787, needs a .dev.vars file (git-ignored)
npm run tail               # live logs: "[name] tool: <tool>"
npm run token -- <name>    # generate an access token
```

Redeploy only for changes to `src/` or `wrangler.jsonc`. Secrets (`npx wrangler secret put …`) apply immediately. README and `scripts/` changes never need a deploy. Tell the user whether a change needs `npm run deploy`. Don't deploy without asking.

## Architecture

- `src/index.ts`: Worker entry point. Routes `/` and `/health` (plain text), `/mcp` (token in an `Authorization: Bearer` header, which the Claude connector uses) and `/mcp/<token>` (fallback). Token check is SHA-256 + constant-time compare against `ACCESS_TOKENS`. **Stateless:** a new `McpServer` + `WebStandardStreamableHTTPServerTransport` (`sessionIdGenerator: undefined`, `enableJsonResponse: true`) per request.
- `src/google-auth.ts`: service-account JWT (RS256) signed with Web Crypto, exchanged at `oauth2.googleapis.com/token`, token cached in module memory.
- `src/google-api.ts`: `googleFetch()` wrapper; adds friendly hints for 403/404.
- `src/util.ts`: `safe()` (turns thrown errors into `isError` tool results), `resolveDate()`, `gscSite()` / `ga4Property()` (fall back to `DEFAULT_*` vars), `flattenGa4Report()`, `urlPath()`.
- `src/tools/{gsc,ga4,combined}.ts`: `register*Tools(server, env)`; 10 tools in total.
- `src/env.ts`: `Env` type. Secrets: `GOOGLE_SERVICE_ACCOUNT_JSON`, `ACCESS_TOKENS` (`name:token,name:token`, tokens ≥ 24 chars). Vars in `wrangler.jsonc`: `DEFAULT_GSC_SITE`, `DEFAULT_GA4_PROPERTY`.

## Rules

- **Stay read-only.** Scopes are `webmasters.readonly` and `analytics.readonly`. Don't add write scopes or tools that modify GSC/GA4 unless the user explicitly asks.
- **Don't add `googleapis` or other Node-only Google SDKs.** They don't run on Workers. Call the REST APIs through `googleFetch()`.
- **New tools:** use `server.registerTool(name, { title, description, inputSchema: { …zod }, annotations: { readOnlyHint: true } }, safe(async (a) => …))`. Prefix names `gsc_`, `ga4_` or `seo_` (combined). Return compact objects (round numbers, flatten rows), because output goes into Claude's context. Write descriptions that tell Claude when to use the tool and give the defaults. Add every new tool to the tools table in the README.
- GSC data lags 2–3 days, so GSC tools default to ending at `3daysAgo`. GA4 accepts `NdaysAgo` / `today` / `yesterday` natively.
- zod v4 (`import { z } from "zod"`) with `@modelcontextprotocol/sdk` 1.32.x.

## Secrets: never handle them

- Never read, print, log or commit the service-account JSON, `.dev.vars` or any token. Don't ask the user to paste them into chat; give them the command to run themselves (e.g. `Get-Content key.json -Raw | npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON`).
- Logs must only contain the token's *name*, never the token.
- `.gitignore` covers key files, `.dev.vars` and `.env`. Keep it that way.

## Gotchas

- Stopping `wrangler dev` from Git Bash (`taskkill`/`pkill`) has hung before. In PowerShell, use `Get-Process workerd | Stop-Process -Force`.
- To test the auth code without real credentials: generate a throwaway RSA key in Node and call `getGoogleAccessToken`. Google answering "Invalid grant: account not found" means signing works.
- The user isn't a developer. Explain steps in plain language, give copy-paste PowerShell commands, and say whether a redeploy is needed.
