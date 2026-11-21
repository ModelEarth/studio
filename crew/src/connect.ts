import { basePath, Env, stripeConfigured } from "./env";
import { page, redirect } from "./html";
import { stripe } from "./stripe";
import { CrewMember, setMemberStripeAccount, setTransfersActive } from "./db";

interface StripeAccount {
  id: string;
  capabilities?: { transfers?: string };
}

export async function connectPage(request: Request, env: Env, user: CrewMember | null): Promise<Response> {
  const base = basePath(env);
  if (!user) return redirect(`${base}/login?next=${encodeURIComponent(`${base}/connect`)}`);
  if (!stripeConfigured(env)) {
    return page(env, "Payouts", `<h1>Payouts</h1><div class="notice">Payouts aren't set up yet. Add STRIPE_CREW_SECRET_KEY to crew/.env.</div>`, user, 503);
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
<form method="post" action="${base}/connect"><button>Set up payouts with Stripe</button></form>`;
  }
  return page(env, "Payouts", `<h1>Payouts</h1><div class="card">${status}</div>`, user);
}

/** Creates the crew member's Express account if needed, then sends them to Stripe onboarding. */
export async function startOnboarding(request: Request, env: Env, user: CrewMember | null): Promise<Response> {
  const base = basePath(env);
  if (!user) return redirect(`${base}/login`);
  let accountId = user.stripe_account_id;
  if (!accountId) {
    const account = await stripe<StripeAccount>(env, "POST", "/accounts", {
      type: "express",
      capabilities: { transfers: { requested: true } },
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
