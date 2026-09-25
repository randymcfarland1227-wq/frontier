import handler from "vinext/server/app-router-entry";
import { mergeState, normalizeState, stateCounts } from "../lib/syncState";

interface Env {
  ASSETS: Fetcher;
  /** TickTick Open API bearer token — set via `wrangler secret put TICKTICK_ACCESS_TOKEN` */
  TICKTICK_ACCESS_TOKEN?: string;
  /** Cloud backup for Life Hub state (completions, ideas, Self, goal links) */
  LIFEHUB_STATE: KVNamespace;
  /** Shared with Role Hub (Apps Script) so it can push its snapshot */
  ROLE_PUSH_KEY?: string;
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

// ---------------------------------------------------------------------------
// TickTick completions feed: GET /api/ticktick/done?from=YYYYMMDD&to=YYYYMMDD&start=ISO&end=ISO
// Tasks completed in TickTick (Open API /task/completed) + habit check-ins, so Life Hub can
// count work finished in the TickTick app. Postponed tasks never appear — TickTick only lists
// tasks it marked complete. POST /api/ticktick/habit-checkin checks a habit in from the hub.
// ---------------------------------------------------------------------------

const TT = "https://api.ticktick.com/open/v1";

function ttTime(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  // TickTick uses "+0000"; make it ISO-8601 with a colon so every parser agrees.
  const t = Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

async function ttFetch(env: Env, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${TT}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.TICKTICK_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`ticktick_${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Gate private TickTick data behind the backup key once the backup has been claimed. */
async function syncKeyAllowed(request: Request, env: Env): Promise<boolean> {
  const claimed = await env.LIFEHUB_STATE.get(AUTH_KEY);
  if (!claimed) return true;
  const key = (request.headers.get("X-Sync-Key") || "").trim();
  return key.length >= 24 && (await sha256(key)) === claimed;
}

const stampRe = /^\d{8}$/;

async function handleTickTickDone(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (origin && !CORS_ALLOW_ORIGINS.has(origin)) return jsonResponse({ ok: false, error: "cors_denied" }, 403, origin);
  if (request.method !== "GET") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, origin);
  if (!env.TICKTICK_ACCESS_TOKEN) return jsonResponse({ ok: false, error: "token_not_configured" }, 503, origin);
  if (!(await syncKeyAllowed(request, env))) return jsonResponse({ ok: false, error: "wrong_key" }, 401, origin);

  const q = new URL(request.url).searchParams;
  const from = q.get("from") || "";
  const to = q.get("to") || "";
  const start = ttTime(q.get("start") || "");
  const end = ttTime(q.get("end") || "");
  if (!stampRe.test(from) || !stampRe.test(to) || !start || !end) {
    return jsonResponse({ ok: false, error: "bad_range" }, 400, origin);
  }
  const fmt = (iso: string) => iso.replace(/\.\d{3}Z$/, ".000+0000");

  const errors: string[] = [];
  let tasks: Array<Record<string, unknown>> = [];
  try {
    const raw = (await ttFetch(env, "/task/completed", {
      method: "POST",
      body: JSON.stringify({ startDate: fmt(start), endDate: fmt(end) }),
    })) as Array<Record<string, unknown>> | null;
    tasks = (raw || [])
      .filter(t => t && t.status === 2 && typeof t.id === "string")
      .map(t => ({
        id: t.id,
        projectId: t.projectId,
        title: t.title,
        completedAt: ttTime(t.completedTime),
        // When it was due, so Life Hub can count a late-logged task on its own day.
        dueAt: ttTime(t.dueDate) || ttTime(t.startDate),
        allDay: Boolean(t.isAllDay),
        repeat: Boolean(t.repeatFlag),
      }));
  } catch (e) {
    errors.push(`tasks:${(e as Error).message}`);
  }

  const habits: Array<Record<string, unknown>> = [];
  // Each habit's schedule, so Life Hub knows which habits are due on a given day.
  let schedule: Array<Record<string, unknown>> = [];
  try {
    const list = ((await ttFetch(env, "/habit")) as Array<Record<string, unknown>> | null) || [];
    const byId = new Map(list.filter(h => typeof h.id === "string").map(h => [h.id as string, h]));
    schedule = list
      .filter(h => typeof h.id === "string" && h.status === 0)
      .map(h => ({
        id: `habit-${h.id}`,
        title: h.name,
        repeatRule: h.repeatRule,
        targetStartDate: h.targetStartDate,
        exDates: Array.isArray(h.exDates) ? h.exDates : [],
      }));
    if (byId.size) {
      const checkins = ((await ttFetch(
        env,
        `/habit/checkins?habitIds=${encodeURIComponent([...byId.keys()].join(","))}&from=${from}&to=${to}`,
      )) as Array<{ habitId: string; checkins?: Array<Record<string, unknown>> }> | null) || [];
      for (const doc of checkins) {
        const habit = byId.get(doc.habitId);
        for (const c of doc.checkins || []) {
          const value = Number(c.value) || 0;
          const goal = Number(c.goal) || Number(habit?.goal) || 1;
          const done = c.status === 2 || (c.status == null && value >= goal && value > 0);
          if (!done || !stampRe.test(String(c.stamp))) continue;
          habits.push({
            id: `habit-${doc.habitId}`,
            title: habit?.name,
            stamp: String(c.stamp),
            completedAt: ttTime(c.time) || ttTime(c.opTime),
          });
        }
      }
    }
  } catch (e) {
    errors.push(`habits:${(e as Error).message}`);
  }

  return jsonResponse({ ok: errors.length < 2, tasks, habits, schedule, errors }, 200, origin);
}

async function handleHabitCheckin(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (origin && !CORS_ALLOW_ORIGINS.has(origin)) return jsonResponse({ ok: false, error: "cors_denied" }, 403, origin);
  if (request.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, origin);
  if (!env.TICKTICK_ACCESS_TOKEN) return jsonResponse({ ok: false, error: "token_not_configured" }, 503, origin);
  if (!(await syncKeyAllowed(request, env))) return jsonResponse({ ok: false, error: "wrong_key" }, 401, origin);

  let body: { habitId?: unknown; stamp?: unknown };
  try {
    body = (await request.json()) as { habitId?: unknown; stamp?: unknown };
  } catch {
    return jsonResponse({ ok: false, error: "invalid_json" }, 400, origin);
  }
  const habitId = typeof body.habitId === "string" ? body.habitId.replace(/^habit-/, "").trim() : "";
  const stamp = String(body.stamp || "");
  if (!/^[0-9a-f]{12,40}$/i.test(habitId) || !stampRe.test(stamp)) {
    return jsonResponse({ ok: false, error: "bad_input" }, 400, origin);
  }
  try {
    // Count habits ("Drink 5 bottles") need value = goal to register as complete.
    const habit = (await ttFetch(env, `/habit/${habitId}`)) as { goal?: number } | null;
    const goal = Number(habit?.goal) || 1;
    await ttFetch(env, `/habit/${habitId}/checkin`, {
      method: "POST",
      body: JSON.stringify({ stamp: Number(stamp), value: goal, goal, status: 2 }),
    });
    return jsonResponse({ ok: true }, 200, origin);
  } catch (e) {
    return jsonResponse({ ok: false, error: (e as Error).message }, 502, origin);
  }
}

// ---------------------------------------------------------------------------
// Role Hub snapshot: Role Hub (Apps Script, signed-in only) POSTs its Life Hub snapshot
// here whenever it loads; Life Hub GETs it with the backup key.
// ---------------------------------------------------------------------------

const ROLE_KEY = "role-snapshot";

async function handleRoleSnapshot(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });

  if (request.method === "POST") {
    // Server-to-server from Apps Script (no Origin header); authenticated by the shared key.
    const key = request.headers.get("X-Role-Key") || "";
    if (!env.ROLE_PUSH_KEY || key !== env.ROLE_PUSH_KEY) return jsonResponse({ ok: false, error: "wrong_key" }, 401, origin);
    const text = await request.text();
    if (text.length > 500_000) return jsonResponse({ ok: false, error: "too_large" }, 413, origin);
    let snap: { source?: unknown; refreshedAt?: unknown; tasks?: unknown };
    try {
      snap = JSON.parse(text);
    } catch {
      return jsonResponse({ ok: false, error: "invalid_json" }, 400, origin);
    }
    if (snap.source !== "role" || typeof snap.refreshedAt !== "string" || !Array.isArray(snap.tasks)) {
      return jsonResponse({ ok: false, error: "bad_snapshot" }, 400, origin);
    }
    await env.LIFEHUB_STATE.put(ROLE_KEY, text);
    return jsonResponse({ ok: true }, 200, origin);
  }

  if (request.method === "GET") {
    if (origin && !CORS_ALLOW_ORIGINS.has(origin)) return jsonResponse({ ok: false, error: "cors_denied" }, 403, origin);
    if (!(await syncKeyAllowed(request, env))) return jsonResponse({ ok: false, error: "wrong_key" }, 401, origin);
    const snap = await env.LIFEHUB_STATE.get(ROLE_KEY, "json");
    return jsonResponse({ ok: true, snapshot: snap }, 200, origin);
  }

  return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, origin);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/ticktick/complete") {
      return handleTickTickComplete(request, env);
    }

    if (pathname === "/api/ticktick/done") {
      return handleTickTickDone(request, env);
    }

    if (pathname === "/api/ticktick/habit-checkin") {
      return handleHabitCheckin(request, env);
    }

    if (pathname === "/api/role/snapshot") {
      return handleRoleSnapshot(request, env);
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
