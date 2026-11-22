import { basePath, currency, Env } from "./env";
import { esc, money, page, redirect } from "./html";
import { issueHeader, loadIssue, MAX_AMOUNT_CENTS, MIN_AMOUNT_CENTS, parseAmountCents } from "./bids";
import {
  BountyWithSponsor, CrewMember, findOpenBounty, getBounty, hasPendingOrPaidBountyPayment, insertBounty, listBountiesForIssue,
  setBountyStatus, updateBountyOffer,
} from "./db";

/** Total of the open bounties on an issue, for the bid and payment pages. */
export function bountyTotalHtml(env: Env, bounties: BountyWithSponsor[], query: string): string {
  const open = bounties.filter((bounty) => bounty.status === "open");
  const base = basePath(env);
  if (open.length === 0) return `<p class="muted">No bounty offered yet. <a href="${base}/bounty?${query}">Offer a bounty</a></p>`;
  const total = open.reduce((sum, bounty) => sum + bounty.amount_cents, 0);
  const sponsors = open.length === 1 ? "1 sponsor" : `${open.length} sponsors`;
  return `<p>Bounty for a satisfactory production: <strong>${money(total, open[0].currency)}</strong> from ${sponsors}. <a href="${base}/bounty?${query}">Bounty details</a></p>`;
}

export async function bountyPage(request: Request, env: Env, user: CrewMember | null, notice = ""): Promise<Response> {
  const url = new URL(request.url);
  const ref = await loadIssue(env, url.searchParams.get("repo"), url.searchParams.get("issue"));
  if (typeof ref === "string") return page(env, "Bounty", `<h1>Bounty</h1><div class="notice">${esc(ref)}</div>`, user, 400);

  const base = basePath(env);
  const query = `repo=${encodeURIComponent(ref.repo)}&issue=${ref.issueNumber}`;
  const bounties = await listBountiesForIssue(env, ref.repo, ref.issueNumber);
  const mine = user ? bounties.find((bounty) => bounty.github_id === user.github_id && bounty.status === "open") : undefined;

  const form = !user
    ? `<p><a href="${base}/login?next=${encodeURIComponent(`${base}/bounty?${query}`)}">Sign in with GitHub</a> to offer a bounty.</p>`
    : ref.issue.state !== "open" && !mine
      ? `<p class="muted">This issue is closed, so it isn't taking new bounties.</p>`
      : `<form method="post" action="${base}/bounty" class="card">
  <input type="hidden" name="repo" value="${esc(ref.repo)}">
  <input type="hidden" name="issue" value="${ref.issueNumber}">
  <label for="amount">${mine ? "Update your bounty" : "Your bounty"} (${esc(currency(env).toUpperCase())})</label>
  <input id="amount" name="amount" inputmode="decimal" required placeholder="500.00" value="${mine ? (mine.amount_cents / 100).toFixed(2) : ""}">
  <label for="note">What a satisfactory production includes</label>
  <textarea id="note" name="note" maxlength="2000">${esc(mine?.note ?? "")}</textarea>
  <button>${mine ? "Update bounty" : "Offer bounty"}</button>
  <p class="muted">You pay it on the <a href="${base}/pay?${query}">Payment page</a>, to the crew member whose work satisfies you.</p>
</form>
${mine ? `<form method="post" action="${base}/bounty/${mine.id}/withdraw" class="inline"><button class="secondary small">Withdraw your bounty</button></form>` : ""}`;

  const rows = bounties.map((bounty) => `<tr><td>@${esc(bounty.github_login)}</td><td>${money(bounty.amount_cents, bounty.currency)}</td>
<td>${esc(bounty.note ?? "")}</td><td><span class="status ${bounty.status === "paid" ? "paid" : "pending"}">${esc(bounty.status)}</span></td></tr>`);

  const body = `${issueHeader(ref)}
${notice ? `<div class="notice">${esc(notice)}</div>` : ""}
<p><a href="${base}/bid?${query}">Bids for this issue</a> · <a href="${base}/pay?${query}">Payments and tips</a></p>
<p class="muted">A bounty is the amount a sponsor offers for a satisfactory production of this issue. Crew members see it when they bid.</p>
<h2>Bounties</h2>
${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Sponsor</th><th>Amount</th><th>Satisfactory when</th><th>Status</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>` : `<p class="muted">No bounties yet.</p>`}
${form}`;
  return page(env, `Bounty: ${ref.issue.title}`, body, user);
}

export async function submitBounty(request: Request, env: Env, user: CrewMember | null): Promise<Response> {
  const base = basePath(env);
  if (!user) return redirect(`${base}/login`);
  const form = await request.formData();
  const ref = await loadIssue(env, String(form.get("repo") ?? ""), String(form.get("issue") ?? ""));
  if (typeof ref === "string") return page(env, "Bounty", `<h1>Bounty</h1><div class="notice">${esc(ref)}</div>`, user, 400);
  const back = `${base}/bounty?repo=${encodeURIComponent(ref.repo)}&issue=${ref.issueNumber}`;
  const existing = await findOpenBounty(env, ref.repo, ref.issueNumber, user.github_id);
  if (ref.issue.state !== "open" && !existing) return redirect(back);

  const amount = parseAmountCents(form.get("amount"));
  if (!amount) {
    return bountyPage(new Request(`${new URL(request.url).origin}${back}`), env, user,
      `Enter an amount from ${money(MIN_AMOUNT_CENTS, currency(env))} to ${money(MAX_AMOUNT_CENTS, currency(env))}.`);
  }
  const note = String(form.get("note") ?? "").trim().slice(0, 2000) || null;
  if (existing) {
    if (await hasPendingOrPaidBountyPayment(env, existing.id)) {
      return bountyPage(new Request(`${new URL(request.url).origin}${back}`), env, user, "Your bounty is being paid, so it can't change now.");
    }
    await updateBountyOffer(env, existing.id, amount, note);
  } else {
    await insertBounty(env, {
      repo: ref.repo, issue_number: ref.issueNumber, issue_title: ref.issue.title, issue_url: ref.issue.html_url,
      github_id: user.github_id, amount_cents: amount, currency: currency(env), note,
    });
  }
  return redirect(back);
}

export async function withdrawBounty(request: Request, env: Env, user: CrewMember | null, bountyId: number): Promise<Response> {
  const base = basePath(env);
  if (!user) return redirect(`${base}/login`);
  const bounty = await getBounty(env, bountyId);
  if (!bounty || bounty.github_id !== user.github_id) return page(env, "Bounty", "<h1>Bounty not found</h1>", user, 404);
  const back = `${base}/bounty?repo=${encodeURIComponent(bounty.repo)}&issue=${bounty.issue_number}`;
  if (bounty.status === "open" && !(await hasPendingOrPaidBountyPayment(env, bounty.id))) {
    await setBountyStatus(env, bounty.id, "withdrawn");
  }
  return redirect(back);
}
