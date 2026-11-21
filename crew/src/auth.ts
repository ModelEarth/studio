import { basePath, Env, githubConfigured } from "./env";
import { authorizeUrl, exchangeCodeForUser } from "./github";
import { page, redirect } from "./html";
import { upsertMember } from "./db";
import { cookie, endSession, randomToken, readCookie, startSession } from "./session";

const STATE_COOKIE = "crew_oauth_state";

export async function login(request: Request, env: Env): Promise<Response> {
  if (!githubConfigured(env)) {
    return page(env, "Sign in", `<h1>Sign in</h1><div class="notice">GitHub sign-in isn't set up yet. Add GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to crew/.env.</div>`, null, 503);
  }
  const url = new URL(request.url);
  const state = randomToken(16);
  const next = safeNext(env, url.searchParams.get("next"));
  return redirect(authorizeUrl(env, callbackUrl(request, env), state), {
    "Set-Cookie": cookie(request, env, STATE_COOKIE, `${state}|${next}`, 600),
  });
}

export async function callback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const [expectedState, next] = (readCookie(request, STATE_COOKIE) ?? "").split("|");
  const code = url.searchParams.get("code");
  if (!code || !expectedState || url.searchParams.get("state") !== expectedState) {
    return page(env, "Sign in", `<h1>Sign in failed</h1><p>The sign-in link expired or didn't match. <a href="${basePath(env)}/login">Try again</a>.</p>`, null, 400);
  }
  const user = await exchangeCodeForUser(env, code, callbackUrl(request, env));
  await upsertMember(env, { github_id: user.id, github_login: user.login, name: user.name, avatar_url: user.avatar_url });
  const headers = new Headers({ Location: safeNext(env, next) });
  headers.append("Set-Cookie", await startSession(request, env, user.id));
  headers.append("Set-Cookie", cookie(request, env, STATE_COOKIE, "", 0));
  return new Response(null, { status: 303, headers });
}

export async function logout(request: Request, env: Env): Promise<Response> {
  return redirect(`${basePath(env)}/`, { "Set-Cookie": await endSession(request, env) });
}

/** Local testing without a GitHub OAuth app. Needs CREW_DEV_LOGIN=true and a localhost request. */
export async function devLogin(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const login = url.searchParams.get("login") ?? "";
  if (env.CREW_DEV_LOGIN !== "true" || !local || !/^[A-Za-z0-9-]{1,39}$/.test(login)) {
    return page(env, "Not found", "<h1>Not found</h1>", null, 404);
  }
  const githubId = -devId(login);
  await upsertMember(env, { github_id: githubId, github_login: login, name: `${login} (dev)`, avatar_url: null });
  return redirect(safeNext(env, url.searchParams.get("next")), { "Set-Cookie": await startSession(request, env, githubId) });
}

function callbackUrl(request: Request, env: Env): string {
  return `${new URL(request.url).origin}${basePath(env)}/auth/callback`;
}

/** Only redirect within the crew pages after sign-in. */
function safeNext(env: Env, next: string | null | undefined): string {
  const base = basePath(env);
  return next && next.startsWith(`${base}/`) && !next.startsWith("//") ? next : `${base}/`;
}

function devId(login: string): number {
  let hash = 0;
  for (const char of login.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) % 1_000_000_007;
  return hash + 1;
}
