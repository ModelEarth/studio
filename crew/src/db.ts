import type { Env } from "./env";

export interface CrewMember {
  github_id: number;
  github_login: string;
  name: string | null;
  avatar_url: string | null;
  stripe_account_id: string | null;
  transfers_active: number;
}

export type BidStatus = "open" | "accepted" | "rejected" | "withdrawn" | "delivered" | "paid";

export interface Bid {
  id: number;
  repo: string;
  issue_number: number;
  issue_title: string | null;
  issue_url: string | null;
  github_id: number;
  amount_cents: number;
  currency: string;
  message: string | null;
  delivery_url: string | null;
  status: BidStatus;
  created_at: string;
}

export interface BidWithMember extends Bid {
  github_login: string;
  avatar_url: string | null;
  transfers_active: number;
}

export interface Payment {
  id: number;
  kind: "work" | "tip";
  bid_id: number | null;
  repo: string;
  issue_number: number;
  payer_github_id: number | null;
  payee_github_id: number;
  amount_cents: number;
  platform_fee_cents: number;
  currency: string;
  note: string | null;
  stripe_checkout_session_id: string | null;
  status: string;
  created_at: string;
}

export interface PaymentWithPayee extends Payment {
  payee_login: string;
}

export interface NewPayment {
  kind: "work" | "tip";
  bid_id: number | null;
  repo: string;
  issue_number: number;
  payer_github_id: number;
  payee_github_id: number;
  amount_cents: number;
  platform_fee_cents: number;
  currency: string;
  note: string | null;
}

export async function upsertMember(env: Env, member: Pick<CrewMember, "github_id" | "github_login" | "name" | "avatar_url">): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO crew_members (github_id, github_login, name, avatar_url) VALUES (?, ?, ?, ?)
     ON CONFLICT (github_id) DO UPDATE SET github_login = excluded.github_login, name = excluded.name,
       avatar_url = excluded.avatar_url, updated_at = datetime('now')`,
  ).bind(member.github_id, member.github_login, member.name, member.avatar_url).run();
}

export async function getMember(env: Env, githubId: number): Promise<CrewMember | null> {
  return env.DB.prepare("SELECT * FROM crew_members WHERE github_id = ?").bind(githubId).first<CrewMember>();
}

export async function setMemberStripeAccount(env: Env, githubId: number, accountId: string): Promise<void> {
  await env.DB.prepare("UPDATE crew_members SET stripe_account_id = ?, updated_at = datetime('now') WHERE github_id = ?")
    .bind(accountId, githubId).run();
}

export async function setTransfersActive(env: Env, accountId: string, active: boolean): Promise<void> {
  await env.DB.prepare("UPDATE crew_members SET transfers_active = ?, updated_at = datetime('now') WHERE stripe_account_id = ?")
    .bind(active ? 1 : 0, accountId).run();
}

export async function listBidsForIssue(env: Env, repo: string, issueNumber: number): Promise<BidWithMember[]> {
  const { results } = await env.DB.prepare(
    `SELECT b.*, m.github_login, m.avatar_url, m.transfers_active FROM crew_bids b
     JOIN crew_members m ON m.github_id = b.github_id
     WHERE b.repo = ? AND b.issue_number = ? ORDER BY b.created_at`,
  ).bind(repo, issueNumber).all<BidWithMember>();
  return results;
}

export async function listBidsForMember(env: Env, githubId: number): Promise<Bid[]> {
  const { results } = await env.DB.prepare("SELECT * FROM crew_bids WHERE github_id = ? ORDER BY updated_at DESC LIMIT 100")
    .bind(githubId).all<Bid>();
  return results;
}

export async function listOpenBids(env: Env): Promise<BidWithMember[]> {
  const { results } = await env.DB.prepare(
    `SELECT b.*, m.github_login, m.avatar_url, m.transfers_active FROM crew_bids b
     JOIN crew_members m ON m.github_id = b.github_id
     WHERE b.status IN ('open', 'delivered') ORDER BY b.created_at LIMIT 100`,
  ).all<BidWithMember>();
  return results;
}

export async function getBidWithMember(env: Env, bidId: number): Promise<BidWithMember | null> {
  return env.DB.prepare(
    `SELECT b.*, m.github_login, m.avatar_url, m.transfers_active FROM crew_bids b
     JOIN crew_members m ON m.github_id = b.github_id WHERE b.id = ?`,
  ).bind(bidId).first<BidWithMember>();
}

export async function findOpenBid(env: Env, repo: string, issueNumber: number, githubId: number): Promise<Bid | null> {
  return env.DB.prepare("SELECT * FROM crew_bids WHERE repo = ? AND issue_number = ? AND github_id = ? AND status = 'open'")
    .bind(repo, issueNumber, githubId).first<Bid>();
}

export async function insertBid(env: Env, bid: Omit<Bid, "id" | "status" | "delivery_url" | "created_at">): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO crew_bids (repo, issue_number, issue_title, issue_url, github_id, amount_cents, currency, message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(bid.repo, bid.issue_number, bid.issue_title, bid.issue_url, bid.github_id, bid.amount_cents, bid.currency, bid.message).run();
}

export async function updateBidOffer(env: Env, bidId: number, amountCents: number, message: string | null): Promise<void> {
  await env.DB.prepare("UPDATE crew_bids SET amount_cents = ?, message = ?, updated_at = datetime('now') WHERE id = ? AND status = 'open'")
    .bind(amountCents, message, bidId).run();
}

export async function setBidStatus(env: Env, bidId: number, status: BidStatus, deliveryUrl?: string | null): Promise<void> {
  if (deliveryUrl !== undefined) {
    await env.DB.prepare("UPDATE crew_bids SET status = ?, delivery_url = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(status, deliveryUrl, bidId).run();
    return;
  }
  await env.DB.prepare("UPDATE crew_bids SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(status, bidId).run();
}

export async function insertPayment(env: Env, payment: NewPayment): Promise<number> {
  const row = await env.DB.prepare(
    `INSERT INTO crew_payments (kind, bid_id, repo, issue_number, payer_github_id, payee_github_id, amount_cents,
       platform_fee_cents, currency, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(
    payment.kind, payment.bid_id, payment.repo, payment.issue_number, payment.payer_github_id, payment.payee_github_id,
    payment.amount_cents, payment.platform_fee_cents, payment.currency, payment.note,
  ).first<{ id: number }>();
  if (!row) throw new Error("Payment insert returned no id");
  return row.id;
}

