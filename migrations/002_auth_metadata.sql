ALTER TABLE magic_links ADD COLUMN email TEXT;
ALTER TABLE sessions ADD COLUMN device_label TEXT NOT NULL DEFAULT 'Unknown device';
