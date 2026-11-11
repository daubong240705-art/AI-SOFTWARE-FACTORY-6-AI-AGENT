-- E2 fixes. Both columns are additive with safe defaults; no table is rebuilt.
-- extra_loops: reworks an Operator explicitly granted on resume after the definition's maxLoops was exhausted.
ALTER TABLE workflow_stages ADD COLUMN extra_loops INTEGER NOT NULL DEFAULT 0 CHECK (extra_loops BETWEEN 0 AND 10);
-- run_failures: consecutive FAILED workflow runs started by the schedule (a completed run resets it).
ALTER TABLE schedules ADD COLUMN run_failures INTEGER NOT NULL DEFAULT 0 CHECK (run_failures BETWEEN 0 AND 10);
-- reconciled_at: when the outcome of the occurrence's workflow run was counted (each run counts once).
ALTER TABLE schedule_occurrences ADD COLUMN reconciled_at TEXT;
