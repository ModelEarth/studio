import { basePath, Env, isAdmin } from "./env";
import { esc, money, page } from "./html";
import { CrewMember, listBidsForMember, listBountiesForSponsor, listOpenBids, listPaymentsReceived } from "./db";
import { paymentKindLabel } from "./payments";

export async function homePage(env: Env, user: CrewMember | null): Promise<Response> {
  const base = basePath(env);
  if (!user) {
    return page(env, "Crew", `<h1>Crew</h1>
<p>Crew members bid on project issues, deliver creative work, and get paid through Stripe, including tips and fees from people following their productions.</p>
<p><a href="${base}/login">Sign in with GitHub</a> to bid, offer bounties and set up payouts. Use the Bid, Payment and Bounty links on the projects hub to open an issue here.</p>`, null);
  }

  const [bids, payments, bounties] = await Promise.all([
    listBidsForMember(env, user.github_id), listPaymentsReceived(env, user.github_id), listBountiesForSponsor(env, user.github_id),
  ]);
  const issueLink = (repo: string, issueNumber: number) =>
    `<a href="${base}/bid?repo=${encodeURIComponent(repo)}&issue=${issueNumber}">${esc(repo)}#${issueNumber}</a>`;
  const bountyLink = (repo: string, issueNumber: number) =>
    `<a href="${base}/bounty?repo=${encodeURIComponent(repo)}&issue=${issueNumber}">${esc(repo)}#${issueNumber}</a>`;

  let review = "";
  if (isAdmin(env, user.github_login)) {
    const open = await listOpenBids(env);
    const rows = open.map((bid) => `<tr><td>${issueLink(bid.repo, bid.issue_number)} ${esc(bid.issue_title ?? "")}</td>
<td>@${esc(bid.github_login)}</td><td>${money(bid.amount_cents, bid.currency)}</td><td><span class="status ${esc(bid.status)}">${esc(bid.status)}</span></td></tr>`);
    review = `<h2>Bids to review</h2>${rows.length
      ? `<div class="table-wrap"><table><thead><tr><th>Issue</th><th>Crew member</th><th>Bid</th><th>Status</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`
      : `<p class="muted">Nothing waiting.</p>`}`;
  }

  const bidRows = bids.map((bid) => `<tr><td>${issueLink(bid.repo, bid.issue_number)} ${esc(bid.issue_title ?? "")}</td>
<td>${money(bid.amount_cents, bid.currency)}</td><td><span class="status ${esc(bid.status)}">${esc(bid.status)}</span></td></tr>`);
  const bountyRows = bounties.map((bounty) => `<tr><td>${bountyLink(bounty.repo, bounty.issue_number)} ${esc(bounty.issue_title ?? "")}</td>
<td>${money(bounty.amount_cents, bounty.currency)}</td><td><span class="status ${bounty.status === "paid" ? "paid" : "pending"}">${esc(bounty.status)}</span></td></tr>`);
  const paymentRows = payments.map((payment) => `<tr><td>${paymentKindLabel(payment.kind)}</td>
<td>${issueLink(payment.repo, payment.issue_number)}</td><td>${money(payment.amount_cents - payment.platform_fee_cents, payment.currency)}</td>
<td><span class="status ${esc(payment.status)}">${esc(payment.status)}</span></td></tr>`);

  const body = `<h1>Crew</h1>
<div class="card">Payouts: ${user.transfers_active ? `<span class="status paid">active</span>` : `<a href="${base}/connect">set up payouts</a> to be paid`}</div>
${review}
<h2>Your bids</h2>
${bidRows.length ? `<div class="table-wrap"><table><thead><tr><th>Issue</th><th>Bid</th><th>Status</th></tr></thead><tbody>${bidRows.join("")}</tbody></table></div>` : `<p class="muted">No bids yet. Open an issue from the projects hub and choose Bid.</p>`}
${bountyRows.length ? `<h2>Your bounties</h2>
<div class="table-wrap"><table><thead><tr><th>Issue</th><th>Bounty</th><th>Status</th></tr></thead><tbody>${bountyRows.join("")}</tbody></table></div>` : ""}
<h2>Payments received</h2>
${paymentRows.length ? `<div class="table-wrap"><table><thead><tr><th>Type</th><th>Issue</th><th>Your share</th><th>Status</th></tr></thead><tbody>${paymentRows.join("")}</tbody></table></div>` : `<p class="muted">None yet.</p>`}`;
  return page(env, "Crew", body, user);
}
