-- Advice for the moderator from an AI look at each clip; hiding reported clips; daily caps.
ALTER TABLE clips ADD COLUMN seconds REAL NOT NULL DEFAULT 0;
ALTER TABLE clips ADD COLUMN screen TEXT;                          -- JSON, see src/screen.js
ALTER TABLE clips ADD COLUMN screen_tries INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clips ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;    -- reported twice, waiting for the moderator
ALTER TABLE clips ADD COLUMN kept INTEGER NOT NULL DEFAULT 0;      -- the moderator kept it: reports no longer hide it
CREATE TABLE usage (day TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, kind));
