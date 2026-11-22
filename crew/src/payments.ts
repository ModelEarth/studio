import { basePath, currency, Env, feePercent, platformFeeCents, stripeConfigured } from "./env";
import { esc, money, page, redirect } from "./html";
import { issueHeader, IssueRef, loadIssue, parseAmountCents } from "./bids";
import { bountyTotalHtml } from "./bounties";
import { stripe } from "./stripe";
import {
  CrewMember, getBidWithMember, getBounty, getMember, getPaymentBySession, hasPendingOrPaidBountyPayment, hasPendingOrPaidWorkPayment,
  insertPayment, listBidsForIssue, listBountiesForIssue, listPaidPaymentsForIssue, markPaymentPaid, NewPayment, PaymentKind,
  setPaymentCheckoutSession, setPaymentStatus,
} from "./db";

const KIND_LABELS: Record<PaymentKind, string> = { work: "Work", tip: "Tip", bounty: "Bounty" };

export function paymentKindLabel(kind: PaymentKind): string {
  return KIND_LABELS[kind] ?? kind;
}

interface CheckoutSession {
  id: string;
  url: string;
  payment_status: string;
  payment_intent: string | null;
}

export async function payPage(request: Request, env: Env, user: CrewMember | null): Promise<Response> {
  const url = new URL(request.url);
  const ref = await loadIssue(env, url.searchParams.get("repo"), url.searchParams.get("issue"));
  if (typeof ref === "string") return page(env, "Payment", `<h1>Payment</h1><div class="notice">${esc(ref)}</div>`, user, 400);

  const base = basePath(env);
  const query = `repo=${encodeURIComponent(ref.repo)}&issue=${ref.issueNumber}`;
  const [bids, bounties, paid] = await Promise.all([
    listBidsForIssue(env, ref.repo, ref.issueNumber),
    listBountiesForIssue(env, ref.repo, ref.issueNumber),
    listPaidPaymentsForIssue(env, ref.repo, ref.issueNumber),
  ]);
  const signIn = `<a href="${base}/login?next=${encodeURIComponent(`${base}/pay?${query}`)}">Sign in with GitHub</a>`;
  const fee = feePercent(env);
  const feeNote = fee > 0 ? `<p class="muted">The site host keeps ${fee}% of each payment; the rest goes to the crew member through Stripe.</p>` : "";

  const workBids = bids.filter((bid) => ["accepted", "delivered", "paid"].includes(bid.status));
  const workRows = workBids.map((bid) => {
    let action = "";
    if (bid.status === "paid") action = `<span class="status paid">paid</span>`;
    else if (!bid.transfers_active) action = `<span class="muted">Waiting for @${esc(bid.github_login)} to set up payouts</span>`;
    else if (!user) action = signIn;
    else action = `<form method="post" action="${base}/pay/work" class="inline"><input type="hidden" name="bid_id" value="${bid.id}"><button class="small">Pay ${money(bid.amount_cents, bid.currency)}</button></form>`;
    return `<tr><td>@${esc(bid.github_login)}</td><td>${money(bid.amount_cents, bid.currency)}</td>
<td><span class="status ${esc(bid.status)}">${esc(bid.status)}</span>${bid.delivery_url ? ` <a href="${esc(bid.delivery_url)}" target="_blank" rel="noopener">work</a>` : ""}</td><td>${action}</td></tr>`;
  });

  // A sponsor pays their bounty to a crew member whose bid was accepted, once the work satisfies them.
  const myBounty = user ? bounties.find((bounty) => bounty.github_id === user.github_id && bounty.status === "open") : undefined;
  const bountyPayees = [...new Map(
    workBids.filter((bid) => bid.transfers_active).map((bid) => [bid.github_id, bid]),
  ).values()];
  const bountyForm = !myBounty
    ? ""
    : bountyPayees.length === 0
      ? `<p class="muted">Your bounty of ${money(myBounty.amount_cents, myBounty.currency)} can be paid once a crew member's bid is accepted and they've set up payouts.</p>`
      : `<form method="post" action="${base}/pay/bounty" class="card">
  <input type="hidden" name="bounty_id" value="${myBounty.id}">
  <label for="bounty-payee">Pay your bounty to the crew member whose production satisfies you</label>
  <select id="bounty-payee" name="payee">${bountyPayees.map((bid) => `<option value="${bid.github_id}">@${esc(bid.github_login)}</option>`).join("")}</select>
  <button>Pay bounty ${money(myBounty.amount_cents, myBounty.currency)}</button>
</form>`;

  const tipCandidates = [...new Map(
    bids.filter((bid) => bid.transfers_active && !["withdrawn", "rejected"].includes(bid.status)).map((bid) => [bid.github_id, bid]),
  ).values()];
  const tipForm = !user
    ? `<p>${signIn} to send a tip or fee.</p>`
    : tipCandidates.length === 0
      ? `<p class="muted">No crew member on this issue can receive payments yet.</p>`
      : `<form method="post" action="${base}/pay/tip" class="card">
  <input type="hidden" name="repo" value="${esc(ref.repo)}">
  <input type="hidden" name="issue" value="${ref.issueNumber}">
  <label for="payee">Crew member</label>
  <select id="payee" name="payee">${tipCandidates.map((bid) => `<option value="${bid.github_id}">@${esc(bid.github_login)}</option>`).join("")}</select>
  <label for="amount">Amount (${esc(currency(env).toUpperCase())})</label>
  <input id="amount" name="amount" inputmode="decimal" required placeholder="5.00">
  <label for="note">Note (optional)</label>
  <input id="note" name="note" maxlength="200">
  <button>Send tip</button>
</form>`;

  const paidRows = paid.map((payment) => `<tr><td>${paymentKindLabel(payment.kind)}</td><td>@${esc(payment.payee_login)}</td>
<td>${money(payment.amount_cents, payment.currency)}</td><td>${esc(payment.note ?? "")}</td></tr>`);

  const body = `${issueHeader(ref)}
<p><a href="${base}/bid?${query}">Bids for this issue</a></p>
${bountyTotalHtml(env, bounties, query)}
${stripeConfigured(env) ? "" : `<div class="notice">Payments aren't set up yet. Add the crew's Stripe keys to the crew env file (see crew/README.md).</div>`}
<h2>Pay for work</h2>
${workRows.length ? `<div class="table-wrap"><table><thead><tr><th>Crew member</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>${workRows.join("")}</tbody></table></div>` : `<p class="muted">No accepted bids yet.</p>`}
${bountyForm ? `<h2>Your bounty</h2>\n${bountyForm}` : ""}
<h2>Tips and fees</h2>
<p class="muted">Support crew members working on this production.</p>
${tipForm}
${feeNote}
${paidRows.length ? `<h2>Received</h2><div class="table-wrap"><table><thead><tr><th>Type</th><th>Crew member</th><th>Amount</th><th>Note</th></tr></thead><tbody>${paidRows.join("")}</tbody></table></div>` : ""}`;
  return page(env, `Payment: ${ref.issue.title}`, body, user);
}

