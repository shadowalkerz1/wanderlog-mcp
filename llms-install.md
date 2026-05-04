# llms-install.md

wanderlog-mcp supports two deployment modes:

- **Local stdio** — launched by the MCP client on the user's machine via `npx wanderlog-mcp`
- **Hosted HTTP** — a Cloudflare Workers deployment the user self-hosts; connects over HTTP from Claude.ai or any HTTP MCP client

## Required credential

- `WANDERLOG_COOKIE` — the user's Wanderlog `connect.sid` cookie value from their logged-in browser session

Treat this as a password. It grants full access to the user's Wanderlog account.

## Local stdio setup

### Getting the cookie

1. Log in to https://wanderlog.com in a browser.
2. Open DevTools → Application → Cookies → `https://wanderlog.com`
3. Copy the full value of `connect.sid` (starts with `s%3A`, ~100 characters).

### Example configurations

#### Claude Code

```bash
claude mcp add wanderlog-mcp npx wanderlog-mcp \
  --env WANDERLOG_COOKIE="s%3A...your value here..."
```

#### Claude Desktop

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

#### Cursor

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

## Hosted HTTP setup (Cloudflare Workers)

For Claude.ai and HTTP MCP clients. Requires a free Cloudflare account.

```bash
git clone https://github.com/shadowalkerz1/wanderlog-mcp.git
cd wanderlog-mcp && npm install
npx wrangler login
npx wrangler secret put WANDERLOG_COOKIE   # paste cookie value
npm run deploy                              # outputs a workers.dev URL
```

Connect in Claude.ai: Settings → Integrations → Add custom integration → enter `https://wanderlog-mcp.<subdomain>.workers.dev/mcp`

## Notes for installation agents

- The local server speaks stdio MCP and must be launched by the MCP client — do not run it directly in a shell.
- The hosted server speaks HTTP MCP (Streamable HTTP transport) at the `/mcp` endpoint.
- If tool calls fail with an auth error, the cookie is expired. User should re-capture `connect.sid` from DevTools.
- Full setup instructions, troubleshooting, and examples: see `README.md`.
