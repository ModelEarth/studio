import { basePath, currency, Env, isAdmin, ownerAllowed } from "./env";
import { fetchIssue, GitHubIssue, parseIssueNumber, parseRepo } from "./github";
import { esc, money, page, redirect } from "./html";
import {
  BidStatus, BidWithMember, CrewMember, findOpenBid, getBidWithMember, insertBid, listBidsForIssue, setBidStatus, updateBidOffer,
} from "./db";

export const MIN_AMOUNT_CENTS = 100;
export const MAX_AMOUNT_CENTS = 10_000_000;

export interface IssueRef {
  repo: string;
  issueNumber: number;
  issue: GitHubIssue;
}

/** Reads ?repo=owner/name&issue=N (or form fields) and loads the GitHub issue. */
export async function loadIssue(env: Env, repoValue: string | null, issueValue: string | null): Promise<IssueRef | string> {
  const repo = parseRepo(repoValue);
  const issueNumber = parseIssueNumber(issueValue);
  if (!repo || !issueNumber) return "Link needs ?repo=owner/name&issue=number.";
  if (!ownerAllowed(env, repo)) return `Issues in ${repo} aren't open for crew bids on this site.`;
  const issue = await fetchIssue(env, repo, issueNumber);
  if (!issue) return `Couldn't find open issue ${repo}#${issueNumber} on GitHub.`;
  return { repo, issueNumber, issue };
}

export function issueHeader(ref: IssueRef): string {
  return `<p class="muted">${esc(ref.repo)} · issue #${ref.issueNumber} · ${esc(ref.issue.state)}</p>
<h1><a href="${esc(ref.issue.html_url)}" target="_blank" rel="noopener">${esc(ref.issue.title)}</a></h1>`;
}

