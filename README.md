# wanderlog-mcp

[![npm](https://img.shields.io/npm/v/wanderlog-mcp)](https://www.npmjs.com/package/wanderlog-mcp)
[![npm downloads](https://img.shields.io/npm/dm/wanderlog-mcp)](https://www.npmjs.com/package/wanderlog-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org/)

An MCP server that lets Claude (or any MCP-compatible agent) view and build [Wanderlog](https://wanderlog.com) trip itineraries through conversation.

Instead of clicking through the Wanderlog UI to plan a trip, you just ask:

> *"Create a 14-day Japan Golden Route trip — Tokyo, Hakone, Kyoto, Nara, and Osaka."*

The agent calls the tools, interleaves places and notes for each day, adds hotel blocks and checklists, and you end up with a fully populated Wanderlog trip in a few minutes.

**See a real example:** [14-day Japan Golden Route](https://wanderlog.com/view/dmvegdhqsa/japan-golden-route--tokyo--hakone--kyoto--nara--osaka) — built entirely by an AI agent using this MCP server.

## What's New in v0.5.0

- **Note editing fixed** — `wanderlog_annotate_place` now properly replaces a place's inline note instead of prepending to it. Calling it twice no longer duplicates the text.
- **Cleaner tool split** — `wanderlog_annotate_place` is now the single tool for editing a place's note or times. `wanderlog_edit_note` handles standalone note blocks (added by `add_note`) only — no more ambiguity about which tool to call.
- **Renamed `wanderlog_remove_place` → `wanderlog_remove`** — removes any block (place, hotel, flight, train) by natural-language reference. The old name implied it only worked on places.
- **Renamed `wanderlog_move_place` → `wanderlog_move`** — same reason. Moves or copies any block to a different day, list, or position.
- **`wanderlog_get_trip` now includes the shareable link** — the edit URL is appended to every `get_trip` response. `wanderlog_get_trip_url` has been removed as a separate tool.
- **`wanderlog_search_places` description fixed** — the previous description incorrectly said to use place_ids with downstream tools. `wanderlog_add_place` does its own lookup and never needed a place_id.

## What's New in v0.4.0

- `wanderlog_move_place` — move or copy a place to a different day, list, or position. Supports same-section reordering, cross-section moves, and copying a place to multiple lists. Natural-language references throughout: `"move the Louvre to day 3"`, `"copy Sensō-ji to my Temples list"`, `"put it after the museum"`.
- `wanderlog_add_flight` — add a flight block (airline, flight number, airports, dates, times, confirmation number, passenger names). All fields optional — add what you know. Requires a flights section in the trip (create it in the Wanderlog app first).
- `wanderlog_add_train` — add a train block (carrier, stations, dates, times, confirmation number). Same pattern as `add_flight`. Requires a transit section.
- Enhanced `wanderlog_add_hotel` — now accepts `check_in_time` (e.g. `"15:00"`), `check_out_time`, `confirmation_number`, and `traveler_names`. Previously these were hardcoded empty.

## What's New in v0.3.0

- `wanderlog_edit_note` — edit or clear standalone note blocks (`note_ref: "1st note on day 3"`). Standalone notes had no edit path before this. (As of v0.5.0, inline place notes are edited via `wanderlog_annotate_place`.)
- **Cloudflare Workers deployment** — self-host on Cloudflare's free tier (100k req/day, always-on) and connect from Claude.ai, Cursor, or any HTTP MCP client without running anything locally. See [Hosted deployment (Cloudflare Workers)](#hosted-deployment-cloudflare-workers) below.
- Custom list support in `wanderlog_add_place` — add places directly to user-created lists like "Coffee places" or "Beer places" using the `list` parameter.

## What's New in v0.2.0

- `wanderlog_rename_day` — replace auto-generated day headings (e.g. `"Barcelona"`) with descriptive ones (`"Arrival — Feria de Abril"`). Pass `""` to reset back to the default.
- Tools table now documents `wanderlog_annotate_place` and `wanderlog_add_expense` (shipped previously, missing from v0.1.0 docs).

## What's New in v0.1.0

- Full itinerary building: places, notes, hotels, and checklists in a single conversation
- `wanderlog_search_places` — find real-world places near any destination using Wanderlog's place database
- `wanderlog_add_note` — interleave transit tips, booking info, and local advice between places
- `wanderlog_add_checklist` — pre-trip and per-day checklists (visa, currency, timed-entry tickets)
- MCP server instructions injected at startup so Claude builds complete itineraries automatically
- Startup auth probe — catches expired cookies immediately instead of failing mid-conversation

## Example Prompts

```
"What trips do I have in Wanderlog?"
```
```
"Create a 7-day itinerary for Lisbon starting June 1 — include restaurants, day trips,
and a hotel near the waterfront."
```
```
"Add a day trip to Sintra on day 3 of my Lisbon trip."
```
```
"I'm spending 5 days in Tokyo — build me a full itinerary with museum visits, ramen spots,
and a ryokan in Shinjuku."
```
```
"Look at my Barcelona trip and add practical notes for getting between each place."
```
```
"Add a pre-trip checklist to my Paris trip — visa, currency, offline maps, travel insurance."
```
```
"Move my Rome trip back by two weeks."
```
```
"Show me my Kyoto itinerary." (includes the shareable link)
```
```
"Remove the Colosseum from day 2 of my Rome trip."
```
```
"Update the note on Sensō-ji in my Japan trip — add that you need to arrive before 9am."
```
```
"The transit note on day 3 of my Lisbon trip is wrong — change it to 'Take tram 28 from Alfama'."
```
```
"Move the Uffizi Gallery to day 2 of my Florence trip, put it after lunch."
```
```
"Copy Tsukiji Market to both my Food list and day 1 of my Tokyo trip."
```
```
"Add my Singapore Airlines flight SQ 321 — departs SIN at 09:00 on May 15, arrives NRT at 17:30."
```
```
"Add my Eurostar — London St Pancras to Paris Gare du Nord, May 10 at 07:30."
```
```
"Add my Park Hyatt Tokyo booking — check-in May 15 at 3pm, check-out May 18 at 11am, confirmation ABC123."
```

## Tools

| Tool | What it does |
|---|---|
| `wanderlog_list_trips` | List trips in your account |
| `wanderlog_get_trip` | View a full itinerary (or filter to a single day) — includes the shareable link |
| `wanderlog_search_places` | Browse real-world places near a trip's destination before committing |
| `wanderlog_create_trip` | Create a new trip with destination + date range |
| `wanderlog_add_place` | Add a place to a specific day or general list |
| `wanderlog_add_note` | Add a standalone note (transit tips, booking info, local advice) between places |
| `wanderlog_add_hotel` | Add a hotel booking with check-in/check-out dates, times, confirmation number, and guest names |
| `wanderlog_add_flight` | Add a flight block (airline, airports, times, confirmation, passengers) |
| `wanderlog_add_train` | Add a train block (carrier, stations, times, confirmation, passengers) |
| `wanderlog_add_checklist` | Add a pre-trip or per-day checklist |
| `wanderlog_add_expense` | Log a budget expense (amount, category, currency) linked to a place |
| `wanderlog_annotate_place` | Set or replace the inline note, start/end time, or both on an existing place |
| `wanderlog_edit_note` | Edit or clear a standalone note block (added by `add_note`) |
| `wanderlog_move` | Move or copy any block (place, hotel, flight, train) to a different day, list, or position |
| `wanderlog_remove` | Remove any block (place, hotel, flight, train) by natural-language reference |
| `wanderlog_update_trip_dates` | Change a trip's date range |
| `wanderlog_rename_day` | Rename a day's heading (e.g. `"Barcelona"` → `"Arrival — Feria de Abril"`) |

## Prerequisites

- **A [Wanderlog](https://wanderlog.com) account**
- **Node.js 22+** — only needed for local (stdio) setup; not required for Cloudflare Workers deployment
- An MCP-compatible client: Claude.ai, Claude Code, Claude Desktop, Cursor, VS Code, OpenAI Codex, or any stdio/HTTP MCP host

## Setup

### Step 1 — Get your Wanderlog session cookie

Wanderlog doesn't have a public API, so wanderlog-mcp authenticates using your browser session cookie (`connect.sid`). It's valid for roughly a year and never leaves your machine.

**Treat it like a password** — it grants the same access you have in the Wanderlog UI.

#### Chrome / Edge

1. Go to [wanderlog.com](https://wanderlog.com) and log in
2. Press `F12` to open DevTools
3. Click the **Application** tab
4. In the left sidebar expand **Storage → Cookies → https://wanderlog.com**
5. Find the row where **Name** is `connect.sid`
6. Click the row, then double-click the **Value** cell and copy the full string — it starts with `s%3A` and is ~100 characters long

#### Firefox

1. Go to [wanderlog.com](https://wanderlog.com) and log in
2. Press `F12` to open DevTools
3. Click the **Storage** tab
4. In the left sidebar expand **Cookies → https://wanderlog.com**
5. Find `connect.sid` in the table, click it, and copy the **Value**

> **Why can't I use `document.cookie` in the console?**
> Wanderlog sets `connect.sid` with the `HttpOnly` flag, which deliberately blocks JavaScript from reading it (XSS protection). DevTools bypasses this restriction — that's why it works and the console doesn't.

### Step 2 — Choose: local or hosted

There are two ways to run wanderlog-mcp:

| | Local (stdio) | Hosted (Cloudflare Workers) |
|---|---|---|
| **Works with** | Claude Code, Claude Desktop, Cursor, VS Code | Claude.ai, Cursor, any HTTP MCP client |
| **Requires** | Node.js 22+ on your machine | A free Cloudflare account |
| **Cookie stored** | In your MCP client config (local) | As a Cloudflare Worker secret (encrypted) |
| **Cost** | Free | Free (100k req/day) |

---

## Hosted deployment (Cloudflare Workers)

Use this if you want to connect from **Claude.ai** or any MCP client that connects over HTTP rather than launching a local process.

### Prerequisites
- A free [Cloudflare account](https://cloudflare.com) (no credit card required)
- Node.js + this repo cloned locally (only needed once for the deploy step)

### Deploy

**1. Clone the repo and install dependencies**

```bash
git clone https://github.com/shadowalkerz1/wanderlog-mcp.git
cd wanderlog-mcp
npm install
```

**2. Log in to Cloudflare**

```bash
npx wrangler login
```

**3. Store your cookie as an encrypted secret**

```bash
npx wrangler secret put WANDERLOG_COOKIE
```

Paste the `connect.sid` value from Step 1 when prompted. It's stored encrypted in Cloudflare and never touches your code or git history.

**4. Deploy**

```bash
npm run deploy
```

You'll get a URL like `https://wanderlog-mcp.<your-subdomain>.workers.dev`.

### Connect Claude.ai

1. Go to **Claude.ai → Settings → Integrations**
2. Click **Add custom integration**
3. Enter your URL: `https://wanderlog-mcp.<your-subdomain>.workers.dev/mcp`
4. Save

Ask *"What trips do I have in Wanderlog?"* to confirm it's working.

### Refreshing your cookie (hosted)

When the cookie expires, update the secret and redeploy:

```bash
npx wrangler secret put WANDERLOG_COOKIE
npm run deploy
```

---

## Local setup

### Step 2 — Configure your MCP client

#### Claude Code

```bash
claude mcp add wanderlog-mcp npx wanderlog-mcp \
  --env WANDERLOG_COOKIE="s%3A...your value here..."
```

#### Claude Desktop

Edit `claude_desktop_config.json`:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "wanderlog": {
      "command": "npx",
      "args": ["wanderlog-mcp"],
      "env": {
        "WANDERLOG_COOKIE": "s%3A...your value here..."
      }
    }
  }
}
```

Restart Claude Desktop after saving.

#### Cursor

Settings → MCP → Add server, or edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "wanderlog": {
      "command": "npx",
      "args": ["wanderlog-mcp"],
      "env": {
        "WANDERLOG_COOKIE": "s%3A...your value here..."
      }
    }
  }
}
```

#### VS Code (GitHub Copilot)

Add to your workspace `.vscode/mcp.json`:

```json
{
  "servers": {
    "wanderlog": {
      "type": "stdio",
      "command": "npx",
      "args": ["wanderlog-mcp"],
      "env": {
        "WANDERLOG_COOKIE": "s%3A...your value here..."
      }
    }
  }
}
```

#### OpenAI Codex

Edit `~/.codex/config.toml`:

```toml
[mcp_servers.wanderlog]
command = "npx"
args = ["wanderlog-mcp"]

[mcp_servers.wanderlog.env]
WANDERLOG_COOKIE = "s%3A...your value here..."
```

Run `/mcp` inside Codex to confirm the server loaded.

#### Smithery (one-click install)

```bash
npx @smithery/cli install wanderlog-mcp --client claude
```

### Step 3 — Verify

Ask your agent: *"What trips do I have in Wanderlog?"*

It should call `wanderlog_list_trips` and return your account's trips. If it fails, see [Troubleshooting](#troubleshooting) below.

## Refreshing your cookie

The cookie lasts about a year but can die sooner if you log out of wanderlog.com, change your password, or Wanderlog revokes the session. When that happens every tool call returns:

> **Wanderlog session invalid or expired** — Capture a fresh connect.sid cookie from wanderlog.com DevTools and update WANDERLOG_COOKIE in your MCP config.

- **Local setup:** update `WANDERLOG_COOKIE` in your MCP client config and restart the client.
- **Hosted setup:** run `npx wrangler secret put WANDERLOG_COOKIE` then `npm run deploy`.

## Troubleshooting

**Server starts but list_trips returns an auth error**
Your cookie is expired or wrong. Re-capture it from DevTools and update your config.

**`npx wanderlog-mcp` hangs or does nothing**
The server speaks stdio MCP — it's designed to be launched by an MCP host, not run directly in a terminal. Run it through Claude Code or Claude Desktop as described above.

**Claude.ai says "Couldn't reach the MCP server"**
Make sure you deployed the latest version (`npm run deploy`) and that the URL ends in `/mcp`. The Worker needs CORS headers — these are included in v0.3.0+.

**Tools work but the agent ignores notes/checklists**
The server injects instructions into the MCP `initialize` response that tell the agent to interleave places and notes and add checklists. This works reliably with Claude. Other clients may vary.

## Security

- The cookie value never appears in logs, tool responses, or error messages
- **Local mode:** cookie lives only in your MCP client config on your machine; the server never phones home
- **Hosted mode:** cookie is stored as an encrypted Cloudflare Worker secret; it's never in source code or git history; requests go through Cloudflare's infrastructure
- The startup auth probe validates your cookie without printing its value
- To revoke access: log out of wanderlog.com (invalidates all sessions), then re-capture a fresh cookie

## Contributing

Pull requests are welcome. Before submitting:

```bash
npm run build && npm run test
```

For changes to transport or tool code, also run:

```bash
npm run test:integration
```

## Disclaimer

wanderlog-mcp is an unofficial third-party tool, not affiliated with or endorsed by Wanderlog. It works by calling Wanderlog's private web-client API, which may change without notice. Use at your own risk.

## License

MIT — see [LICENSE](LICENSE)

---

Made by [shaikhspeare](https://github.com/shaikhspeare)