export async function payForWork(request: Request, env: Env, user: CrewMember | null): Promise<Response> {
  const base = basePath(env);
  if (!user) return redirect(`${base}/login`);
  const form = await request.formData();
  const bid = await getBidWithMember(env, Number(form.get("bid_id")));
  if (!bid) return page(env, "Payment", "<h1>Bid not found</h1>", user, 404);
  const back = `${base}/pay?repo=${encodeURIComponent(bid.repo)}&issue=${bid.issue_number}`;
  if (!["accepted", "delivered"].includes(bid.status) || await hasPendingOrPaidWorkPayment(env, bid.id)) {
    return page(env, "Payment", `<h1>This bid is already paid or being paid</h1><p><a href="${back}">Back</a></p>`, user, 409);
  }
  const payee = await getMember(env, bid.github_id);
  if (!payee?.stripe_account_id || !payee.transfers_active) {
    return page(env, "Payment", `<h1>@${esc(bid.github_login)} hasn't set up payouts yet</h1><p><a href="${back}">Back</a></p>`, user, 409);
  }
  return startCheckout(request, env, {
    kind: "work", bid_id: bid.id, bounty_id: null, repo: bid.repo, issue_number: bid.issue_number, payer_github_id: user.github_id,
    payee_github_id: payee.github_id, amount_cents: bid.amount_cents, platform_fee_cents: platformFeeCents(env, bid.amount_cents),
    currency: bid.currency, note: null,
  }, payee, `Work on ${bid.repo}#${bid.issue_number} by @${bid.github_login}`, back);
}

export async function payTip(request: Request, env: Env, user: CrewMember | null): Promise<Response> {
  const base = basePath(env);
  if (!user) return redirect(`${base}/login`);
  const form = await request.formData();
  const ref: IssueRef | string = await loadIssue(env, String(form.get("repo") ?? ""), String(form.get("issue") ?? ""));
  if (typeof ref === "string") return page(env, "Payment", `<h1>Payment</h1><div class="notice">${esc(ref)}</div>`, user, 400);
  const back = `${base}/pay?repo=${encodeURIComponent(ref.repo)}&issue=${ref.issueNumber}`;

  const payeeId = Number(form.get("payee"));
  const onIssue = (await listBidsForIssue(env, ref.repo, ref.issueNumber)).some((bid) => bid.github_id === payeeId);
  const payee = onIssue ? await getMember(env, payeeId) : null;
  if (!payee?.stripe_account_id || !payee.transfers_active) {
    return page(env, "Payment", `<h1>That crew member can't receive payments yet</h1><p><a href="${back}">Back</a></p>`, user, 409);
  }
  const amount = parseAmountCents(form.get("amount"));
  if (!amount) return page(env, "Payment", `<h1>Enter an amount of at least ${money(100, currency(env))}</h1><p><a href="${back}">Back</a></p>`, user, 400);

  return startCheckout(request, env, {
    kind: "tip", bid_id: null, bounty_id: null, repo: ref.repo, issue_number: ref.issueNumber, payer_github_id: user.github_id,
    payee_github_id: payee.github_id, amount_cents: amount, platform_fee_cents: platformFeeCents(env, amount),
    currency: currency(env), note: String(form.get("note") ?? "").trim().slice(0, 200) || null,
  }, payee, `Tip for @${payee.github_login} on ${ref.repo}#${ref.issueNumber}`, back);
}

