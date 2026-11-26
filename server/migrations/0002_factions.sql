-- Factions: what travels between worlds and what a player keeps for good. There is no reputation column:
-- fa_news is news a courier carried off a world (who did what to whom, how the teller knew, when it left),
-- and each world decides when it arrives (ship speed or a void jump) and who there hears it first.
CREATE TABLE fa_news (
  id TEXT PRIMARY KEY,          -- act id | faction  (one story per side)
  faction TEXT NOT NULL,
  subject TEXT NOT NULL,        -- account id of the player the story is about
  act TEXT NOT NULL,
  data TEXT NOT NULL,           -- the memory as carried (victim, how it was known, where)
  origin TEXT NOT NULL,         -- world key it left from
  at INTEGER NOT NULL,          -- when it happened
  dep INTEGER NOT NULL          -- when the courier left the world with it
);
CREATE INDEX fa_news_subject ON fa_news(subject, dep);
-- what someone taught you stays taught (keyed per player, any world)
CREATE TABLE fa_bonds (
  aid TEXT NOT NULL, kind TEXT NOT NULL, faction TEXT NOT NULL, npc TEXT NOT NULL, world TEXT NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY (aid, kind)
);
