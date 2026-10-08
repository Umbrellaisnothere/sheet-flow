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
