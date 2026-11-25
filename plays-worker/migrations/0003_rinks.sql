-- My Rink: staff post their rink's schedule.
CREATE TABLE rink_managers (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  rink_id TEXT NOT NULL,              -- '' while a rink Calarink doesn't list is being asked for
  new_rink TEXT NOT NULL DEFAULT '',  -- that rink's name, town and website, as typed
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | revoked
  name TEXT NOT NULL,                 -- the claim details are for the moderator only
  role TEXT NOT NULL,
  phone TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX rink_managers_user ON rink_managers(user_id);
CREATE INDEX rink_managers_rink ON rink_managers(rink_id, status);
CREATE UNIQUE INDEX rink_managers_one ON rink_managers(user_id, rink_id) WHERE rink_id != '';
CREATE TABLE rink_entries (
  id TEXT PRIMARY KEY,
  rink_id TEXT NOT NULL,
  data TEXT NOT NULL,                 -- JSON, see cleanEntry in src/rinks.js
  ends TEXT NOT NULL,                 -- its last date; past ones are cleared daily
  created_at INTEGER NOT NULL
);
CREATE INDEX rink_entries_rink ON rink_entries(rink_id);
CREATE TABLE rink_log (
  id INTEGER PRIMARY KEY,
  rink_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  change TEXT NOT NULL,               -- JSON { added: [], removed: [] }
  undone INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX rink_log_rink ON rink_log(rink_id, id);
CREATE TABLE rink_status (
  rink_id TEXT PRIMARY KEY,
  updated_at INTEGER NOT NULL,
  confirmed_at INTEGER NOT NULL,      -- a manager last said the schedule is right
  reminded_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE rink_reports (
  rink_id TEXT NOT NULL,
  ip TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (rink_id, ip)
);
