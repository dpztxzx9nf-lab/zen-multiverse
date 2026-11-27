-- The bag lives on the server (js/game/bag-rules.js, server/src/bag.js): every count a signed-in player has.
-- CHECK (n >= 0) is the guard against spending what you don't have: a spend is UPDATE n = n - k inside one batch
-- (a transaction), and if any stack would go below zero the whole batch fails and nothing moves. Two worlds (two
-- Durable Objects) spending from one bag at once cannot both win.
CREATE TABLE bag (
  aid TEXT NOT NULL,
  item TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0 CHECK (n >= 0),        -- how many you have
  esc INTEGER NOT NULL DEFAULT 0 CHECK (esc >= 0),    -- spent in your own world and allowed to come back (a refund)
  tok REAL NOT NULL DEFAULT 0,                        -- what the world may still hand you (js/game/bag-rules.js BUDGET)
  tt INTEGER NOT NULL DEFAULT 0,                      -- when tok was last worked out
  PRIMARY KEY (aid, item)
) WITHOUT ROWID;
-- one row per account once its old save has moved onto the server (only ever once; the device keeps its copy)
CREATE TABLE bag_meta (
  aid TEXT PRIMARY KEY,
  imported INTEGER NOT NULL,                          -- when
  src TEXT,                                           -- what was cut on the way in (unknown items, over the caps)
  dev TEXT                                            -- the device whose save it was (a save moves into one account)
);
CREATE INDEX bag_meta_dev ON bag_meta(dev);
-- each device numbers what it asks for; an op is done once even if it is sent again after a dropped connection
CREATE TABLE bag_dev (
  aid TEXT NOT NULL,
  dev TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (aid, dev)
) WITHOUT ROWID;
-- an op number that was already used fails its whole batch (so a resent op never counts twice)
CREATE TRIGGER bag_dev_once BEFORE UPDATE OF seq ON bag_dev WHEN NEW.seq <= OLD.seq
BEGIN SELECT RAISE(ABORT, 'bag-op-again'); END;
