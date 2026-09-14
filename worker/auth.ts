export interface AuthEnv {
  SITE_PASSWORD_HASH: string;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function requireOwner(request: Request, env: AuthEnv): Promise<Response | null> {
  const authorization = request.headers.get("Authorization");
  if (authorization?.startsWith("Basic ")) {
    try {
      const decoded = atob(authorization.slice(6));
      const separator = decoded.indexOf(":");
      const username = decoded.slice(0, separator);
      const password = decoded.slice(separator + 1);
      if (username === "owner" && await sha256(password) === env.SITE_PASSWORD_HASH) return null;
    } catch {
      // Fall through to the browser sign-in prompt.
    }
  }

  return new Response("Private site", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Private site", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}
