-- Bounties: the amount a sponsor offers for a satisfactory production of an issue.
-- Each sponsor has at most one open bounty per issue, which they can update or withdraw,
-- and pay to a crew member whose work satisfies them.
-- status: open, withdrawn, paid
CREATE TABLE crew_bounties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  issue_title TEXT,
  issue_url TEXT,
  github_id INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_crew_bounties_issue ON crew_bounties (repo, issue_number);
CREATE INDEX idx_crew_bounties_sponsor ON crew_bounties (github_id);

-- Payments can pay a bounty: crew_payments is rebuilt to allow kind 'bounty', with bounty_id.
-- kind: work (an accepted bid), tip (fees and tips from viewers) or bounty (a sponsor's bounty)
-- status: pending, paid, failed, expired, refunded
CREATE TABLE crew_payments_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('work', 'tip', 'bounty')),
  bid_id INTEGER,
  bounty_id INTEGER,
  repo TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  payer_github_id INTEGER,
  payee_github_id INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  platform_fee_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  note TEXT,
  stripe_checkout_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO crew_payments_new (id, kind, bid_id, repo, issue_number, payer_github_id, payee_github_id, amount_cents,
  platform_fee_cents, currency, note, stripe_checkout_session_id, stripe_payment_intent_id, status, created_at, updated_at)
SELECT id, kind, bid_id, repo, issue_number, payer_github_id, payee_github_id, amount_cents,
  platform_fee_cents, currency, note, stripe_checkout_session_id, stripe_payment_intent_id, status, created_at, updated_at
FROM crew_payments;

DROP TABLE crew_payments;
ALTER TABLE crew_payments_new RENAME TO crew_payments;

CREATE INDEX idx_crew_payments_issue ON crew_payments (repo, issue_number);
CREATE INDEX idx_crew_payments_payee ON crew_payments (payee_github_id);
CREATE INDEX idx_crew_payments_intent ON crew_payments (stripe_payment_intent_id);
CREATE INDEX idx_crew_payments_bounty ON crew_payments (bounty_id);