export async function payBounty(request: Request, env: Env, user: CrewMember | null): Promise<Response> {
  const base = basePath(env);
  if (!user) return redirect(`${base}/login`);
  const form = await request.formData();
  const bounty = await getBounty(env, Number(form.get("bounty_id")));
  if (!bounty || bounty.github_id !== user.github_id) return page(env, "Payment", "<h1>Bounty not found</h1>", user, 404);
  const back = `${base}/pay?repo=${encodeURIComponent(bounty.repo)}&issue=${bounty.issue_number}`;
  if (bounty.status !== "open" || await hasPendingOrPaidBountyPayment(env, bounty.id)) {
    return page(env, "Payment", `<h1>This bounty is already paid or being paid</h1><p><a href="${back}">Back</a></p>`, user, 409);
  }
  const payeeId = Number(form.get("payee"));
  const workedOnIssue = (await listBidsForIssue(env, bounty.repo, bounty.issue_number))
    .some((bid) => bid.github_id === payeeId && ["accepted", "delivered", "paid"].includes(bid.status));
  const payee = workedOnIssue ? await getMember(env, payeeId) : null;
  if (!payee?.stripe_account_id || !payee.transfers_active) {
    return page(env, "Payment", `<h1>That crew member can't receive this bounty yet</h1><p><a href="${back}">Back</a></p>`, user, 409);
  }
  return startCheckout(request, env, {
    kind: "bounty", bid_id: null, bounty_id: bounty.id, repo: bounty.repo, issue_number: bounty.issue_number, payer_github_id: user.github_id,
    payee_github_id: payee.github_id, amount_cents: bounty.amount_cents, platform_fee_cents: platformFeeCents(env, bounty.amount_cents),
    currency: bounty.currency, note: null,
  }, payee, `Bounty for ${bounty.repo}#${bounty.issue_number}, paid to @${payee.github_login}`, back);
}

/** Return page after Checkout. Confirms with Stripe too, in case the webhook hasn't arrived. */
export async function payDone(request: Request, env: Env, user: CrewMember | null): Promise<Response> {
  const base = basePath(env);
  const sessionId = new URL(request.url).searchParams.get("session_id") ?? "";
  let payment = /^cs_[A-Za-z0-9_]+$/.test(sessionId) ? await getPaymentBySession(env, sessionId) : null;
  if (!payment) return page(env, "Payment", "<h1>Payment not found</h1>", user, 404);
  if (payment.status === "pending") {
    const session = await stripe<CheckoutSession>(env, "GET", `/checkout/sessions/${sessionId}`);
    if (session.payment_status === "paid") await markPaymentPaid(env, session.id, session.payment_intent);
    payment = await getPaymentBySession(env, sessionId);
  }
  const back = `${base}/pay?repo=${encodeURIComponent(payment!.repo)}&issue=${payment!.issue_number}`;
  const done = payment!.status === "paid";
  return page(env, "Payment", `<h1>${done ? "Thank you, payment complete" : "Payment is processing"}</h1>
<p>${money(payment!.amount_cents, payment!.currency)} ${({ work: "for work", tip: "tip", bounty: "bounty" } as const)[payment!.kind]} on ${esc(payment!.repo)}#${payment!.issue_number}.</p>
<p><a href="${back}">Back to the issue</a></p>`, user);
}

async function startCheckout(request: Request, env: Env, payment: NewPayment, payee: CrewMember, productName: string, back: string): Promise<Response> {
  const base = basePath(env);
  const origin = new URL(request.url).origin;
  const paymentId = await insertPayment(env, payment);
  const metadata = {
    crew_payment_id: String(paymentId), kind: payment.kind, repo: payment.repo, issue: String(payment.issue_number),
    payee_github_login: payee.github_login,
  };
  try {
    const session = await stripe<CheckoutSession>(env, "POST", "/checkout/sessions", {
      mode: "payment",
      client_reference_id: String(paymentId),
      success_url: `${origin}${base}/pay/done?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}${back}`,
      line_items: [{
        quantity: 1,
        price_data: { currency: payment.currency, unit_amount: payment.amount_cents, product_data: { name: productName } },
      }],
      payment_intent_data: {
        application_fee_amount: payment.platform_fee_cents > 0 ? payment.platform_fee_cents : undefined,
        transfer_data: { destination: payee.stripe_account_id },
        metadata,
      },
      metadata,
    });
    await setPaymentCheckoutSession(env, paymentId, session.id);
    return redirect(session.url);
  } catch (error) {
    await setPaymentStatus(env, paymentId, "failed");
    throw error;
  }
}