export async function setPaymentCheckoutSession(env: Env, paymentId: number, sessionId: string): Promise<void> {
  await env.DB.prepare("UPDATE crew_payments SET stripe_checkout_session_id = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(sessionId, paymentId).run();
}

export async function setPaymentStatus(env: Env, paymentId: number, status: string): Promise<void> {
  await env.DB.prepare("UPDATE crew_payments SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(status, paymentId).run();
}

export async function getPaymentBySession(env: Env, sessionId: string): Promise<Payment | null> {
  return env.DB.prepare("SELECT * FROM crew_payments WHERE stripe_checkout_session_id = ?").bind(sessionId).first<Payment>();
}

/** Marks a checkout paid once; a paid work payment also marks its bid paid. */
export async function markPaymentPaid(env: Env, sessionId: string, paymentIntentId: string | null): Promise<void> {
  const payment = await getPaymentBySession(env, sessionId);
  if (!payment || payment.status === "paid") return;
  await env.DB.prepare(
    "UPDATE crew_payments SET status = 'paid', stripe_payment_intent_id = ?, updated_at = datetime('now') WHERE id = ?",
  ).bind(paymentIntentId, payment.id).run();
  if (payment.kind === "work" && payment.bid_id) {
    await setBidStatus(env, payment.bid_id, "paid");
  }
}

export async function markPaymentEnded(env: Env, sessionId: string, status: "failed" | "expired"): Promise<void> {
  await env.DB.prepare("UPDATE crew_payments SET status = ?, updated_at = datetime('now') WHERE stripe_checkout_session_id = ? AND status = 'pending'")
    .bind(status, sessionId).run();
}

export async function markPaymentRefunded(env: Env, paymentIntentId: string): Promise<void> {
  await env.DB.prepare("UPDATE crew_payments SET status = 'refunded', updated_at = datetime('now') WHERE stripe_payment_intent_id = ?")
    .bind(paymentIntentId).run();
}

export async function hasPendingOrPaidWorkPayment(env: Env, bidId: number): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS found FROM crew_payments WHERE bid_id = ? AND kind = 'work'
     AND (status = 'paid' OR (status = 'pending' AND created_at > datetime('now', '-30 minutes')))`,
  ).bind(bidId).first();
  return !!row;
}

export async function listPaidPaymentsForIssue(env: Env, repo: string, issueNumber: number): Promise<PaymentWithPayee[]> {
  const { results } = await env.DB.prepare(
    `SELECT p.*, m.github_login AS payee_login FROM crew_payments p
     JOIN crew_members m ON m.github_id = p.payee_github_id
     WHERE p.repo = ? AND p.issue_number = ? AND p.status = 'paid' ORDER BY p.updated_at DESC`,
  ).bind(repo, issueNumber).all<PaymentWithPayee>();
  return results;
}

export async function listPaymentsReceived(env: Env, githubId: number): Promise<Payment[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM crew_payments WHERE payee_github_id = ? AND status IN ('paid', 'refunded') ORDER BY updated_at DESC LIMIT 100",
  ).bind(githubId).all<Payment>();
  return results;
}

export async function stripeEventSeen(env: Env, eventId: string): Promise<boolean> {
  return !!(await env.DB.prepare("SELECT 1 AS found FROM crew_stripe_events WHERE id = ?").bind(eventId).first());
}

export async function recordStripeEvent(env: Env, eventId: string, type: string): Promise<void> {
  await env.DB.prepare("INSERT OR IGNORE INTO crew_stripe_events (id, type) VALUES (?, ?)").bind(eventId, type).run();
}
