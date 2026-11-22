// node scripts/crew.mjs dev    [--env-file <path>]   site on http://localhost:4201
// node scripts/crew.mjs site   [--build-webapp]      assemble crew/site
// node scripts/crew.mjs check  [--env-file <path>]   what deploy still needs (read-only)
// node scripts/crew.mjs deploy [--env-file <path>] [--skip-webapp-build] [--wrangler-login]
//                                                    deploy to studio.model.earth
//
// automation/paths.yaml says where the env files are: crew_env_file: (crew settings,
// including CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID for deploys) and, optionally,
// cloudflare_env_file: (another env file with those two keys, such as CloudRoot's).

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { fail, readEnv, readPathSetting, resolveEnvFile } from "../../automation/env-file.mjs";

const CREW_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_DIR = join(CREW_DIR, "..");
const WRANGLER_CONFIG = join(CREW_DIR, "wrangler.jsonc");
const WEBAPP_DIST = join(REPO_DIR, "frontend/apps/artcraft-webapp/dist");
const SITE_DIR = join(CREW_DIR, "site");
const DEV_SITE_DIR = join(CREW_DIR, ".wrangler/dev-site");
// Submodules served at the site root (/engine/, /projects/, ...), listed in
// site-folders.json, which the Worker reads too.
const SUBMODULES = JSON.parse(readFileSync(join(CREW_DIR, "site-folders.json"), "utf8"));
// Served path in the site -> folder in crew.
const SITE_FOLDERS = { ...Object.fromEntries(SUBMODULES.map((folder) => [folder, folder])), "crew/css": "css" };
// What the site leaves out, as .assetsignore in the site folder.
const ASSETS_IGNORE = join(CREW_DIR, "site.assetsignore");
const WEBAPP_DEV_ORIGIN = `http://127.0.0.1:${process.env.WEBAPP_DEV_PORT || 4202}`;
const PLACEHOLDER_DATABASE_ID = "00000000-0000-0000-0000-000000000000";
// Never uploaded: local-only settings (including the Stripe sandbox keys, which only
// localhost uses), and the deploy credentials themselves.
const LOCAL_ONLY_KEYS = [
  "CREW_DEV_LOGIN", "STRIPE_CREW_SANDBOX_SECRET_KEY", "STRIPE_CREW_SANDBOX_WEBHOOK_SECRET",
  "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID",
];

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

const [command, ...args] = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

if (command === "dev") dev();
else if (command === "site") site(args.includes("--build-webapp"));
else if (command === "deploy") await deploy();
else if (command === "check") await check();
else fail("usage: node scripts/crew.mjs <dev|site|deploy> [--env-file <path>] [--build-webapp] [--skip-webapp-build]");

function dev() {
  const envFile = resolveEnvFile("crew_env_file", option("--env-file"));
  console.log(`Crew settings: ${envFile}`);
  linkDevSite();
  run("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local"]);
  run("npx", [
    "wrangler", "dev",
    "--env-file", envFile,
    "--assets", relative(CREW_DIR, DEV_SITE_DIR),
    "--var", `WEBAPP_DEV_ORIGIN:${WEBAPP_DEV_ORIGIN}`,
    // Keep localhost as the origin instead of the studio.model.earth route.
    "--infer-origin-from-routes=false",
  ]);
}

async function deploy() {
  const crewEnvFile = resolveEnvFile("crew_env_file", option("--env-file"));
  const env = cloudflareEnv(crewEnvFile);
  const domain = readConfig().match(/"pattern":\s*"([^"]+)"/)?.[1];

  ensureDatabase(env);
  run("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--remote"], CREW_DIR, env);
  site(!args.includes("--skip-webapp-build"));

  const secretsDir = mkdtempSync(join(tmpdir(), "studio-secrets-"));
  const secretsFile = join(secretsDir, "secrets.json");
  try {
    const secrets = workerSecrets(crewEnvFile);
    writeFileSync(secretsFile, JSON.stringify(secrets), { mode: 0o600 });
    console.log(`Secrets to upload: ${Object.keys(secrets).join(", ") || "(none)"}`);
    if (secrets.CREW_ADMIN_GITHUB_LOGINS) console.log(`Crew admins: ${secrets.CREW_ADMIN_GITHUB_LOGINS}`);
    run("npx", ["wrangler", "deploy", "--secrets-file", secretsFile], CREW_DIR, env);
  } finally {
    rmSync(secretsDir, { recursive: true, force: true });
  }

  if (domain) await checkLive(`https://${domain}/crew/health`);
}

