import { basePath, Env, requestEnv } from "./env";
import { esc, page, redirect } from "./html";
import { currentUser, isSameOrigin } from "./session";
import { callback, devLogin, login, logout } from "./auth";
import { bidPage, changeBid, submitBid } from "./bids";
import { payBounty, payDone, payForWork, payPage, payTip } from "./payments";
import { bountyPage, submitBounty, withdrawBounty } from "./bounties";
import { connectPage, expressDashboard, onboardingRefresh, onboardingReturn, startOnboarding } from "./connect";
import { homePage } from "./home";
import { stripeWebhook } from "./webhook";
import { StripeError } from "./stripe";
import { serveSite } from "./site";

export default {
  async fetch(request: Request, workerEnv: Env): Promise<Response> {
    const env = requestEnv(request, workerEnv);
    const { pathname } = new URL(request.url);
    const base = basePath(env);
    if (pathname !== base && !pathname.startsWith(`${base}/`)) return serveSite(request, env);
    try {
      return await route(request, env);
    } catch (error) {
      console.error(error);
      const message = error instanceof StripeError ? `Stripe: ${error.message}` : "Something went wrong. Please try again.";
      return page(env, "Error", `<h1>Error</h1><div class="notice">${esc(message)}</div>`, null, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const base = basePath(env);
  if (url.pathname === base) return redirect(`${base}/`);

  const path = url.pathname.slice(base.length);
  const method = request.method;

  if (path === "/health") return new Response("ok");
  // crew/css, copied into the site (scripts/crew.mjs) and added to the webapp's pages.
  if (path.startsWith("/css/") && method === "GET") return env.ASSETS.fetch(request);
  // Stripe signs webhooks, so they skip the same-origin form check below.
  if (path === "/webhook" && method === "POST") return stripeWebhook(request, env);
  if (method === "POST" && !isSameOrigin(request)) return new Response("Forbidden", { status: 403 });

  if (path === "/login" && method === "GET") return login(request, env);
  if (path === "/auth/callback" && method === "GET") return callback(request, env);
  if (path === "/dev-login" && method === "GET") return devLogin(request, env);
  if (path === "/logout" && method === "POST") return logout(request, env);

  const user = await currentUser(request, env);
  if (path === "/" && method === "GET") return homePage(env, user);
  if (path === "/bid" && method === "GET") return bidPage(request, env, user);
  if (path === "/bid" && method === "POST") return submitBid(request, env, user);
  const bidAction = path.match(/^\/bid\/(\d+)\/(accept|reject|withdraw|deliver)$/);
  if (bidAction && method === "POST") return changeBid(request, env, user, Number(bidAction[1]), bidAction[2]);

  if (path === "/bounty" && method === "GET") return bountyPage(request, env, user);
  if (path === "/bounty" && method === "POST") return submitBounty(request, env, user);
  const bountyAction = path.match(/^\/bounty\/(\d+)\/withdraw$/);
  if (bountyAction && method === "POST") return withdrawBounty(request, env, user, Number(bountyAction[1]));

  if (path === "/pay" && method === "GET") return payPage(request, env, user);
  if (path === "/pay/work" && method === "POST") return payForWork(request, env, user);
  if (path === "/pay/tip" && method === "POST") return payTip(request, env, user);
  if (path === "/pay/bounty" && method === "POST") return payBounty(request, env, user);
  if (path === "/pay/done" && method === "GET") return payDone(request, env, user);

  if (path === "/connect" && method === "GET") return connectPage(request, env, user);
  if (path === "/connect" && method === "POST") return startOnboarding(request, env, user);
  if (path === "/connect/return" && method === "GET") return onboardingReturn(request, env, user);
  if (path === "/connect/refresh" && method === "GET") return onboardingRefresh(request, env, user);
  if (path === "/connect/dashboard" && method === "POST") return expressDashboard(request, env, user);

  return page(env, "Not found", "<h1>Not found</h1>", user, 404);
}
