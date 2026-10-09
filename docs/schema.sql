-- Focus Cell application schema (Phase 2).
-- Idempotent. Does not drop tables or delete data.
-- Canonical identity is Google OIDC `sub` (google_sub). Email is display-only.

CREATE TABLE IF NOT EXISTS users (
  google_sub TEXT PRIMARY KEY,
  email TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS highlight_settings (
  google_sub TEXT PRIMARY KEY REFERENCES users(google_sub) ON DELETE CASCADE,
  color TEXT NOT NULL,
  opacity TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS highlight_settings_updated_at_idx
  ON highlight_settings (updated_at);

-- Short-lived PKCE state for the Google callback. Not a Google token store.
-- Needed because Chrome may drop the fc_oauth cookie on the bounce through accounts.google.com.
CREATE TABLE IF NOT EXISTS oauth_pending (
  state TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  next_path TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS oauth_pending_expires_at_idx
  ON oauth_pending (expires_at);

-- One-time highlighter sync handshake. issued_token is cleared after poll.
CREATE TABLE IF NOT EXISTS sync_requests (
  request_id TEXT PRIMARY KEY,
  poll_secret_hash TEXT NOT NULL,
  google_sub TEXT REFERENCES users(google_sub) ON DELETE CASCADE,
  email TEXT NOT NULL DEFAULT '',
  issued_token TEXT,
  token_hash TEXT,
  token_expires_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sync_requests_expires_at_idx
  ON sync_requests (expires_at);

-- Revocable highlighter sync tokens. Store only the SHA-256 hash.
CREATE TABLE IF NOT EXISTS sync_tokens (
  token_hash TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL REFERENCES users(google_sub) ON DELETE CASCADE,
  email TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sync_tokens_google_sub_idx
  ON sync_tokens (google_sub);
