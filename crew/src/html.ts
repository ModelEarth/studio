import { basePath, Env } from "./env";
import type { CrewMember } from "./db";

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function money(cents: number, currencyCode: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode.toUpperCase() }).format(cents / 100);
}

export function redirect(location: string, headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 303, headers: { Location: location, ...headers } });
}

export function page(env: Env, title: string, body: string, user: CrewMember | null, status = 200): Response {
  const base = basePath(env);
  const hub = env.CREW_HUB_URL ? `<a href="${esc(env.CREW_HUB_URL)}">Projects hub</a>` : "";
  const account = user
    ? `<span class="who">${user.avatar_url ? `<img src="${esc(user.avatar_url)}" alt="">` : ""}@${esc(user.github_login)}</span>
       <form method="post" action="${base}/logout" class="inline"><button class="link">Sign out</button></form>`
    : `<a href="${base}/login">Sign in with GitHub</a>`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Crew</title>
<style>${STYLES}</style>
</head>
<body>
<header>
  <nav><a href="${base}/" class="brand">Crew</a><a href="${base}/connect">Payouts</a>${hub}</nav>
  <div class="account">${account}</div>
</header>
<main>
${body}
</main>
</body>
</html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

const STYLES = `
:root { --bg: #fff; --fg: #1f2328; --muted: #656d76; --line: #d0d7de; --accent: #0969da; --ok: #1a7f37; --warn: #9a6700; --card: #f6f8fa; }
@media (prefers-color-scheme: dark) { :root { --bg: #0d1117; --fg: #e6edf3; --muted: #8d96a0; --line: #30363d; --accent: #4493f8; --ok: #3fb950; --warn: #d29922; --card: #161b22; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
header { display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--line); }
nav a { margin-right: 16px; }
.brand { font-weight: 600; color: var(--fg); }
.account { display: flex; gap: 12px; align-items: center; }
.who { display: inline-flex; gap: 6px; align-items: center; }
.who img { width: 22px; height: 22px; border-radius: 50%; }
main { max-width: 860px; margin: 0 auto; padding: 16px; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
h1 { font-size: 22px; margin: 8px 0 4px; }
h2 { font-size: 17px; margin: 28px 0 8px; }
.muted { color: var(--muted); }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; margin: 12px 0; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-weight: 600; color: var(--muted); font-size: 13px; }
.table-wrap { overflow-x: auto; }
.status { font-size: 12px; padding: 2px 8px; border-radius: 10px; border: 1px solid var(--line); white-space: nowrap; }
.status.paid, .status.accepted, .status.delivered { color: var(--ok); border-color: var(--ok); }
.status.open, .status.pending { color: var(--warn); border-color: var(--warn); }
form.inline { display: inline; margin: 0; }
label { display: block; margin: 10px 0 4px; font-weight: 600; font-size: 13px; }
input, textarea, select { width: 100%; max-width: 420px; padding: 7px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--fg); font: inherit; }
textarea { min-height: 80px; max-width: 100%; }
button { margin-top: 10px; padding: 7px 14px; border-radius: 6px; border: 1px solid var(--line); background: var(--accent); color: #fff; font: inherit; cursor: pointer; }
button.secondary { background: transparent; color: var(--fg); }
button.small { margin: 0 4px 0 0; padding: 3px 10px; font-size: 13px; }
button.link { margin: 0; padding: 0; border: 0; background: none; color: var(--accent); }
.notice { border-left: 3px solid var(--warn); padding: 8px 12px; background: var(--card); margin: 12px 0; }
`;
