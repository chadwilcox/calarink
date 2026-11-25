-- Vote totals kept on the clip, so showing the list doesn't recount every vote.
ALTER TABLE clips ADD COLUMN votes INTEGER NOT NULL DEFAULT 0;
