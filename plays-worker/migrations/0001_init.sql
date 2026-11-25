-- Times are unix seconds. Weeks are the Monday's date in Eastern time, "2026-11-23".
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,        -- lower case; never shown publicly
  blocked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE codes (                 -- emailed sign-in codes, hashed
  email TEXT NOT NULL,
  hash TEXT NOT NULL,
  ip TEXT NOT NULL,                  -- salted hash
  tries INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX codes_email ON codes(email);
CREATE TABLE sessions (
  hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE clips (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  credit TEXT NOT NULL DEFAULT '',   -- public "who" line, optional
  state TEXT NOT NULL,               -- ME, ON, ...
  rink_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'uploading', -- uploading | pending | approved | deleting
  week TEXT,                         -- set on approval
  has_video INTEGER NOT NULL DEFAULT 0,
  has_poster INTEGER NOT NULL DEFAULT 0,
  consent_at INTEGER NOT NULL,       -- when the uploader accepted the rules
  created_at INTEGER NOT NULL,
  approved_at INTEGER
);
CREATE INDEX clips_week ON clips(status, week);
CREATE INDEX clips_user ON clips(user_id, created_at);
CREATE TABLE votes (
  clip_id TEXT NOT NULL,
  device TEXT NOT NULL,              -- hash of the device cookie
  ip TEXT NOT NULL,                  -- salted hash
  created_at INTEGER NOT NULL,
  PRIMARY KEY (clip_id, device)
);
CREATE INDEX votes_ip ON votes(clip_id, ip);
CREATE TABLE reports (
  clip_id TEXT NOT NULL,
  ip TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (clip_id, ip)
);
