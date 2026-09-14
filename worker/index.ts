import handler from "vinext/server/app-router-entry";
import { requireOwner } from "./auth";

interface Env {
  SITE_PASSWORD_HASH: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const unauthorized = await requireOwner(request, env);
    if (unauthorized) return unauthorized;
    return handler.fetch(request, env, ctx);
  },
};
