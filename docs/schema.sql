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
