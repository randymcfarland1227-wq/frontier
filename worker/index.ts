import handler from "vinext/server/app-router-entry";
import { requireOwner } from "./auth";

interface Env {
  SITE_PASSWORD_HASH: string;
  ASSETS: Fetcher;
}

// A path whose last segment has an extension (e.g. /assets/index-abc.css).
function isFilePath(pathname: string): boolean {
  return pathname.slice(pathname.lastIndexOf("/") + 1).includes(".");
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const unauthorized = await requireOwner(request, env);
    if (unauthorized) return unauthorized;

    // run_worker_first routes CSS, JS, fonts and images through this worker
    // for the password check; the app handler can't serve them, so hand them
    // to the static assets store and only fall through when it has no match.
    const { pathname } = new URL(request.url);
    if (isFilePath(pathname) && (request.method === "GET" || request.method === "HEAD")) {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return asset;
    }

    return handler.fetch(request, env, ctx);
  },
};