// Read-only: what `deploy` needs, and what to fix. Changes nothing.
async function check() {
  const crewEnvFile = resolveEnvFile("crew_env_file", option("--env-file"));
  const env = cloudflareEnv(crewEnvFile);
  const domain = readConfig().match(/"pattern":\s*"([^"]+)"/)?.[1] ?? "";
  const zone = domain.split(".").slice(-2).join(".");
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const results = [];
  const report = (ok, label, fix = "") => results.push(`${ok ? "ok     " : "NEEDED "} ${label}${ok || !fix ? "" : `\n          ${fix}`}`);
  const api = async (path) => {
    const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
    });
    return response.json().catch(() => ({ success: false }));
  };

  if (env.CLOUDFLARE_API_TOKEN) {
    const tokenFix = "Cloudflare dashboard > My Profile > API Tokens: add this permission to the token.";
    const verify = await api("/user/tokens/verify");
    report(verify.success && verify.result?.status === "active", "Cloudflare token is active", "Check CLOUDFLARE_API_TOKEN.");
    const zones = await api(`/zones?name=${zone}`);
    report(zones.success && zones.result?.length > 0, `Token can reach the ${zone} zone (for ${domain})`, tokenFix + ` Zone resources: ${zone}.`);
    const scripts = await api(`/accounts/${accountId}/workers/scripts`);
    report(scripts.success, "Token can manage Workers (Account > Workers Scripts > Edit)", tokenFix);
    const databases = await api(`/accounts/${accountId}/d1/database?per_page=100`);
    report(databases.success, "Token can manage D1 databases (Account > D1 > Edit)", tokenFix);
  } else {
    report(true, "Using a `npx wrangler login` session (--wrangler-login); Cloudflare access not checked");
  }

  const admins = readEnv(crewEnvFile, "CREW_ADMIN_GITHUB_LOGINS");
  report(!!admins && !/\bcrew-admin\b/.test(admins), "CREW_ADMIN_GITHUB_LOGINS lists real GitHub logins",
    `In ${crewEnvFile}, set it to the GitHub logins that accept bids (crew-admin is the local test user).`);
  const app = githubApps(crewEnvFile).find((named) => named.ready && named.hosts.includes(domain));
  const fallbackApp = !!readEnv(crewEnvFile, "GITHUB_CLIENT_ID") && !!readEnv(crewEnvFile, "GITHUB_CLIENT_SECRET");
  report(!!app || fallbackApp,
    `GitHub sign-in${app ? ` (${app.title ? `"${app.title}", ` : ""}GITHUB_${app.name}_ keys)` : ""} (optional to deploy; without it nobody can sign in)`,
    `Create a GitHub OAuth app with callback https://${domain}/crew/auth/callback, then set GITHUB_<NAME>_HOST=${domain}, GITHUB_<NAME>_CLIENT_ID and GITHUB_<NAME>_CLIENT_SECRET (see crew/README.md).`);
  const liveKey = readEnv(crewEnvFile, "STRIPE_CREW_SECRET_KEY") ?? "";
  report(/^(sk|rk)_live_/.test(liveKey), "Live Stripe key (optional to deploy; without it payments are off)",
    `Set STRIPE_CREW_SECRET_KEY to the crew account's live secret key (sk_live_...). Sandbox keys go in STRIPE_CREW_SANDBOX_SECRET_KEY, for localhost only.`);
  report(/^whsec_/.test(readEnv(crewEnvFile, "STRIPE_CREW_WEBHOOK_SECRET") ?? ""), "Live Stripe webhook secrets",
    `Set STRIPE_CREW_WEBHOOK_SECRET to the signing secrets, comma-separated, of the live webhook endpoints at https://${domain}/crew/webhook (see crew/README.md).`);

  console.log(`Deploy check for ${domain}\n\n${results.join("\n")}`);
  console.log(`\nWhen the Cloudflare and admin lines are ok, run: npm run deploy`);
}

