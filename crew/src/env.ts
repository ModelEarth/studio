export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  WEBAPP_DEV_ORIGIN?: string;
  CREW_BASE_PATH?: string;
  CREW_CURRENCY?: string;
  CREW_PLATFORM_FEE_PERCENT?: string;
  CREW_ADMIN_GITHUB_LOGINS?: string;
  CREW_GITHUB_OWNERS?: string;
  CREW_HUB_URL?: string;
  CREW_DEV_LOGIN?: string;
  STRIPE_CREW_SECRET_KEY?: string;
  STRIPE_CREW_WEBHOOK_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_TOKEN?: string;
}

export function basePath(env: Env): string {
  return (env.CREW_BASE_PATH ?? "/crew").replace(/\/+$/, "");
}

export function currency(env: Env): string {
  return (env.CREW_CURRENCY || "usd").toLowerCase();
}

export function feePercent(env: Env): number {
  const percent = Number(env.CREW_PLATFORM_FEE_PERCENT ?? "0");
  return Number.isFinite(percent) && percent >= 0 && percent < 100 ? percent : 0;
}

export function platformFeeCents(env: Env, amountCents: number): number {
  return Math.round((amountCents * feePercent(env)) / 100);
}

export function isAdmin(env: Env, login: string | undefined): boolean {
  if (!login) return false;
  return splitList(env.CREW_ADMIN_GITHUB_LOGINS).includes(login.toLowerCase());
}

export function ownerAllowed(env: Env, repo: string): boolean {
  const owners = splitList(env.CREW_GITHUB_OWNERS);
  return owners.length === 0 || owners.includes(repo.split("/")[0].toLowerCase());
}

export function stripeConfigured(env: Env): boolean {
  return !!env.STRIPE_CREW_SECRET_KEY && !env.STRIPE_CREW_SECRET_KEY.includes("REPLACE_ME");
}

export function githubConfigured(env: Env): boolean {
  return !!env.GITHUB_CLIENT_ID && !!env.GITHUB_CLIENT_SECRET;
}

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}
