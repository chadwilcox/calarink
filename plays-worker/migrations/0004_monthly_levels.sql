-- Top Plays runs monthly ("2026-11"), and each clip says its level of play.
ALTER TABLE clips RENAME COLUMN week TO month;
UPDATE clips SET month = substr(month, 1, 7) WHERE month IS NOT NULL;
ALTER TABLE clips ADD COLUMN level TEXT NOT NULL DEFAULT '';
