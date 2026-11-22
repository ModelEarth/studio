export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  WEBAPP_DEV_ORIGIN?: string;
  ARTCRAFT_ACCOUNTS_URL?: string;
  CREW_BASE_PATH?: string;
  CREW_CURRENCY?: string;
  CREW_PLATFORM_FEE_PERCENT?: string;
  CREW_ADMIN_GITHUB_LOGINS?: string;
  CREW_GITHUB_OWNERS?: string;
  CREW_HUB_URL?: string;
  CREW_DEV_LOGIN?: string;
  STRIPE_CREW_SECRET_KEY?: string;
  STRIPE_CREW_WEBHOOK_SECRET?: string;
  STRIPE_CREW_SANDBOX_SECRET_KEY?: string;
  STRIPE_CREW_SANDBOX_WEBHOOK_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_TOKEN?: string;
}

/**
 * The settings for one request. Localhost uses the crew's Stripe sandbox
 * (STRIPE_CREW_SANDBOX_SECRET_KEY and STRIPE_CREW_SANDBOX_WEBHOOK_SECRET) in place of the
 * live keys, and never the live keys, so local testing can't take real payments.
 * The deployed site only has the live keys, since deploys don't upload the sandbox ones.
 */
export function requestEnv(request: Request, env: Env): Env {
  const url = new URL(request.url);
  const hostEnv = { ...env, ...githubApp(env, url) };
  if (!isLocalhost(url)) return hostEnv;
  return {
    ...hostEnv,
    STRIPE_CREW_SECRET_KEY: env.STRIPE_CREW_SANDBOX_SECRET_KEY,
    STRIPE_CREW_WEBHOOK_SECRET: env.STRIPE_CREW_SANDBOX_WEBHOOK_SECRET,
  };
}

/**
 * The GitHub OAuth app for the request's host. The crew env file can name several apps,
 * each as GITHUB_<NAME>_HOST (its hosts, comma-separated, such as studio.model.earth or
 * localhost:4201), GITHUB_<NAME>_CLIENT_ID and GITHUB_<NAME>_CLIENT_SECRET.
 * Hosts without a named app use GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.
 */
export function githubApp(env: Env, url: URL): Pick<Env, "GITHUB_CLIENT_ID" | "GITHUB_CLIENT_SECRET"> {
  const values = env as unknown as Record<string, unknown>;
  for (const [key, hosts] of Object.entries(values)) {
    const name = key.match(/^GITHUB_(.+)_HOST$/)?.[1];
    if (!name || typeof hosts !== "string") continue;
    const list = splitList(hosts);
    if (!list.includes(url.host) && !list.includes(url.hostname)) continue;
    const id = values[`GITHUB_${name}_CLIENT_ID`];
    const secret = values[`GITHUB_${name}_CLIENT_SECRET`];
    if (typeof id === "string" && id && typeof secret === "string" && secret) {
      return { GITHUB_CLIENT_ID: id, GITHUB_CLIENT_SECRET: secret };
    }
  }
  return { GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET };
}

export function isLocalhost(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
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