export function parseAmountCents(value: unknown): number | null {
  const text = String(value ?? "").trim().replace(/^\$/, "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) return null;
  const [dollars, cents = ""] = text.split(".");
  const amount = Number(dollars) * 100 + Number((cents + "00").slice(0, 2));
  return amount >= MIN_AMOUNT_CENTS && amount <= MAX_AMOUNT_CENTS ? amount : null;
}

export async function bidPage(request: Request, env: Env, user: CrewMember | null, notice = ""): Promise<Response> {
  const url = new URL(request.url);
  const ref = await loadIssue(env, url.searchParams.get("repo"), url.searchParams.get("issue"));
  if (typeof ref === "string") return page(env, "Bid", `<h1>Bid</h1><div class="notice">${esc(ref)}</div>`, user, 400);

  const base = basePath(env);
  const bids = await listBidsForIssue(env, ref.repo, ref.issueNumber);
  const query = `repo=${encodeURIComponent(ref.repo)}&issue=${ref.issueNumber}`;
  const mine = user ? bids.find((bid) => bid.github_id === user.github_id && bid.status === "open") : undefined;

  const form = !user
    ? `<p><a href="${base}/login?next=${encodeURIComponent(`${base}/bid?${query}`)}">Sign in with GitHub</a> to bid on this issue.</p>`
    : ref.issue.state !== "open"
      ? `<p class="muted">This issue is closed, so it isn't taking new bids.</p>`
      : `<form method="post" action="${base}/bid" class="card">
  <input type="hidden" name="repo" value="${esc(ref.repo)}">
  <input type="hidden" name="issue" value="${ref.issueNumber}">
  <label for="amount">${mine ? "Update your bid" : "Your bid"} (${esc(currency(env).toUpperCase())})</label>
  <input id="amount" name="amount" inputmode="decimal" required placeholder="250.00" value="${mine ? (mine.amount_cents / 100).toFixed(2) : ""}">
  <label for="message">What you'll deliver and when</label>
  <textarea id="message" name="message" maxlength="2000">${esc(mine?.message ?? "")}</textarea>
  <button>${mine ? "Update bid" : "Place bid"}</button>
  ${user.transfers_active ? "" : `<p class="muted">To be paid, <a href="${base}/connect">set up payouts</a> with Stripe.</p>`}
</form>`;

  const body = `${issueHeader(ref)}
${notice ? `<div class="notice">${esc(notice)}</div>` : ""}
<p><a href="${base}/pay?${query}">Payments and tips for this issue</a></p>
<h2>Bids</h2>
${bids.length ? bidTable(env, bids, user) : `<p class="muted">No bids yet.</p>`}
${form}`;
  return page(env, `Bid: ${ref.issue.title}`, body, user);
}

export async function submitBid(request: Request, env: Env, user: CrewMember | null): Promise<Response> {
  const base = basePath(env);
  if (!user) return redirect(`${base}/login`);
  const form = await request.formData();
  const ref = await loadIssue(env, String(form.get("repo") ?? ""), String(form.get("issue") ?? ""));
  if (typeof ref === "string") return page(env, "Bid", `<h1>Bid</h1><div class="notice">${esc(ref)}</div>`, user, 400);
  const back = `${base}/bid?repo=${encodeURIComponent(ref.repo)}&issue=${ref.issueNumber}`;
  if (ref.issue.state !== "open") return redirect(back);

  const amount = parseAmountCents(form.get("amount"));
  if (!amount) {
    return bidPage(new Request(`${new URL(request.url).origin}${back}`, request), env, user,
      `Enter an amount from ${money(MIN_AMOUNT_CENTS, currency(env))} to ${money(MAX_AMOUNT_CENTS, currency(env))}.`);
  }
  const message = String(form.get("message") ?? "").trim().slice(0, 2000) || null;
  const existing = await findOpenBid(env, ref.repo, ref.issueNumber, user.github_id);
  if (existing) {
    await updateBidOffer(env, existing.id, amount, message);
  } else {
    await insertBid(env, {
      repo: ref.repo, issue_number: ref.issueNumber, issue_title: ref.issue.title, issue_url: ref.issue.html_url,
      github_id: user.github_id, amount_cents: amount, currency: currency(env), message,
    });
  }
  return redirect(back);
}

/** accept / reject (site admins), withdraw / deliver (the bidder). */
export async function changeBid(request: Request, env: Env, user: CrewMember | null, bidId: number, action: string): Promise<Response> {
  const base = basePath(env);
  if (!user) return redirect(`${base}/login`);
  const bid = await getBidWithMember(env, bidId);
  if (!bid) return page(env, "Bid", "<h1>Bid not found</h1>", user, 404);
  const back = `${base}/bid?repo=${encodeURIComponent(bid.repo)}&issue=${bid.issue_number}`;
  const admin = isAdmin(env, user.github_login);
  const owner = bid.github_id === user.github_id;

  const transitions: Record<string, { allowed: boolean; from: BidStatus[]; to: BidStatus }> = {
    accept: { allowed: admin, from: ["open"], to: "accepted" },
    reject: { allowed: admin, from: ["open", "accepted"], to: "rejected" },
    withdraw: { allowed: owner, from: ["open"], to: "withdrawn" },
    deliver: { allowed: owner, from: ["accepted", "delivered"], to: "delivered" },
  };
  const transition = transitions[action];
  if (!transition || !transition.allowed || !transition.from.includes(bid.status)) {
    return page(env, "Bid", `<h1>Can't ${esc(action)} this bid</h1><p><a href="${back}">Back to bids</a></p>`, user, 403);
  }

  if (action === "deliver") {
    const form = await request.formData();
    const deliveryUrl = String(form.get("delivery_url") ?? "").trim();
    if (!/^https:\/\/\S{3,500}$/.test(deliveryUrl)) {
      return page(env, "Bid", `<h1>Add a delivery link</h1><p>Use an https link to the pull request or delivered work. <a href="${back}">Back</a></p>`, user, 400);
    }
    await setBidStatus(env, bid.id, "delivered", deliveryUrl);
  } else {
    await setBidStatus(env, bid.id, transition.to);
  }
  return redirect(back);
}

function bidTable(env: Env, bids: BidWithMember[], user: CrewMember | null): string {
  const base = basePath(env);
  const admin = isAdmin(env, user?.github_login);
  const rows = bids.map((bid) => {
    const owner = user?.github_id === bid.github_id;
    const action = (name: string, label: string, secondary = true) =>
      `<form method="post" action="${base}/bid/${bid.id}/${name}" class="inline"><button class="small${secondary ? " secondary" : ""}">${label}</button></form>`;
    const actions: string[] = [];
    if (admin && bid.status === "open") actions.push(action("accept", "Accept", false), action("reject", "Reject"));
    if (admin && bid.status === "accepted") actions.push(action("reject", "Reject"));
    if (owner && bid.status === "open") actions.push(action("withdraw", "Withdraw"));
    if (owner && (bid.status === "accepted" || bid.status === "delivered")) {
      actions.push(`<form method="post" action="${base}/bid/${bid.id}/deliver">
        <input name="delivery_url" type="url" required placeholder="https://github.com/.../pull/1" value="${esc(bid.delivery_url ?? "")}">
        <button class="small">${bid.status === "delivered" ? "Update delivery" : "Mark delivered"}</button></form>`);
    }
    return `<tr>
  <td>@${esc(bid.github_login)}</td>
  <td>${money(bid.amount_cents, bid.currency)}</td>
  <td><span class="status ${esc(bid.status)}">${esc(bid.status)}</span></td>
  <td>${esc(bid.message ?? "")}${bid.delivery_url ? `<br><a href="${esc(bid.delivery_url)}" target="_blank" rel="noopener">Delivered work</a>` : ""}</td>
  <td>${actions.join(" ")}</td>
</tr>`;
  });
  return `<div class="table-wrap"><table><thead><tr><th>Crew member</th><th>Bid</th><th>Status</th><th>Details</th><th></th></tr></thead>
<tbody>${rows.join("")}</tbody></table></div>`;
}
