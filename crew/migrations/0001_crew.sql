-- Crew members are GitHub users. stripe_account_id is their Stripe Connect Express account
-- on the crew Stripe platform; transfers_active is 1 once Stripe can send them payments.
CREATE TABLE crew_members (
  github_id INTEGER PRIMARY KEY,
  github_login TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  stripe_account_id TEXT UNIQUE,
  transfers_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_crew_members_login ON crew_members (github_login);

CREATE TABLE crew_sessions (
  id TEXT PRIMARY KEY,
  github_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- status: open, accepted, rejected, withdrawn, delivered, paid
CREATE TABLE crew_bids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  issue_title TEXT,
  issue_url TEXT,
  github_id INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  message TEXT,
  delivery_url TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_crew_bids_issue ON crew_bids (repo, issue_number);
CREATE INDEX idx_crew_bids_member ON crew_bids (github_id);

-- kind: work (an accepted bid) or tip (fees and tips from viewers)
-- status: pending, paid, failed, expired, refunded
CREATE TABLE crew_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('work', 'tip')),
  bid_id INTEGER,
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

CREATE INDEX idx_crew_payments_issue ON crew_payments (repo, issue_number);
CREATE INDEX idx_crew_payments_payee ON crew_payments (payee_github_id);
CREATE INDEX idx_crew_payments_intent ON crew_payments (stripe_payment_intent_id);

-- Stripe webhook events already processed, so retries are skipped.
CREATE TABLE crew_stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
