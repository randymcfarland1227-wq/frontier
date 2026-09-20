import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
}

const publicAppAssets = new Set([
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/manifest.webmanifest",
]);

// A path whose last segment has an extension (e.g. /assets/index-abc.css).
function isFilePath(pathname: string): boolean {
  return pathname.slice(pathname.lastIndexOf("/") + 1).includes(".");
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
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