// Locally the hub's folders are linked, so edits show without a rebuild.
function linkDevSite() {
  mkdirSync(DEV_SITE_DIR, { recursive: true });
  for (const [served, folder] of Object.entries(SITE_FOLDERS)) {
    const link = join(DEV_SITE_DIR, served);
    mkdirSync(dirname(link), { recursive: true });
    const target = relative(dirname(link), join(CREW_DIR, folder));
    let current = null;
    try { current = readlinkSync(link); } catch {}
    if (current === target) continue;
    if (current !== null) unlinkSync(link);
    symlinkSync(target, link);
  }
  cpSync(ASSETS_IGNORE, join(DEV_SITE_DIR, ".assetsignore"));
}

function site(buildWebapp) {
  requireSubmodules();
  if (buildWebapp) {
    run(join(REPO_DIR, "automation/frontend-install.sh"), [], REPO_DIR);
    run("npm", ["--prefix", "frontend", "run", "build:webapp"], REPO_DIR);
  }
  if (!existsSync(join(WEBAPP_DIST, "index.html"))) {
    fail(`no webapp build in ${WEBAPP_DIST}. Run: npm run build (which passes --build-webapp).`);
  }
  if (existsSync(SITE_DIR)) run("trash", [SITE_DIR]);

  cpSync(WEBAPP_DIST, SITE_DIR, { recursive: true });
  for (const [served, folder] of Object.entries(SITE_FOLDERS)) {
    cpSync(join(CREW_DIR, folder), join(SITE_DIR, served), {
      recursive: true,
      filter: (source) => !/(^|\/)(\.[^/]+|node_modules)(\/|$)/.test(relative(CREW_DIR, source)),
    });
  }
  // The webapp's catch-all "/* /index.html 200" would also catch the hub, and the
  // single-page-application setting in wrangler.jsonc already does that job.
  const redirects = join(SITE_DIR, "_redirects");
  if (existsSync(redirects)) {
    const kept = readFileSync(redirects, "utf8").split("\n").filter((line) => !/^\/\*\s+\/index\.html\s+200/.test(line.trim()));
    writeFileSync(redirects, kept.join("\n"));
  }
  cpSync(ASSETS_IGNORE, join(SITE_DIR, ".assetsignore"));
  console.log(`Site ready in ${relative(process.cwd(), SITE_DIR) || "."}: webapp, ${Object.keys(SITE_FOLDERS).join(", ")}`);
}

// CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from the shell, or from
// the crew env file, or cloudflare_env_file:. --wrangler-login uses `npx wrangler login` instead.
function cloudflareEnv(crewEnvFile) {
  if (args.includes("--wrangler-login")) {
    const { CLOUDFLARE_API_TOKEN, ...env } = process.env;
    return env;
  }
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env;
  const files = [crewEnvFile];
  if (readPathSetting("cloudflare_env_file")) files.push(resolveEnvFile("cloudflare_env_file"));
  for (const file of files) {
    const token = readEnv(file, "CLOUDFLARE_API_TOKEN");
    const accountId = readEnv(file, "CLOUDFLARE_ACCOUNT_ID");
    if (token && accountId) {
      console.log(`Cloudflare account from ${file}`);
      return { ...process.env, CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: accountId };
    }
  }
  fail("set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the crew env file, or name another env file with cloudflare_env_file: in automation/paths.yaml.");
}

