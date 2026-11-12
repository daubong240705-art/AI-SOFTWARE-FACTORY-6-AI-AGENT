CREATE TABLE seat_runtime_config (
  seat_id TEXT PRIMARY KEY REFERENCES seats(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  runtime TEXT NOT NULL CHECK (runtime IN ('native-opencode','acp')),
  cli TEXT NULL CHECK (cli IN ('codex','claude')),
  model TEXT NULL CHECK (model IS NULL OR (
    length(model) BETWEEN 1 AND 256 AND instr(model, char(0)) = 0 AND
    model NOT GLOB ('*[' || char(1) || '-' || char(32) || char(127) || '-' || char(160) ||
      char(5760) || char(8192) || '-' || char(8202) || char(8232) || char(8233) ||
      char(8239) || char(8287) || char(12288) || char(65279) || ']*')
  )),
  effort TEXT NULL CHECK (effort IN ('low','medium','high','xhigh')),
  permission TEXT NOT NULL DEFAULT 'autonomous' CHECK (permission IN ('autonomous','workspace-write')),
  updated_at TEXT NOT NULL,
  CHECK ((runtime = 'acp') = (cli IS NOT NULL))
) STRICT;
