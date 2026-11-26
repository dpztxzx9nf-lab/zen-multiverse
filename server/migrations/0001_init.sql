-- Zen Multiverse multiplayer: accounts, sessions, social, moderation, abuse counters.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,                -- random 16-byte hex, never shown as a secret
  email_hash TEXT NOT NULL UNIQUE,    -- SHA-256(pepper + lowercased email); the address itself is not stored
  name TEXT NOT NULL,                 -- display name (filtered), shown with tag
  tag TEXT NOT NULL,                  -- 4-digit discriminator
  created INTEGER NOT NULL,
  allow_join TEXT NOT NULL DEFAULT 'friends',  -- who may join my home: 'friends' | 'invite' | 'nobody'
  banned_until INTEGER NOT NULL DEFAULT 0,
  chat_muted_until INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX accounts_name_tag ON accounts(name, tag);

CREATE TABLE login_codes (
  email_hash TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,            -- SHA-256 of the 6-digit code + salt
  expires INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,        -- SHA-256 of the bearer token; the token itself is never stored
  account_id TEXT NOT NULL,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  ua TEXT
);
CREATE INDEX sessions_account ON sessions(account_id);

CREATE TABLE friends (                -- one row per direction once accepted; status 'pending' for requests
  a TEXT NOT NULL, b TEXT NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL,
  PRIMARY KEY (a, b)
);
CREATE TABLE blocks (a TEXT NOT NULL, b TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (a, b));

CREATE TABLE invites (
  code TEXT PRIMARY KEY,              -- 8 chars, Crockford base32
  owner TEXT NOT NULL, world TEXT NOT NULL,
  expires INTEGER NOT NULL, uses_left INTEGER NOT NULL
);
CREATE TABLE invite_grants (          -- redeemed invite = may join that owner's home until expiry
  account_id TEXT NOT NULL, owner TEXT NOT NULL, expires INTEGER NOT NULL,
  PRIMARY KEY (account_id, owner)
);

CREATE TABLE presence (account_id TEXT PRIMARY KEY, world TEXT, updated INTEGER NOT NULL);

CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter TEXT NOT NULL, target TEXT NOT NULL, reason TEXT NOT NULL,
  world TEXT, context TEXT, created INTEGER NOT NULL
);
CREATE TABLE cheat_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL, world TEXT, kind TEXT NOT NULL, detail TEXT, created INTEGER NOT NULL
);

CREATE TABLE rate (                   -- fixed-window counters for HTTP endpoints (per IP / per email / per account)
  k TEXT PRIMARY KEY, n INTEGER NOT NULL, reset INTEGER NOT NULL
);
