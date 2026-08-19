CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  accepted_terms_at TEXT NOT NULL,
  terms_version TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE magic_links (
  id TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
  pending_page_url TEXT,
  terms_version TEXT,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX magic_links_email_purpose
  ON magic_links(email_normalized, purpose, expires_at);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX sessions_user_expires
  ON sessions(user_id, expires_at);

CREATE TABLE forms (
  id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  page_url TEXT NOT NULL,
  allowed_origin TEXT NOT NULL,
  success_url TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX forms_user_created
  ON forms(user_id, created_at DESC);

CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX submissions_form_created
  ON submissions(form_id, created_at DESC, id DESC);
