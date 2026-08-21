-- Allow 'delete' purpose for account-deletion re-auth links.
-- SQLite cannot alter a CHECK constraint, so rebuild the table.
CREATE TABLE magic_links_new (
  id TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login', 'delete')),
  pending_page_url TEXT,
  terms_version TEXT,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  email TEXT
);

INSERT INTO magic_links_new SELECT * FROM magic_links;
DROP TABLE magic_links;
ALTER TABLE magic_links_new RENAME TO magic_links;

CREATE INDEX magic_links_email_purpose
  ON magic_links(email_normalized, purpose, expires_at);
