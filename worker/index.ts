import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  /** TickTick Open API bearer token — set via `wrangler secret put TICKTICK_ACCESS_TOKEN` */
  TICKTICK_ACCESS_TOKEN?: string;
}

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
]);

function corsHeaders(origin: string | null): HeadersInit {
  const allow =
    origin && CORS_ALLOW_ORIGINS.has(origin) ? origin : "https://randymcfarland1227-wq.github.io";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/ticktick/complete") {
      return handleTickTickComplete(request, env);
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

    return handler.fetch(request, env, ctx);
  },
};
