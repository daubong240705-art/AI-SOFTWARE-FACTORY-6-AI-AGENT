"""Reference SQL 002 invariants in memory only. Not tests of an implemented Host."""

import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
H = "a" * 64
T = "2026-11-07T00:00:00.000Z"
LATER = "2026-11-08T00:00:00.000Z"


class Schema002Tests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        for name in ("001-core", "002-multiteam"):
            self.db.executescript(
                (ROOT / f"schema/factory-v2/{name}.reference.sql").read_text(encoding="utf-8")
            )
        for p in ("p1", "p2"):
            self.db.execute("INSERT INTO projects VALUES (?,1,'Demo','git',?,'active')", (p, "/tmp/" + p))
        self.db.execute("INSERT INTO teams VALUES ('team1',1,'Software','c',NULL,NULL,'active')")
        self.db.execute("INSERT INTO nodes VALUES ('n1',1,'wsl','linux','server-sandboxed','online',2,0,NULL)")
        self.db.commit()

    def tearDown(self):
        self.db.close()

    # helpers -----------------------------------------------------------------------------------
    def task(self, id="t1", project="p1", code=None, state="ready", **over):
        row = dict(
            project_id=project, id=id, revision=1, code=code or f"DEV-{abs(hash(id)) % 900 + 100}",
            title="T", goal="G", brief="B", parent_task_id=None, engagement_id=None, owner_seat_id=None,
            origin_kind="operator", requester_task_id=None, request_kind=None, hop=None, state=state,
            required_capabilities_json="[]", acceptance_json="[]", inputs_json="[]",
        )
        row.update(over)
        cols = ",".join(row)
        self.db.execute(f"INSERT INTO tasks ({cols}) VALUES ({','.join('?' * len(row))})", tuple(row.values()))

    def attempt(self, id="a1", task="t1", state="queued", epoch=1, **over):
        placed = state in ("leased", "preparing", "running", "waiting-input", "stopping", "submitting")
        row = dict(
            project_id="p1", id=id, task_id=task, revision=1, epoch=epoch, state=state,
            outcome="unknown" if state == "unknown" else "known",
            node_id="n1" if placed else None, runtime="fake", provider="9router", model="m", effort="medium",
            lease_id=f"lease-{id}" if placed else None, lease_expires_at=LATER if placed else None,
            started_at=None, ended_at=T if state in ("succeeded", "failed", "stopped", "requeued") else None,
        )
        row.update(over)
        cols = ",".join(row)
        self.db.execute(f"INSERT INTO attempts ({cols}) VALUES ({','.join('?' * len(row))})", tuple(row.values()))

    def artifact(self, version=1, artifact="art1", project="p1", **over):
        row = dict(
            project_id=project, artifact_id=artifact, version=version, kind="data-model", title="ERD",
            media_type="text/markdown", content_hash=H, size_bytes=10, status="draft", abstract_l0="short",
            abstract_l1=None, produced_by_attempt_id=None, supersedes_version=None, visibility="team-draft", created_at=T,
        )
        row.update(over)
        cols = ",".join(row)
        self.db.execute(f"INSERT INTO artifact_versions ({cols}) VALUES ({','.join('?' * len(row))})", tuple(row.values()))

    def approval(self, id="ap1", **over):
        row = dict(
            project_id="p1", id=id, revision=1, kind="question", task_id=None, subject="S", summary="Q",
            options_json='[{"id":"a"},{"id":"b"}]', recommendation=None, impact_if_waiting="w", context_digest=H,
            approver="operator", requested_at=T, expires_at=LATER, state="pending", outcome_option_id=None,
            outcome_actor_id=None, decided_at=None, applied_by_command_id=None,
        )
        row.update(over)
        cols = ",".join(row)
        self.db.execute(f"INSERT INTO approvals ({cols}) VALUES ({','.join('?' * len(row))})", tuple(row.values()))

    def effect(self, id="e1", branch="factory/dev-1", **over):
        row = dict(
            project_id="p1", id=id, attempt_id="a1", kind="git.push-branch", idempotency_key=f"k-{id}",
            target_json=f'{{"remote":"origin","branch":"{branch}"}}', state="pending", error=None,
            created_at=T, completed_at=None,
        )
        row.update(over)
        cols = ",".join(row)
        self.db.execute(f"INSERT INTO effects ({cols}) VALUES ({','.join('?' * len(row))})", tuple(row.values()))

    def rejects(self, fn, *args, **kw):
        with self.assertRaises(sqlite3.IntegrityError):
            fn(*args, **kw)

    def raises_abort(self, sql, params=()):
        with self.assertRaises(sqlite3.DatabaseError):
            self.db.execute(sql, params)

    # tests ------------------------------------------------------------------------------------
    def test_all_tables_are_strict_and_001_is_untouched(self):
        rows = self.db.execute("SELECT name, strict FROM pragma_table_list WHERE schema='main' AND name NOT LIKE 'sqlite_%'").fetchall()
        self.assertGreaterEqual(len(rows), 32)
        for name, strict in rows:
            self.assertEqual(strict, 1, name)
        for table in ("work_items", "assignments", "run_attempts", "leases"):
            self.assertIn(table, [r[0] for r in rows])  # superseded only at M1

    def test_task_defaults_are_the_most_restrictive(self):
        self.task()
        placement, side, review, gate = self.db.execute(
            "SELECT placement, side_effect, review_policy, requires_go FROM tasks"
        ).fetchone()
        self.assertEqual((placement, side, review, gate), ("node-bound", "external-irreversible", "human-final", 1))

    def test_task_rules(self):
        self.task("t1", code="DEV-001")
        self.rejects(self.task, "t2", code="DEV-001")  # duplicate code in project
        self.task("t3", project="p2", code="DEV-001")  # but fine in another project
        self.rejects(self.task, "t4", code="bad code")
        self.rejects(self.task, "t5", code="DEV-005", parent_task_id="t5")
        self.rejects(self.task, "t6", code="DEV-006", state="awaiting-go", requires_go=0)
        self.rejects(self.task, "t7", code="DEV-007", parent_task_id="t3")  # parent in another project
        self.rejects(self.task, "t8", code="DEV-008", state="paused")  # not a task state
        self.rejects(self.task, "t9", code="DEV-009", origin_kind="cross-team")  # needs requester/kind/hop
        self.task("t10", code="DEV-010", origin_kind="cross-team", requester_task_id="t1", request_kind="consult", hop=1, state="proposed")
        self.rejects(self.task, "t11", code="DEV-011", origin_kind="cross-team", requester_task_id="t1", request_kind="consult", hop=1, state="accepted")  # accepted needs owner
        self.rejects(self.task, "t12", code="DEV-012", origin_kind="cross-team", requester_task_id="t1", request_kind="consult", hop=4, state="proposed")

    def test_terminal_task_states_have_no_exit(self):
        for i, state in enumerate(("cancelled", "declined", "superseded")):
            self.task(f"x{i}", code=f"DEV-10{i}", state=state)
            self.raises_abort("UPDATE tasks SET state='active' WHERE id=?", (f"x{i}",))
        self.task("d", code="DEV-200", state="done")
        self.raises_abort("UPDATE tasks SET state='active' WHERE id='d'")
        self.db.execute("UPDATE tasks SET state='superseded' WHERE id='d'")

    def test_dependencies_are_project_scoped_and_not_self(self):
        self.task("a", code="DEV-301")
        self.task("b", code="DEV-302")
        self.task("c", project="p2", code="DEV-303")
        self.rejects(self.db.execute, "INSERT INTO task_dependencies VALUES ('p1','a','a')")
        self.rejects(self.db.execute, "INSERT INTO task_dependencies VALUES ('p1','a','c')")
        self.db.execute("INSERT INTO task_dependencies VALUES ('p1','b','a')")
        self.rejects(self.db.execute, "INSERT INTO task_dependencies VALUES ('p1','b','a')")

    def test_holds_are_unique_per_kind(self):
        self.task()
        self.db.execute("INSERT INTO task_holds VALUES ('p1','t1','input','why',NULL,NULL,?,0)", (T,))
        self.rejects(self.db.execute, "INSERT INTO task_holds VALUES ('p1','t1','input','again',NULL,NULL,?,0)", (T,))
        self.rejects(self.db.execute, "INSERT INTO task_holds VALUES ('p1','t1','weather','x',NULL,NULL,?,0)", (T,))
        self.rejects(self.db.execute, "INSERT INTO task_holds VALUES ('p1','t1','budget','x','task',NULL,?,0)", (T,))

    def test_seats_nodes_and_capabilities(self):
        ins = "INSERT INTO seats VALUES (?,'team1',1,?,'Dev','prof',1,'native-opencode',?,?,?,?)"
        self.db.execute(ins, ("s1", "Lead", 1, "elastic", None, 1))
        self.rejects(self.db.execute, ins, ("s2", "Lead2", 1, "elastic", None, 1))  # second lead
        self.rejects(self.db.execute, ins, ("s3", "Dedicated", 1, "dedicated", None, 0))  # dedicated needs a node
        self.rejects(self.db.execute, ins, ("s4", "Elastic", 1, "elastic", "n1", 0))  # elastic cannot pin a node
        self.rejects(self.db.execute, ins, ("s5", "Big", 9, "elastic", None, 0))
        self.db.execute(ins, ("s6", "Pinned", 2, "dedicated", "n1", 0))
        self.rejects(self.db.execute, "INSERT INTO nodes VALUES ('n2',1,'x','linux','server-sandboxed','online',1,2,NULL)")
        self.rejects(self.db.execute, "INSERT INTO nodes VALUES ('n3',1,'y','linux','quarantined','online',1,0,NULL)")
        cap = "INSERT INTO node_capabilities VALUES ('n1',?,?,?,?)"
        self.db.execute(cap, ("media.ffmpeg", "declared", None, None))
        self.rejects(self.db.execute, cap, ("code.typescript", "verified", None, None))  # verified needs freshness
        self.db.execute(cap, ("code.typescript", "verified", T, LATER))
        self.rejects(self.db.execute, cap, ("code.typescript", "observed", T, LATER))  # one row per capability
        for bad in ("Code.TS", "code", "code..x", "code.", "9code.x"):
            self.rejects(self.db.execute, cap, (bad, "declared", None, None))

    def test_one_active_engagement_per_team_and_project(self):
        ins = "INSERT INTO engagements VALUES ('p1',?,'team1',1,50,2,?,?)"
        self.db.execute(ins, ("e1", "active", T))
        self.rejects(self.db.execute, ins, ("e2", "active", T))
        self.db.execute(ins, ("e3", "ended", T))
        self.rejects(self.db.execute, "INSERT INTO engagements VALUES ('p1','e4','team1',1,101,2,'paused',?)", (T,))

    def test_at_most_one_live_attempt_and_unknown_still_blocks(self):
        self.task()
        self.attempt("a1", state="running")
        self.rejects(self.attempt, "a2", state="queued", epoch=2)
        self.db.execute("UPDATE attempts SET state='unknown', outcome='unknown', lease_id=NULL, lease_expires_at=NULL WHERE id='a1'")
        self.rejects(self.attempt, "a3", state="queued", epoch=3)  # an unknown outcome blocks a second attempt
        self.db.execute("UPDATE attempts SET state='reconciling' WHERE id='a1'")
        self.rejects(self.attempt, "a4", state="queued", epoch=4)
        self.db.execute("UPDATE attempts SET state='failed', outcome='known', ended_at=? WHERE id='a1'", (T,))
        self.attempt("a5", state="queued", epoch=2)  # released only after the outcome is known

    def test_attempt_lease_and_epoch_rules(self):
        self.task()
        self.rejects(self.attempt, "a1", state="running", lease_id=None)
        self.rejects(self.attempt, "a1", state="running", node_id=None)
        self.rejects(self.attempt, "a1", state="queued", node_id="n1")
        self.rejects(self.attempt, "a1", state="succeeded", ended_at=None)
        self.rejects(self.attempt, "a1", state="running", effort="max")
        self.rejects(self.attempt, "a1", state="running", effort="ultra")
        self.attempt("a1", state="failed", epoch=1)
        self.rejects(self.attempt, "a2", state="failed", epoch=1)  # (task, epoch) is unique
        self.raises_abort("UPDATE attempts SET epoch=2 WHERE id='a1'")
        self.raises_abort("UPDATE attempts SET state='running' WHERE id='a1'")  # terminal

    def test_lease_ids_are_globally_unique(self):
        self.task()
        self.task("t2", code="DEV-402")
        self.attempt("a1", state="running", lease_id="same")
        self.rejects(self.attempt, "a2", task="t2", state="running", lease_id="same")

    def test_artifact_versions_are_immutable_and_chain_backwards(self):
        self.artifact(1)
        self.artifact(2, supersedes_version=1)
        self.rejects(self.artifact, 3, supersedes_version=3)
        self.rejects(self.artifact, 4, supersedes_version=9)
        self.rejects(self.artifact, 5, content_hash="abc")
        self.rejects(self.artifact, 5, content_hash="G" * 64)
        self.rejects(self.artifact, 5, status="approved", visibility="team-draft")
        self.rejects(self.artifact, 1)  # same version twice
        self.artifact(1, project="p2")  # versions are project scoped
        self.raises_abort("UPDATE artifact_versions SET content_hash=? WHERE version=1 AND project_id='p1'", ("b" * 64,))
        self.raises_abort("UPDATE artifact_versions SET abstract_l0='changed' WHERE version=1 AND project_id='p1'")
        self.db.execute("UPDATE artifact_versions SET status='in-review' WHERE version=1 AND project_id='p1'")

    def test_approved_version_can_only_be_superseded_and_rejected_is_final(self):
        self.artifact(1, status="approved", visibility="project")
        self.raises_abort("UPDATE artifact_versions SET status='draft' WHERE version=1")
        self.raises_abort("UPDATE artifact_versions SET status='rejected' WHERE version=1")
        self.db.execute("UPDATE artifact_versions SET status='superseded' WHERE version=1")
        self.raises_abort("UPDATE artifact_versions SET status='approved' WHERE version=1")

    def test_artifact_inputs_reference_real_versions(self):
        self.artifact(1)
        self.artifact(1, artifact="art2")
        self.db.execute("INSERT INTO artifact_inputs VALUES ('p1','art2',1,'art1',1)")
        self.rejects(self.db.execute, "INSERT INTO artifact_inputs VALUES ('p1','art2',1,'art1',7)")

    def test_approval_outcome_exists_exactly_when_decided(self):
        self.approval()
        self.rejects(self.approval, "ap2", state="approved")  # decided without an outcome
        self.rejects(self.approval, "ap3", outcome_option_id="a", outcome_actor_id="u", decided_at=T)  # outcome while pending
        self.approval("ap4", state="approved", outcome_option_id="a", outcome_actor_id="u", decided_at=T)
        self.rejects(self.approval, "ap5", state="approved", outcome_option_id="a")  # actor and time are required
        self.rejects(self.approval, "ap6", options_json='[{"id":"a"}]')  # at least two options
        self.rejects(self.approval, "ap7", expires_at=T)
        self.rejects(self.approval, "ap8", kind="start-gate")
        self.rejects(self.approval, "ap9", kind="budget")  # not in M0-lite
        self.rejects(self.approval, "ap10", context_digest="short")

    def test_approval_is_applied_exactly_once_and_never_resurrects(self):
        self.approval("ap1", state="approved", outcome_option_id="a", outcome_actor_id="u", decided_at=T)
        self.approval("ap2", state="approved", outcome_option_id="a", outcome_actor_id="u", decided_at=T)
        self.raises_abort("UPDATE approvals SET state='applied' WHERE id='ap1'")  # applied needs the command id (CHECK)
        self.db.execute("UPDATE approvals SET state='applied', applied_by_command_id='c1' WHERE id='ap1'")
        self.rejects(self.db.execute, "UPDATE approvals SET state='applied', applied_by_command_id='c1' WHERE id='ap2'")
        self.raises_abort("UPDATE approvals SET state='approved', applied_by_command_id=NULL WHERE id='ap1'")
        self.approval("ap3", state="pending")
        self.raises_abort("UPDATE approvals SET state='applied', applied_by_command_id='c9' WHERE id='ap3'")
        self.approval("ap4", state="rejected", outcome_option_id="b", outcome_actor_id="u", decided_at=T)
        self.raises_abort("UPDATE approvals SET state='approved' WHERE id='ap4'")
        self.approval("ap5", state="expired")
        self.raises_abort("UPDATE approvals SET state='approved' WHERE id='ap5'")
        self.raises_abort("UPDATE approvals SET outcome_option_id='b' WHERE id='ap2'")  # decision is immutable

    def test_effects_never_push_main_and_unknown_is_not_blindly_retried(self):
        self.task()
        self.attempt("a1", state="running")
        self.effect("e1")
        self.rejects(self.effect, "e2", branch="main")
        self.rejects(self.effect, "e3", branch="refs/heads/master")
        self.rejects(self.effect, "e4", branch="MAIN")
        self.rejects(self.effect, "e5", idempotency_key="k-e1")  # same key twice
        self.rejects(self.effect, "e6", state="failed", completed_at=T)  # failed needs an error
        self.rejects(self.effect, "e7", state="done")
        self.db.execute("UPDATE effects SET state='unknown' WHERE id='e1'")
        self.raises_abort("UPDATE effects SET state='pending' WHERE id='e1'")
        self.db.execute("UPDATE effects SET state='done', completed_at=? WHERE id='e1'", (T,))
        self.raises_abort("UPDATE effects SET state='failed' WHERE id='e1'")

    def test_usage_never_stores_unknown_cost_as_zero(self):
        self.task()
        self.attempt("a1", state="running")
        base = "INSERT INTO usage_records VALUES ('p1',?,'t1','a1',NULL,'9router','m','low',?,?,?,?,?,?,?,?,?)"
        self.db.execute(base, ("u1", 55176, 39040, 537, 0, "unknown", None, None, "no price list", T))
        self.db.execute(base, ("u2", None, None, None, None, "unknown", None, None, "not reported", "2026-11-07T00:00:01.000Z"))
        self.db.execute(base, ("u3", 1, 0, 1, 0, "known", 0.12, "USD", None, "2026-11-07T00:00:02.000Z"))
        self.rejects(self.db.execute, base, ("u4", 1, 0, 1, 0, "unknown", 0, "USD", None, "2026-11-07T00:00:03.000Z"))  # zero is not unknown
        self.rejects(self.db.execute, base, ("u5", 1, 0, 1, 0, "known", None, None, None, "2026-11-07T00:00:04.000Z"))
        self.rejects(self.db.execute, base, ("u6", -1, 0, 1, 0, "unknown", None, None, "x", "2026-11-07T00:00:05.000Z"))
        self.assertEqual(self.db.execute("SELECT count(*) FROM usage_records WHERE input_tokens IS NULL").fetchone()[0], 1)

    def test_conversation_usage_counts_without_an_attempt(self):
        self.db.execute("INSERT INTO agents VALUES ('p1','lead',1,'{}')")
        self.db.execute("INSERT INTO workflow_revisions VALUES ('p1','wf',1,'{}')")
        self.db.execute("INSERT INTO conversations VALUES ('p1','chat',1,'lead',NULL,'Lead')")
        cols = ("(project_id,id,task_id,attempt_id,conversation_id,provider,model,effort,cost_kind,"
                "cost_unknown_reason,recorded_at)")
        ok = "INSERT INTO usage_records " + cols + " VALUES ('p1',?,?,?,?,'9router','m',NULL,'unknown','no price',?)"
        self.db.execute(ok, ("c1", None, None, "chat", T))  # effort may be absent
        self.rejects(self.db.execute, ok, ("c2", None, None, None, T))  # neither attempt nor conversation
        self.rejects(self.db.execute, ok, ("c3", None, None, "missing-chat", T))
        self.task()
        self.rejects(self.db.execute, ok, ("c4", None, "a-none", "chat", T))  # unknown attempt
        self.attempt("a1", state="running")
        self.rejects(self.db.execute, ok, ("c5", None, "a1", None, T))  # attempt usage must name its task

    def test_budgets(self):
        ins = "INSERT INTO budgets VALUES ('p1',?,1,?,?,?,?)"
        self.db.execute(ins, ("b1", "day", "2026-11-07", 200000, 80))
        self.rejects(self.db.execute, ins, ("b2", "day", "2026-11-07", 1, 80))  # one budget per scope+ref
        self.rejects(self.db.execute, ins, ("b3", "day", "today", 1, 80))
        self.rejects(self.db.execute, ins, ("b4", "task", "t1", 0, 80))
        self.rejects(self.db.execute, ins, ("b5", "task", "t1", 100, 100))
        self.rejects(self.db.execute, ins, ("b6", "week", "x", 100, 80))
        self.db.execute(ins, ("b7", "task", "t1", 100, 99))

    def test_foreign_keys_hold_across_the_new_tables(self):
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(), [])


if __name__ == "__main__":
    unittest.main()