// Creates the D1 database on the first deploy and writes its id into wrangler.jsonc.
function ensureDatabase(env) {
  const config = readConfig();
  if (!config.includes(PLACEHOLDER_DATABASE_ID)) return;
  const name = config.match(/"database_name":\s*"([^"]+)"/)?.[1];
  if (!name) fail(`no database_name in ${WRANGLER_CONFIG}.`);

  const list = capture("npx", ["wrangler", "d1", "list", "--json"], env);
  let id = JSON.parse(list).find((database) => database.name === name)?.uuid;
  if (!id) {
    console.log(`Creating D1 database ${name}`);
    id = capture("npx", ["wrangler", "d1", "create", name], env).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
    if (!id) fail(`couldn't read the new database id for ${name}.`);
  }
  writeFileSync(WRANGLER_CONFIG, config.replace(PLACEHOLDER_DATABASE_ID, id));
  console.log(`D1 database ${name}: ${id} (saved in wrangler.jsonc)`);
}

// Every set KEY= in the crew env file, minus local-only keys (including GitHub apps
// only for localhost) and the vars in wrangler.jsonc.
function workerSecrets(envFile) {
  const vars = Object.keys(JSON.parse(readConfig().match(/"vars":\s*(\{[^}]*\})/)?.[1] ?? "{}"));
  const localOnly = new Set(LOCAL_ONLY_KEYS);
  for (const app of githubApps(envFile)) {
    if (app.hosts.length && app.hosts.every((host) => LOCAL_HOST.test(host))) app.keys.forEach((key) => localOnly.add(key));
  }
  const secrets = {};
  for (const key of envKeys(envFile)) {
    if (localOnly.has(key) || vars.includes(key)) continue;
    const value = readEnv(envFile, key);
    if (value) secrets[key] = value;
  }
  return secrets;
}

// The GitHub OAuth apps named in the crew env file: GITHUB_<NAME>_NAME (application name),
// GITHUB_<NAME>_HOST (comma-separated hosts), GITHUB_<NAME>_CLIENT_ID and GITHUB_<NAME>_CLIENT_SECRET.
function githubApps(envFile) {
  return envKeys(envFile).map((key) => key.match(/^GITHUB_(.+)_HOST$/)?.[1]).filter(Boolean).map((name) => ({
    name,
    title: readEnv(envFile, `GITHUB_${name}_NAME`),
    hosts: (readEnv(envFile, `GITHUB_${name}_HOST`) ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean),
    keys: [`GITHUB_${name}_NAME`, `GITHUB_${name}_HOST`, `GITHUB_${name}_CLIENT_ID`, `GITHUB_${name}_CLIENT_SECRET`],
    ready: !!readEnv(envFile, `GITHUB_${name}_CLIENT_ID`) && !!readEnv(envFile, `GITHUB_${name}_CLIENT_SECRET`),
  }));
}

function envKeys(envFile) {
  return [...new Set(readFileSync(envFile, "utf8").split("\n").map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1]).filter(Boolean))];
}

async function checkLive(url) {
  for (let attempt = 1; attempt <= 12; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return console.log(`Live: ${url}`);
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  console.log(`Deployed, but ${url} isn't answering yet. A new custom domain's certificate can take a few minutes.`);
}

function requireSubmodules() {
  for (const folder of SUBMODULES) {
    if (!existsSync(join(CREW_DIR, folder, "index.html")) && !existsSync(join(CREW_DIR, folder, "README.md"))) {
      fail(`crew/${folder} is empty. Run: git submodule update --init crew/${folder}`);
    }
  }
}

function readConfig() {
  return readFileSync(WRANGLER_CONFIG, "utf8");
}

function capture(cmd, cmdArgs, env) {
  const result = spawnSync(cmd, cmdArgs, { cwd: CREW_DIR, env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout;
}

function run(cmd, cmdArgs, cwd = CREW_DIR, env = process.env) {
  const result = spawnSync(cmd, cmdArgs, { cwd, env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
