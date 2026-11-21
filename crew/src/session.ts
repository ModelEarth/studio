import { basePath, Env } from "./env";
import type { CrewMember } from "./db";

const SESSION_COOKIE = "crew_session";
const SESSION_DAYS = 30;

export function randomToken(bytes = 32): string {
  const buffer = crypto.getRandomValues(new Uint8Array(bytes));
  return [...buffer].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function cookie(request: Request, env: Env, name: string, value: string, maxAgeSeconds: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const path = basePath(env) || "/";
  return `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure}`;
}

export async function currentUser(request: Request, env: Env): Promise<CrewMember | null> {
  const sessionId = readCookie(request, SESSION_COOKIE);
  if (!sessionId) return null;
  return env.DB.prepare(
    `SELECT m.* FROM crew_sessions s JOIN crew_members m ON m.github_id = s.github_id
     WHERE s.id = ? AND s.expires_at > datetime('now')`,
  ).bind(sessionId).first<CrewMember>();
}

export async function startSession(request: Request, env: Env, githubId: number): Promise<string> {
  const sessionId = randomToken();
  await env.DB.prepare(`INSERT INTO crew_sessions (id, github_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`)
    .bind(sessionId, githubId).run();
  return cookie(request, env, SESSION_COOKIE, sessionId, SESSION_DAYS * 86400);
}

export async function endSession(request: Request, env: Env): Promise<string> {
  const sessionId = readCookie(request, SESSION_COOKIE);
  if (sessionId) await env.DB.prepare("DELETE FROM crew_sessions WHERE id = ?").bind(sessionId).run();
  return cookie(request, env, SESSION_COOKIE, "", 0);
}

/** Form posts must come from this site, so other sites can't submit them for a signed-in user. */
export function isSameOrigin(request: Request): boolean {
  const self = new URL(request.url).origin;
  const origin = request.headers.get("Origin");
  if (origin) return origin === self;
  const referer = request.headers.get("Referer");
  try {
    return !!referer && new URL(referer).origin === self;
  } catch {
    return false;
  }
}
