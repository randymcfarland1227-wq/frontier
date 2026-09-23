import handler from "vinext/server/app-router-entry";
import { mergeState, normalizeState, stateCounts } from "../lib/syncState";

interface Env {
  ASSETS: Fetcher;
  /** TickTick Open API bearer token — set via `wrangler secret put TICKTICK_ACCESS_TOKEN` */
  TICKTICK_ACCESS_TOKEN?: string;
  /** Cloud backup for Life Hub state (completions, ideas, Self, goal links) */
  LIFEHUB_STATE: KVNamespace;
  /** Where the retired Worker copy of the hub sends people (and their saved data) */
  PAGES_URL?: string;
}

const DEFAULT_PAGES_URL = "https://randymcfarland1227-wq.github.io/frontier/";

const publicAppAssets = new Set([
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/manifest.webmanifest",
]);

const CORS_ALLOW_ORIGINS = new Set([
  "https://randymcfarland1227-wq.github.io",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
  "http://localhost:4173",
  "http://localhost:8952",
]);

function corsHeaders(origin: string | null): HeadersInit {
  const allow =
    origin && CORS_ALLOW_ORIGINS.has(origin) ? origin : "https://randymcfarland1227-wq.github.io";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Sync-Key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function jsonResponse(
  body: unknown,
  status: number,
  origin: string | null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}

// A path whose last segment has an extension (e.g. /assets/index-abc.css).
function isFilePath(pathname: string): boolean {
  return pathname.slice(pathname.lastIndexOf("/") + 1).includes(".");
}

async function handleTickTickComplete(
  request: Request,
  env: Env,
): Promise<Response> {
  const origin = request.headers.get("Origin");

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, origin);
  }

  if (origin && !CORS_ALLOW_ORIGINS.has(origin)) {
    return jsonResponse({ ok: false, error: "cors_denied" }, 403, origin);
  }

  let body: { taskId?: unknown; projectId?: unknown };
  try {
    body = (await request.json()) as { taskId?: unknown; projectId?: unknown };
  } catch {
    return jsonResponse({ ok: false, error: "invalid_json" }, 400, origin);
  }

  const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";

  if (!taskId || !projectId) {
    return jsonResponse({ ok: false, error: "missing_ids" }, 400, origin);
  }

  if (taskId.startsWith("habit-")) {
    return jsonResponse({ ok: false, reason: "habit" }, 400, origin);
  }

  const token = env.TICKTICK_ACCESS_TOKEN;
  if (!token) {
    return jsonResponse({ ok: false, error: "token_not_configured" }, 503, origin);
  }

  const url = `https://api.ticktick.com/open/v1/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}/complete`;
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
  } catch {
    return jsonResponse({ ok: false, error: "upstream_network" }, 502, origin);
  }

  if (!upstream.ok) {
    // Never echo token or upstream body that might leak auth details.
    return jsonResponse(
      { ok: false, error: "upstream_failed", status: upstream.status },
      upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502,
      origin,
    );
  }

  return jsonResponse({ ok: true }, 200, origin);
}

// ---------------------------------------------------------------------------
// Cloud backup: GET/PUT /api/state
// The first device to save claims the store with its sync key (only a SHA-256 hash
// is kept). Every later request must send the same key. PUT merges, never replaces.
// ---------------------------------------------------------------------------

const STATE_KEY = "state";
const AUTH_KEY = "auth-sha256";
const MAX_BODY_BYTES = 4_000_000;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function handleState(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (origin && !CORS_ALLOW_ORIGINS.has(origin)) {
    return jsonResponse({ ok: false, error: "cors_denied" }, 403, origin);
  }
  if (request.method !== "GET" && request.method !== "PUT") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, origin);
  }

  const key = (request.headers.get("X-Sync-Key") || "").trim();
  if (key.length < 24) {
    return jsonResponse({ ok: false, error: "missing_key" }, 401, origin);
  }
  const hash = await sha256(key);
  const claimed = await env.LIFEHUB_STATE.get(AUTH_KEY);
  if (claimed && claimed !== hash) {
    return jsonResponse({ ok: false, error: "wrong_key" }, 401, origin);
  }

  const stored = normalizeState(await env.LIFEHUB_STATE.get(STATE_KEY, "json"));

  if (request.method === "GET") {
    if (!claimed) return jsonResponse({ ok: false, error: "not_set_up" }, 404, origin);
    return jsonResponse({ ok: true, state: stored, counts: stateCounts(stored) }, 200, origin);
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return jsonResponse({ ok: false, error: "too_large" }, 413, origin);
  }
  let incoming: unknown;
  try {
    incoming = JSON.parse(text);
  } catch {
    return jsonResponse({ ok: false, error: "invalid_json" }, 400, origin);
  }
  const merged = mergeState(stored, (incoming as { state?: unknown })?.state);
  if (!claimed) await env.LIFEHUB_STATE.put(AUTH_KEY, hash);
  await env.LIFEHUB_STATE.put(STATE_KEY, JSON.stringify(merged));
  return jsonResponse({ ok: true, state: merged, counts: stateCounts(merged) }, 200, origin);
}

// ---------------------------------------------------------------------------
// Retired copy: this origin used to host the hub, so its browser storage may hold
// completions the GitHub Pages copy never saw. Hand them over once, then redirect.
// ---------------------------------------------------------------------------

function handoffPage(pagesUrl: string): Response {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Randy's Life Hub</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,sans-serif;background:#0f1218;color:#e8ebf2}
main{max-width:420px;padding:24px;text-align:center}a{color:#9aa8ff}</style></head>
<body><main><h1 style="font-size:20px">Life Hub has moved</h1>
<p id="msg">Bringing your saved history along…</p>
<p><a id="go" href="${pagesUrl}">Open Life Hub</a></p></main>
<script>
(function () {
  var target = ${JSON.stringify(pagesUrl)};
  function read(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  var payload = { from: location.host, completions: read('lifehub-completions'), self: read('lifehub-self-inbox') };
  var n = payload.completions && payload.completions.entries ? Object.keys(payload.completions.entries).length : 0;
  var s = Array.isArray(payload.self) ? payload.self.length : 0;
  var url = target;
  if (n || s) {
    var b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    url = target + '#import=' + encodeURIComponent(b64);
    document.getElementById('msg').textContent = 'Bringing ' + n + ' completions and ' + s + ' Self items to the new Life Hub…';
  }
  document.getElementById('go').href = url;
  setTimeout(function () { location.replace(url); }, 600);
})();
</script></body></html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/ticktick/complete") {
      return handleTickTickComplete(request, env);
    }

    if (pathname === "/api/state") {
      return handleState(request, env);
    }

    if (
      publicAppAssets.has(pathname) &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      return env.ASSETS.fetch(request);
    }

    // run_worker_first routes CSS, JS, fonts and images through this worker;
    // serve those files directly from the static assets store.
    if (isFilePath(pathname) && (request.method === "GET" || request.method === "HEAD")) {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return asset;
    }

    // Page loads on the retired copy hand their saved data to GitHub Pages.
    if (request.method === "GET" && (request.headers.get("Accept") || "").includes("text/html")) {
      return handoffPage(env.PAGES_URL || DEFAULT_PAGES_URL);
    }

    return handler.fetch(request, env, ctx);
  },
};
