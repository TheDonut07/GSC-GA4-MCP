# GSC + GA4 MCP Server

A remote MCP server that lets Claude read your **Google Search Console** and **Google Analytics 4** data. It runs on **Cloudflare Workers** (free plan), and you add it to Claude as a **custom connector**.

- **Read-only.** It uses Google's read-only scopes, so it cannot change, delete or submit anything in GSC or GA4.
- **Your own copy.** You deploy it on your own Cloudflare account with your own Google key. Nobody else, can see your data.
- **Per-person access.** Every person who uses it gets their own secret token. You can remove one person without affecting anyone else.
- **Nothing to install.** Everything is done in your web browser. The only extra step is one copy-paste line to create a password-like token.

---

## Contents

- [What you need](#what-you-need)
- [Overview: the 5 stages](#overview-the-5-stages)
- [Stage A: Set up Google Cloud](#stage-a-set-up-google-cloud)
- [Stage B: Give the service account access to your sites](#stage-b-give-the-service-account-access-to-your-sites)
- [Stage C: Create your access token(s)](#stage-c-create-your-access-tokens)
- [Stage D: Deploy to Cloudflare](#stage-d-deploy-to-cloudflare)
- [Stage E: Connect it to Claude](#stage-e-connect-it-to-claude)
- [What you can do with it](#what-you-can-do-with-it)
- [Managing your server](#managing-your-server)
- [Troubleshooting](#troubleshooting)
- [For developers (command line)](#for-developers-command-line)

---

## What you need

Four free accounts. You probably have some of them already.

| Account | Why | Sign up |
|---|---|---|
| **Google account** | The one that already has access to your Search Console and GA4 properties | – |
| **Google Cloud** | To create the "robot" account (service account) that reads your data | <https://console.cloud.google.com/> (free; no billing needed for these APIs) |
| **GitHub** | Cloudflare deploys the code from your own copy of this repo | <https://github.com/signup> |
| **Cloudflare** | Hosts the server | <https://dash.cloudflare.com/sign-up> (the free plan is plenty) |
| **Claude** | Paid plan that supports custom connectors | <https://claude.ai> |

Time needed: about 20–30 minutes.

---

## Overview: the 5 stages

| Stage | What you do | Where |
|---|---|---|
| **A** | Create a Google Cloud project, turn on 3 APIs, create a service account and download its key | Google Cloud |
| **B** | Add the service account as a user in Search Console and GA4 | Search Console, GA4 |
| **C** | Create a secret access token for each person | Your computer (one copy-paste line) |
| **D** | Copy this repo to your GitHub, deploy it on Cloudflare, add the key and tokens as secrets | GitHub, Cloudflare |
| **E** | Add the server to Claude as a custom connector and test it | Claude |

Keep a private note (for example in a password manager) open while you work. You'll collect three things along the way: the **service-account email**, your **token**, and your **server URL**.

---

## Stage A: Set up Google Cloud

### A1. Create a project
1. Go to <https://console.cloud.google.com/> and sign in.
2. Click the project picker at the top of the page, then **New project**.
3. Name it, for example `gsc-ga4-mcp`, and click **Create**. Make sure the new project is selected in the project picker before you continue.

### A2. Turn on the three APIs
1. In the left menu, go to **APIs & Services → Library**.
2. Search for each of these, open it, and click **Enable**:
   - **Google Search Console API**
   - **Google Analytics Data API**
   - **Google Analytics Admin API**

### A3. Create the service account
A service account is a "robot" Google account. The server logs in as this robot, so it only sees what you share with it.

1. In the left menu, go to **IAM & Admin → Service Accounts**.
2. Click **+ Create service account**.
3. Give it a name, for example `mcp-reader`, and click **Create and continue**.
4. It needs **no roles**. Skip the optional steps and click **Done**.
5. Copy the account's email address from the list. It looks like `mcp-reader@your-project.iam.gserviceaccount.com`. Save it in your note.

### A4. Download its key
1. Click the service account you just made.
2. Open the **Keys** tab, then **Add key → Create new key → JSON → Create**.
3. A `.json` file downloads to your computer. You'll need it in Stage D.

> ⚠️ **This JSON file is a password.** Don't email it, upload it to GitHub, or paste it into a chat. After Stage D, delete it or move it somewhere safe.

> If Google says *"Service account key creation is disabled"*, your Google Cloud organisation blocks keys. Ask your Workspace admin to allow it for this project, or use a project under a personal Google account.

---

## Stage B: Give the service account access to your sites

Do this for **every** site and GA4 property you want Claude to see.

### Search Console
1. Open <https://search.google.com/search-console> and select the property.
2. Go to **Settings → Users and permissions → Add user**.
3. Paste the service-account email, choose **Restricted** (read-only), and click **Add**.

### Google Analytics 4
1. Open <https://analytics.google.com> and select the property.
2. Click **Admin** (gear icon, bottom left) → **Property access management**.
3. Click **+** → **Add users**, paste the service-account email, choose the **Viewer** role, untick "Notify new users by email", and click **Add**.

It can take a few minutes for new access to start working.

---

## Stage C: Create your access token(s)

The token is a long random password. Claude sends it with every request, and the server refuses anyone without a valid one. Make **one token per person** who will use the server.

**On Windows:** open the Start menu, type **PowerShell**, open it, paste this line, and press Enter:

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') })
```

**On Mac:** open **Terminal** (Applications → Utilities), paste this line, and press Enter:

```bash
openssl rand -hex 32
```

Either one prints a 64-character string of letters and numbers, like `3f9a…c71e`. That's your token. Run it again for each extra person.

Now give each token a short name (letters, numbers, `-` or `_`) and write them in this format, **all on one line, separated by commas, with no spaces**:

```
me:3f9a...c71e,alex:8b20...4d9f
```

This whole line is your **ACCESS_TOKENS** value for Stage D. The names only show up in your server logs so you can see who used it.

> Rules: tokens must be at least 24 characters long (shorter ones are ignored), and must not contain `:` or `,`. You can also use a password manager to generate them, as long as you follow these rules.

---

## Stage D: Deploy to Cloudflare

### D1. Copy this repo to your GitHub account
1. Sign in to GitHub and open this repo's page.
2. Click **Fork** (top right) → **Create fork**.

You now have your own copy at `github.com/<your-username>/GSC-GA4-MCP`. It's fine for it to be public, because it contains no keys or tokens. Those go into Cloudflare as secrets in D3.

### D2. Create the Worker from your copy
1. Sign in to <https://dash.cloudflare.com>.
2. In the left menu, go to **Compute (Workers) → Workers & Pages**, then click **Create application**.
3. Choose **Import a repository** (or **Continue with GitHub**). Allow Cloudflare to access your GitHub account; you can limit it to just the `GSC-GA4-MCP` repo.
4. Select your `GSC-GA4-MCP` repo and fill in:
   - **Project name:** `gsc-ga4-mcp` (this becomes part of your URL)
   - **Build command:** leave empty
   - **Deploy command:** `npm run deploy` (or `npx wrangler deploy`, both work)
5. Click **Create and deploy** and wait for the build to finish (1–2 minutes).
6. If this is your first Worker, Cloudflare may ask you to pick a **workers.dev subdomain**. Choose any name.

When it's done, Cloudflare shows your server URL, like:

```
https://gsc-ga4-mcp.<your-subdomain>.workers.dev
```

Save it in your note.

### D3. Add the two secrets
The server is running but doesn't have your Google key or tokens yet.

1. In the Cloudflare dashboard, open your Worker (**Workers & Pages → gsc-ga4-mcp**).
2. Go to **Settings → Variables and Secrets** and click **+ Add**.
3. Add the first secret:
   - **Type:** Secret
   - **Variable name:** `GOOGLE_SERVICE_ACCOUNT_JSON`
   - **Value:** open the `.json` key file from Stage A4 in Notepad (Windows) or TextEdit (Mac), select **everything** (Ctrl+A / Cmd+A), copy it, and paste it here. Include the `{` at the start and the `}` at the end.
4. Click **+ Add** again for the second secret:
   - **Type:** Secret
   - **Variable name:** `ACCESS_TOKENS`
   - **Value:** the one-line list from Stage C, for example `me:3f9a...c71e,alex:8b20...4d9f`
5. Click **Deploy** (or **Save**) to apply them.

The names must be typed **exactly** as shown, in capitals. Once saved, Cloudflare hides secret values; nobody can read them back, including you.

Now delete the `.json` key file from your Downloads folder, or move it somewhere safe.

### D4. Check it's running
Open your server URL in a browser. You should see a line starting with:

```
gsc-ga4-mcp is running.
```

---

## Stage E: Connect it to Claude

### E1. Add the connector
1. In Claude, go to **Settings → Connectors → Add custom connector**.
2. Fill in:
   - **Name:** `GSC + GA4`
   - **URL:** your server URL with `/mcp` added at the end, for example `https://gsc-ga4-mcp.<your-subdomain>.workers.dev/mcp`
   - **Authentication:** **No sign-in**
   - **Request headers:** add one header
     - **Name:** `Authorization`
     - **Value:** `Bearer <your-token>`: the word `Bearer`, one space, then **only your token** (not the `me:` part)
3. Save it.

> **Fallback:** if a client can't send headers, use `https://gsc-ga4-mcp.<your-subdomain>.workers.dev/mcp/<your-token>` as the URL instead. If you do, treat that URL like a password.

### E2. Turn it on in a chat
Start a new chat, open the **+** / tools menu, and enable **GSC + GA4**.

### E3. Test it
Ask Claude:

> *"List my Search Console sites and GA4 properties."*

If both lists appear, you're done. 🎉 If something goes wrong, see [Troubleshooting](#troubleshooting).

### E4 (optional): Set a default site and property
If you mostly use one site, you can make it the default so you don't have to name it every time.

1. On GitHub, open **your** copy of the repo and click the file `wrangler.jsonc`.
2. Click the ✏️ pencil icon to edit it, and fill in the two values under `"vars"`:
   ```jsonc
   "DEFAULT_GSC_SITE": "sc-domain:example.com",
   "DEFAULT_GA4_PROPERTY": "123456789"
   ```
   - For a **domain** property in Search Console, use `sc-domain:example.com`. For a **URL-prefix** property, use the full URL with a trailing slash, e.g. `https://www.example.com/`.
   - The GA4 property ID is the number shown in **GA4 → Admin → Property details**. You can also ask Claude to "list my GA4 properties".
3. Click **Commit changes**. Cloudflare notices the change and redeploys by itself within a minute or two. You can watch it under your Worker → **Deployments**.

---

## What you can do with it

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

## Managing your server

Everything here is done in the Cloudflare dashboard under **Workers & Pages → gsc-ga4-mcp**, unless noted.

| Task | How |
|---|---|
| **Add a person** | Make a token for them (Stage C). Go to **Settings → Variables and Secrets**, edit `ACCESS_TOKENS`, add `,name:token` to the end of the list, and save. Then send them the URL and token. |
| **Remove a person** | Edit `ACCESS_TOKENS` and delete their `name:token` entry (and the comma before it). Their access stops immediately. |
| **A token leaked** | Make a new token, replace the old one in `ACCESS_TOKENS`, and have that person update the header value in their Claude connector. |
| **Add another site** | Add the service-account email to that GSC/GA4 property (Stage B). Nothing changes on Cloudflare. |
| **Replace the Google key** | In Google Cloud, create a new JSON key (Stage A4). Replace the `GOOGLE_SERVICE_ACCOUNT_JSON` secret with its contents, then delete the old key in Google Cloud (**Keys** tab → 🗑️). |
| **See who used which tool** | Your Worker → **Logs** (or **Observability**). Each call is logged as `[name] tool: <tool>`. Tokens are never logged. |
| **Get updates from this repo** | On your GitHub copy, click **Sync fork → Update branch**. Cloudflare redeploys automatically. |
| **Shut it all down** | Remove the service-account email from GSC and GA4, and/or delete the Worker in Cloudflare (**Settings → Delete**). |
| **Cost** | The Cloudflare Workers free plan (100,000 requests/day) is far more than this needs. The Google APIs used are free. |

Secret changes apply right away. Code or `wrangler.jsonc` changes redeploy automatically when you commit them on GitHub.

---

## Troubleshooting

| Problem | Likely cause and fix |
|---|---|
| The server URL doesn't show *"gsc-ga4-mcp is running"* | The deploy failed or is still running. Check your Worker → **Deployments** for errors, and try **Retry build**. |
| Claude can't connect, or you get **401 Unauthorized** | The token is wrong. Check that the header name is exactly `Authorization`, the value is `Bearer ` + token with one space, you used only the token (not `me:`), and the token is in `ACCESS_TOKENS`. |
| **403** / *"permission denied"* / a site is missing from the list | The service account wasn't added to that GSC or GA4 property (Stage B), or it was added a few minutes ago. Double-check the email address. |
| *"API has not been used in project… or it is disabled"* | One of the three APIs isn't enabled (Stage A2), or it was enabled in a different project from the service account. |
| *"GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON"* / *"is missing client_email or private_key"* / *"invalid_grant"* | The key secret is incomplete or the key was deleted. Copy the whole file again, from `{` to `}`, and replace the secret. Check the key still exists in Google Cloud (**Keys** tab). |
| *"GOOGLE_SERVICE_ACCOUNT_JSON secret is not set"*, or every token gets 401 | A secret name is misspelt or the secret wasn't saved. The names must be exactly `GOOGLE_SERVICE_ACCOUNT_JSON` and `ACCESS_TOKENS`. |
| Search Console numbers look low for recent days | Normal. GSC data lags 2–3 days. |
| GSC and GA4 numbers don't match | Normal. GSC counts Google clicks; GA4 counts sessions from all search engines, and some visitors block analytics. |
| Tools don't appear in Claude | Enable the connector in the chat's **+** / tools menu, or remove and re-add the connector. |

---

## For developers (command line)

You don't need this section if you followed Stages A–E. It's for running the server on your own computer, or deploying from the command line instead of through GitHub. You'll need [Node.js](https://nodejs.org/) 20 or newer.

### How it works

| Part | Details |
|---|---|
| Stack | TypeScript + Cloudflare Workers (`wrangler`), official MCP SDK (`@modelcontextprotocol/sdk`), `zod` for input validation |
| MCP endpoint | Streamable HTTP at `/mcp`, with the token in an `Authorization: Bearer <token>` header. `/mcp/<token>` also works for clients that can't send headers. Stateless: a fresh MCP server per request. |
| Access control | `ACCESS_TOKENS` secret holding `name:token` pairs, checked with SHA-256 and a constant-time compare. Wrong or missing token → `401`. Tokens shorter than 24 characters are ignored. |
| Google auth | Service-account login built with Web Crypto (the `googleapis` package doesn't run on Workers). Google access tokens are cached for about an hour. |
| Usage log | Each tool call is logged as `[name] tool: <tool>`. Tokens are never logged. |

### Deploy from the command line

```powershell
npm install
npx wrangler login     # opens the browser; log in to Cloudflare
npm run deploy         # prints your URL

# Upload the Google key (change the path to where your key file is):
Get-Content "C:\path\to\key.json" -Raw | npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON

# Create a token per person:
npm run token -- me

# Upload the tokens (one line, comma between entries, no spaces):
"me:<your-token>,alex:<their-token>" | npx wrangler secret put ACCESS_TOKENS
```

On Mac/Linux, use `cat key.json | npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON` and `echo "me:…" | npx wrangler secret put ACCESS_TOKENS`.

### Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Local server on `http://localhost:8787/mcp` (needs a `.dev.vars` file, see below) |
| `npm run typecheck` | Type-check the code |
| `npm run deploy` | Deploy to Cloudflare |
| `npm run tail` | Live logs |
| `npm run token -- <name>` | Generate a token |

For local development, create a file named `.dev.vars` in the project folder (it's git-ignored, never commit it) with two lines:

```
GOOGLE_SERVICE_ACCOUNT_JSON='<the whole key JSON on one line>'
ACCESS_TOKENS="me:<a token>"
```

### When is a redeploy needed?

| Change | Redeploy? |
|---|---|
| Code in `src/` changed | ✅ Yes (automatic if deployed from GitHub) |
| `wrangler.jsonc` changed | ✅ Yes (automatic if deployed from GitHub) |
| Secrets changed | ❌ No, they apply immediately |
| `README.md` or `scripts/` changed | ❌ No, they don't run on the server |

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
