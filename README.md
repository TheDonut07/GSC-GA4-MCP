# GSC + GA4 MCP Server

A remote MCP server that lets Claude read your **Google Search Console** and **Google Analytics 4** data. It runs on **Cloudflare Workers** and you add it to Claude as a **custom connector**.

- **Read-only.** It uses Google's read-only scopes, so it cannot change, delete or submit anything in GSC or GA4.
- **Your sites only.** It authenticates with one Google *service account* that you add to your own properties.
- **Per-person access.** Each person (you and your colleague) gets their own secret token. You can remove one without affecting the other.

---

## Status

**Live and working.** It's deployed to Cloudflare and connected to Claude, and it returns real Search Console and GA4 data.

| | Status |
|---|---|
| Server built and tested | ✅ Done |
| Google Cloud project, APIs, service account | ✅ Done |
| Service account added to GSC and GA4 | ✅ Done |
| Deployed to Cloudflare, secrets set | ✅ Done |
| Connected to your Claude account | ✅ Done, working |
| Connector added for the other person | ⏳ To do (see Step 6) |
| Default site/property | Optional (see Step 7) |

---

## 1. What was built ✅

| Part | Details |
|---|---|
| Stack | TypeScript + Cloudflare Workers (`wrangler`), official MCP SDK (`@modelcontextprotocol/sdk`), `zod` for input validation |
| MCP endpoint | Streamable HTTP at `/mcp`, with the token in an `Authorization: Bearer <token>` header (how the Claude connector is set up). `/mcp/<token>` also works for clients that can't send headers. |
| Access control | `ACCESS_TOKENS` secret holding `name:token` pairs. Wrong or missing token → `401`. Tokens shorter than 24 characters are ignored. |
| Google auth | Service-account login built with Web Crypto (the `googleapis` package doesn't run on Workers). Access tokens are cached for about an hour. |
| 10 tools | 5 Search Console, 4 GA4, 1 combined (listed below) |
| Usage log | Each tool call is logged as `[name] tool: <tool>` (view it with `npm run tail`). Tokens are never logged. |
| Helpers | `npm run token -- <name>` generates a strong token |
| Tested | Typecheck passes. Locally verified: health check, 401 on a bad token, MCP `initialize`, `tools/list` (all 10 tools), Google key signing. Verified live: real GSC and GA4 data comes back through the Claude connector. |

## 2. Setup steps (Steps 1–5 done, kept here for reference) 📝

Use these steps again if you ever rebuild the server, move it to another Cloudflare account, or replace the Google key.

### Step 1: Create a Google Cloud project and enable the APIs
1. Go to <https://console.cloud.google.com/> and create a project (e.g. `gsc-ga4-mcp`).
2. Under **APIs & Services → Library**, enable all three:
   - **Google Search Console API**
   - **Google Analytics Data API**
   - **Google Analytics Admin API**

### Step 2: Create the service account and download its key
1. Go to **IAM & Admin → Service Accounts → Create service account**. Give it a name such as `mcp-reader`; it needs no roles.
2. Open the account, then go to **Keys → Add key → Create new key → JSON**. A `.json` file downloads.
3. Copy the account's email address. It looks like `mcp-reader@your-project.iam.gserviceaccount.com`.

> ⚠️ This JSON file is a password. Don't email it, commit it, or paste it into chat. Delete it from your Downloads folder after Step 4.

### Step 3: Give the service account access to your sites
- **Search Console:** for each property, go to **Settings → Users and permissions → Add user**, enter the service-account email and choose **Restricted** (read-only).
- **GA4:** for each property, go to **Admin → Property access management → + → Add users**, enter the service-account email and choose the **Viewer** role.

### Step 4: Deploy to Cloudflare
Run these in PowerShell, in this folder:

```powershell
npx wrangler login     # opens the browser; log in to Cloudflare (a free account is fine)
npm run deploy         # prints your URL, e.g. https://gsc-ga4-mcp.<you>.workers.dev

# Upload the Google key (change the path to where your key file is):
Get-Content "C:\path\to\key.json" -Raw | npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON

# Create one token per person:
npm run token -- me
npm run token -- partner

# Upload the tokens (one line, comma between entries, no spaces):
"me:<your-token>,partner:<their-token>" | npx wrangler secret put ACCESS_TOKENS
```

Secrets take effect immediately, with no redeploy. Afterwards, delete the JSON key file or store it somewhere safe, outside this folder.

Check: opening `https://gsc-ga4-mcp.<you>.workers.dev` in a browser should show *"gsc-ga4-mcp is running"*.

### Step 5: Add the connector in Claude
In Claude, go to **Settings → Connectors → Add custom connector**:
- **Name:** `GSC + GA4`
- **URL:** `https://gsc-ga4-mcp.<you>.workers.dev/mcp` (no token in the URL)
- **Authentication:** **No sign-in**
- **Request headers:** add one header named `Authorization` with the value `Bearer <your-token>` (the word `Bearer`, one space, then the token)

Then enable the connector in a chat (via the "+" / tools menu).

> Fallback: if a client can't send headers, use `https://gsc-ga4-mcp.<you>.workers.dev/mcp/<your-token>` as the URL instead. The server accepts both.

### Step 6: The other person
- They need **their own Claude account**. Anthropic's terms don't allow sharing one login.
- Send them the URL and **their own token** through a private channel. They add the connector the same way as in Step 5, with `Bearer <their-token>` as the header value.
- **To remove their access:** run `npx wrangler secret put ACCESS_TOKENS` again without their entry. Access stops immediately; you don't need to redeploy or change anything in Google.

### Step 7 (optional): Set defaults
If you mostly work with one site, set it in `wrangler.jsonc` → `vars` (e.g. `"DEFAULT_GSC_SITE": "sc-domain:example.com"`, `"DEFAULT_GA4_PROPERTY": "123456789"`), then run `npm run deploy` again. Claude can then leave out the site/property.

### Then test it
Ask Claude: *"List my Search Console sites and GA4 properties."* If both lists appear, the setup worked.

---

## 3. What you can do with it 🚀

### The tools

| Tool | What it does |
|---|---|
| `gsc_list_sites` | All Search Console properties the server can access |
| `gsc_search_analytics` | Clicks, impressions, CTR and position by query / page / country / device / date / search appearance, with filters (contains, regex, …) |
| `gsc_compare_periods` | Two periods side by side: biggest winners and losers by query or page |
| `gsc_inspect_url` | Index status of one URL: indexed?, coverage, last crawl, Google's canonical, rich results |
| `gsc_list_sitemaps` | Submitted sitemaps with errors and warnings |
| `ga4_list_properties` | All GA4 accounts and property IDs |
| `ga4_get_metadata` | Available dimensions and metrics, including custom ones |
| `ga4_run_report` | Any GA4 report (users, sessions, engagement, key events, revenue, channels, pages, countries, devices…), with filters, sorting and an optional comparison period |
| `ga4_realtime_report` | Activity on the site in the last 30 minutes |
| `seo_landing_page_report` | **Combines GSC and GA4:** each page's search performance next to its organic engagement, flagging *striking-distance*, *low-CTR*, *low-engagement* and *missing-tracking* pages |

### Example prompts
- "Which 20 queries brought the most clicks last month on example.com?"
- "Compare the last 28 days to the previous 28. Which pages lost the most clicks, and why might that be?"
- "Find keywords where I rank in positions 8–20 with lots of impressions. Those are my quick wins."
- "Which pages have high impressions but a low CTR? Suggest better titles and meta descriptions."
- "Is https://example.com/blog/my-post indexed? When was it last crawled?"
- "Run the SEO landing page report for /blog/ and tell me which 5 posts to improve first."
- "Break down GA4 sessions and key events by channel for this month vs last month."
- "Which countries and devices convert best?"
- "How many people are on the site right now, and on which pages?"
- "Are any of my sitemaps reporting errors?"

### Good to know
- **Search Console data lags 2–3 days**, so GSC tools end at "3 days ago" by default.
- GSC returns at most 25,000 rows per request, and URL Inspection allows about 2,000 calls per site per day.
- In `seo_landing_page_report`, the GA4 numbers are *Organic Search* sessions from all search engines, not just Google. Expect them to differ somewhat from GSC clicks.

---

## 4. Maintenance & security

| Task | How |
|---|---|
| See who used which tool | `npm run tail` (live logs), or Cloudflare dashboard → Workers → gsc-ga4-mcp → Logs |
| Add or remove a person | Edit the list and run `npx wrangler secret put ACCESS_TOKENS` again |
| A token leaked | Generate a new one with `npm run token`, update `ACCESS_TOKENS`, and have the person update the header value in their connector |
| Rotate the Google key | Create a new key in Google Cloud, run `npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON`, then delete the old key |
| Remove all access | Remove the service-account email from GSC and GA4, or run `npx wrangler delete` |
| Cost | Cloudflare Workers' free tier (100k requests/day) is far more than this needs. The Google APIs used are free. |

### When do I need to run `npm run deploy`?

| Change | Redeploy? |
|---|---|
| Code in `src/` changed (e.g. new tools) | ✅ Yes |
| `wrangler.jsonc` changed (e.g. default site/property) | ✅ Yes |
| Secrets changed (`wrangler secret put ...`) | ❌ No, they apply immediately |
| `README.md` or `scripts/` changed | ❌ No, they don't run on the server |

**How the token is sent:** Claude's custom connectors let you add request headers, so each person's token goes in an `Authorization: Bearer <token>` header that Claude stores encrypted. The server also accepts the token in the URL path (`/mcp/<token>`) for clients that can't send headers; if you use that form, treat the URL like a password. If you later want a "Sign in with Google" flow instead, the server can be upgraded to OAuth with Cloudflare's `workers-oauth-provider`.

## 5. Local development

Optional. You only need this to test changes on your own computer before deploying.

```bash
npm install
# Create a file named .dev.vars (it's git-ignored) containing two lines:
#   GOOGLE_SERVICE_ACCOUNT_JSON='<the whole key JSON on one line>'
#   ACCESS_TOKENS="me:<a token from npm run token>"
npm run dev                      # http://localhost:8787/mcp (Authorization: Bearer <token>)
npm run typecheck
```

### Project layout
```
src/
  index.ts           HTTP entry: routing, token auth, MCP transport
  env.ts             Environment/secret types
  google-auth.ts     Service-account JWT → Google access token (Web Crypto)
  google-api.ts      Fetch wrapper with friendly error hints
  util.ts            Dates, defaults, response formatting
  tools/gsc.ts       Search Console tools
  tools/ga4.ts       GA4 tools
  tools/combined.ts  GSC + GA4 combined report
scripts/generate-token.mjs
wrangler.jsonc       Cloudflare config (+ optional default site/property)
```

## 6. Possible next steps
- Add more combined tools, e.g. "content decay" (pages losing clicks *and* engagement) or "query → page cannibalisation".
- Add caching (Cloudflare KV) for repeated reports.
- Replace the tokens with an OAuth ("Sign in with Google") login.
