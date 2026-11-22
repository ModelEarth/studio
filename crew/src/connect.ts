import { basePath, Env, stripeConfigured } from "./env";
import { esc, page, redirect } from "./html";
import { stripe, stripeV2 } from "./stripe";
import { CrewMember, setMemberStripeAccount, setTransfersActive } from "./db";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface StripeAccount {
  id: string;
  capabilities?: { transfers?: string };
}

export async function connectPage(request: Request, env: Env, user: CrewMember | null, error = "", email = ""): Promise<Response> {
  const base = basePath(env);
  if (!user) return redirect(`${base}/login?next=${encodeURIComponent(`${base}/connect`)}`);
  if (!stripeConfigured(env)) {
    return page(env, "Payouts", `<h1>Payouts</h1><div class="notice">Payouts aren't set up yet. Add the crew's Stripe keys to the crew env file (see crew/README.md).</div>`, user, 503);
  }
  let status: string;
  if (user.transfers_active) {
    status = `<p><span class="status paid">active</span> Stripe can send you payments for bids and tips.</p>
<form method="post" action="${base}/connect/dashboard"><button class="secondary">Open your Stripe payouts dashboard</button></form>`;
  } else if (user.stripe_account_id) {
    status = `<p><span class="status pending">incomplete</span> Finish your Stripe details to receive payments.</p>
<form method="post" action="${base}/connect"><button>Continue Stripe setup</button></form>`;
  } else {
    status = `<p>Crew members are paid through Stripe. Set up a Stripe Express account to receive payments for accepted bids and tips.</p>
<form method="post" action="${base}/connect">
  <label for="email">Email for your Stripe account</label>
  <input id="email" name="email" type="email" required maxlength="254" autocomplete="email" value="${esc(email)}">
  <p><button>Set up payouts with Stripe</button></p>
</form>`;
  }
  const notice = error ? `<div class="notice">${esc(error)}</div>` : "";
  return page(env, "Payouts", `<h1>Payouts</h1>${notice}<div class="card">${status}</div>`, user, error ? 400 : 200);
}

/**
 * Creates the crew member's Express account if needed, then sends them to Stripe onboarding.
 * The account is a recipient: it receives transfers from the platform's destination charges,
 * and the platform collects Stripe's fees and covers losses.
 */
export async function startOnboarding(request: Request, env: Env, user: CrewMember | null): Promise<Response> {
  const base = basePath(env);
  if (!user) return redirect(`${base}/login`);
  let accountId = user.stripe_account_id;
  if (!accountId) {
    const form = await request.formData();
    const email = String(form.get("email") ?? "").trim();
    if (!EMAIL.test(email)) return connectPage(request, env, user, "Enter the email address for your Stripe account.", email);
    const account = await stripeV2<{ id: string }>(env, "POST", "/core/accounts", {
      contact_email: email,
      display_name: user.github_login,
      dashboard: "express",
      identity: { country: "US" },
      defaults: { responsibilities: { fees_collector: "application", losses_collector: "application" } },
      configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
      metadata: { github_id: String(user.github_id), github_login: user.github_login },
    });
    accountId = account.id;
    await setMemberStripeAccount(env, user.github_id, accountId);
  }
  return redirect(await onboardingLink(request, env, accountId));
}

export async function onboardingReturn(request: Request, env: Env, user: CrewMember | null): Promise<Response> {
  const base = basePath(env);
  if (user?.stripe_account_id) {
    const account = await stripe<StripeAccount>(env, "GET", `/accounts/${user.stripe_account_id}`);
    await setTransfersActive(env, account.id, account.capabilities?.transfers === "active");
  }
  return redirect(`${base}/connect`);
}

/** Stripe sends people here when an onboarding link expires. */
export async function onboardingRefresh(request: Request, env: Env, user: CrewMember | null): Promise<Response> {
  if (!user?.stripe_account_id) return redirect(`${basePath(env)}/connect`);
  return redirect(await onboardingLink(request, env, user.stripe_account_id));
}

export async function expressDashboard(request: Request, env: Env, user: CrewMember | null): Promise<Response> {
  if (!user?.stripe_account_id) return redirect(`${basePath(env)}/connect`);
  const link = await stripe<{ url: string }>(env, "POST", `/accounts/${user.stripe_account_id}/login_links`);
  return redirect(link.url);
}

async function onboardingLink(request: Request, env: Env, accountId: string): Promise<string> {
  const origin = `${new URL(request.url).origin}${basePath(env)}`;
  const link = await stripe<{ url: string }>(env, "POST", "/account_links", {
    account: accountId,
    type: "account_onboarding",
    refresh_url: `${origin}/connect/refresh`,
    return_url: `${origin}/connect/return`,
  });
  return link.url;
}
