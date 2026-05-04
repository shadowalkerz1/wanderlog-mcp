/// <reference types="@cloudflare/workers-types" />

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { normalizeCookie, type Config } from "./config.js";
import { WanderlogAuthError, WanderlogError } from "./errors.js";
import { RestClient } from "./transport/rest.js";
import { ShareDBPool, type WsFactory, type WsLike } from "./transport/sharedb.js";
import { TripCache } from "./cache/trip-cache.js";
import type { AppContext } from "./context.js";
import { buildServer } from "./server.js";

// ---------------------------------------------------------------------------
// Cloudflare Workers WebSocket factory
//
// The standard `ws` npm package uses Node.js `net` internals. In Workers we
// use `fetch()` with an `Upgrade: websocket` header instead, which returns a
// Cloudflare WebSocket object via `response.webSocket`.
// ---------------------------------------------------------------------------

function createWorkersWebSocket(url: string, headers: Record<string, string>): WsLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const openListeners: Array<(e: any) => void> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messageListeners: Array<(e: any) => void> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const closeListeners: Array<(e: any) => void> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const errorListeners: Array<(e: any) => void> = [];
  let wsRef: WebSocket | null = null;
  let state = 0; // WebSocket.CONNECTING

  // Cloudflare Workers requires http(s):// for outgoing WebSocket upgrades.
  const httpUrl = url.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");

  fetch(httpUrl, { headers: { ...headers, Upgrade: "websocket" } })
    .then((resp) => {
      if (!resp.webSocket) {
        state = 3; // CLOSED
        const err =
          resp.status === 401 || resp.status === 403
            ? new WanderlogAuthError()
            : new WanderlogError(
                `WebSocket upgrade failed: ${resp.status}`,
                "ws_upgrade_failed",
              );
        for (const l of errorListeners) l({ error: err });
        for (const l of closeListeners) l({ code: 1006 });
        return;
      }
      wsRef = resp.webSocket;
      wsRef.accept();
      state = 1; // OPEN
      for (const l of openListeners) l(undefined);
      wsRef.addEventListener("message", (e: MessageEvent) => {
        const data = typeof e.data === "string" ? e.data : String(e.data);
        for (const l of messageListeners) l({ data });
      });
      wsRef.addEventListener("close", (e: CloseEvent) => {
        state = 3;
        for (const l of closeListeners) l({ code: e.code });
      });
      wsRef.addEventListener("error", () => {
        for (const l of errorListeners) l({ error: new Error("WebSocket error") });
      });
    })
    .catch((err: Error) => {
      state = 3;
      for (const l of errorListeners) l({ error: err });
      for (const l of closeListeners) l({ code: 1006 });
    });

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addEventListener(type: string, listener: (event: any) => void): void {
      if (type === "open") openListeners.push(listener);
      else if (type === "message") messageListeners.push(listener);
      else if (type === "close") closeListeners.push(listener);
      else if (type === "error") errorListeners.push(listener);
    },
    send(data: string): void {
      if (!wsRef) throw new WanderlogError("WebSocket not open", "ws_not_open");
      wsRef.send(data);
    },
    close(): void {
      if (wsRef) wsRef.close();
      else state = 3;
    },
    get readyState() {
      return state;
    },
  };
}

const workersWsFactory: WsFactory = createWorkersWebSocket;

// ---------------------------------------------------------------------------
// Context creation — stateless (fresh per request, no in-memory caching)
// ---------------------------------------------------------------------------

async function createContext(cookieRaw: string): Promise<AppContext> {
  const cookie = normalizeCookie(cookieRaw);
  const config: Config = {
    cookieHeader: cookie,
    baseUrl: "https://wanderlog.com",
    wsBaseUrl: "wss://wanderlog.com",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
  };
  const rest = new RestClient(config);
  const pool = new ShareDBPool(config, workersWsFactory);
  const tripCache = new TripCache(rest, pool);

  // Validate the cookie and fetch the user ID (needed by mutation tools).
  const user = await rest.getUser();
  return { config, rest, pool, tripCache, userId: user.id, authenticated: true };
}

// ---------------------------------------------------------------------------
// Workers fetch handler
// ---------------------------------------------------------------------------

interface Env {
  WANDERLOG_COOKIE?: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const { pathname } = new URL(request.url);

    if (pathname === "/health") {
      return withCors(Response.json({ status: "ok" }));
    }

    if (pathname !== "/mcp") {
      return new Response("Not Found", { status: 404 });
    }

    const cookieRaw = env.WANDERLOG_COOKIE;
    if (!cookieRaw) {
      return withCors(Response.json(
        {
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message:
              "WANDERLOG_COOKIE secret is not configured. Run: npx wrangler secret put WANDERLOG_COOKIE",
          },
          id: null,
        },
        { status: 500 },
      ));
    }

    let ctx: AppContext;
    try {
      ctx = await createContext(cookieRaw);
    } catch (err) {
      const msg =
        err instanceof WanderlogError ? err.toUserMessage() : (err as Error).message;
      return withCors(Response.json(
        {
          jsonrpc: "2.0",
          error: { code: -32000, message: `Authentication failed: ${msg}` },
          id: null,
        },
        { status: 403 },
      ));
    }

    const server = buildServer(ctx);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — no session tracking between requests
      enableJsonResponse: true,
    });

    try {
      await server.connect(transport);
      return withCors(await transport.handleRequest(request));
    } finally {
      ctx.pool.closeAll();
      await transport.close();
      await server.close();
    }
  },
};
