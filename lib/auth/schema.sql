-- Veyra authentication schema.
--
-- The four Auth.js tables plus two Veyra additions:
--   users.password_hash   scrypt output; NULL for OAuth-only accounts
--   users.session_version bumped to revoke every outstanding session at once
--
-- Every statement is IF NOT EXISTS so it is safe to re-run. Financial schemas
-- get migrated forward, never dropped and recreated.

CREATE TABLE IF NOT EXISTS users (
  id                SERIAL PRIMARY KEY,
  name              VARCHAR(255),
  email             VARCHAR(255) NOT NULL,
  "emailVerified"   TIMESTAMPTZ,
  image             TEXT,
  password_hash     TEXT,
  session_version   INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case cannot fork an account: emails are normalized before insert, and the
-- database enforces it independently of the application.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS accounts (
  id                  SERIAL PRIMARY KEY,
  "userId"            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                VARCHAR(255) NOT NULL,
  provider            VARCHAR(255) NOT NULL,
  "providerAccountId" VARCHAR(255) NOT NULL,
  refresh_token       TEXT,
  access_token        TEXT,
  expires_at          BIGINT,
  id_token            TEXT,
  scope               TEXT,
  session_state       TEXT,
  token_type          TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_provider_idx ON accounts (provider, "providerAccountId");

CREATE TABLE IF NOT EXISTS sessions (
  id             SERIAL PRIMARY KEY,
  "userId"       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires        TIMESTAMPTZ NOT NULL,
  "sessionToken" VARCHAR(255) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS verification_token (
  identifier TEXT NOT NULL,
  expires    TIMESTAMPTZ NOT NULL,
  token      TEXT NOT NULL,
  PRIMARY KEY (identifier, token)
);

-- Rate limiting must be shared state. Per-instance memory is not a rate limit
-- on serverless: each instance would get its own budget.
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key       TEXT PRIMARY KEY,
  count     INTEGER NOT NULL,
  reset_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_rate_limits_reset_idx ON auth_rate_limits (reset_at);

-- Security-relevant auth events. Separate from the financial audit chain in
-- lib/veyra/audit.mjs, which records money decisions.
CREATE TABLE IF NOT EXISTS auth_events (
  id         BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  event      TEXT NOT NULL,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  identifier TEXT,
  source     TEXT,
  detail     TEXT
);
CREATE INDEX IF NOT EXISTS auth_events_at_idx ON auth_events (at DESC);
