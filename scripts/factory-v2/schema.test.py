"""Reference SQL invariants in memory only. Not tests of an implemented Host."""

import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class SchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.executescript(
            (ROOT / "schema/factory-v2/001-core.reference.sql").read_text(encoding="utf-8")
        )
        for project in ("p1", "p2"):
            self.db.execute(
                "INSERT INTO projects VALUES (?,1,'Demo','git',?,'active')",
                (project, "/tmp/" + project),
            )
            self.db.execute("INSERT INTO agents VALUES (?, 'a', 1, '{}')", (project,))
            self.db.execute("INSERT INTO workflow_revisions VALUES (?, 'wf', 1, '{}')", (project,))
            self.db.execute(
                "INSERT INTO workflow_statuses VALUES (?, 'wf', 1, 'todo', 'planned')", (project,)
            )
            self.db.execute(
                "INSERT INTO completion_contract_revisions VALUES (?, 'cc', 1, '{}')", (project,)
            )
            self.db.execute(
                "INSERT INTO conversations VALUES (?, 'chat', 1, 'a', NULL, 'Lead')", (project,)
            )
            self.db.execute("INSERT INTO project_streams VALUES (?, 'epoch', 0)", (project,))
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def work(self, work="w1", project="p1", parent=None):
        self.db.execute(
            "INSERT INTO work_items VALUES "
            "(?,?,1,'Task','Brief',?,NULL,'wf',1,'todo','cc',1,'active')",
            (project, work, parent),
        )

    def assignment(self, assignment="as1", work="w1"):
        self.db.execute(
            "INSERT INTO assignments VALUES ('p1', ?, ?, 'a', 'chat', 1, 'queued')",
            (assignment, work),
        )

    def add_run(self, run="r1", assignment="as1", epoch=1):
        self.db.execute(
            "INSERT INTO run_attempts VALUES ('p1',?,?,?,1,'running','known','{}')",
            (run, assignment, epoch),
        )

    def test_cross_project_parent_and_agent_are_rejected(self):
        self.work("private", "p2")
        with self.assertRaises(sqlite3.IntegrityError):
            self.work("child", "p1", "private")
        self.db.execute("INSERT INTO agents VALUES ('p2','private-agent',1,'{}')")
        self.work()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "UPDATE work_items SET assignee_id='private-agent' WHERE project_id='p1'"
            )

    def test_workflow_and_completion_contract_revisions_must_exist(self):
        self.work()
        for clause in ("workflow_revision=2", "status_id='missing'", "contract_revision=2"):
            with self.assertRaises(sqlite3.IntegrityError):
                self.db.execute("UPDATE work_items SET " + clause)

    def test_self_dependencies_and_duplicate_edges_are_rejected(self):
        self.work()
        self.work("w2")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO dependencies VALUES ('p1','w1','w1')")
        self.db.execute("INSERT INTO dependencies VALUES ('p1','w2','w1')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO dependencies VALUES ('p1','w2','w1')")

    def test_independent_work_can_have_parallel_runs(self):
        for suffix in ("1", "2"):
            self.work("w" + suffix)
            self.assignment("as" + suffix, "w" + suffix)
            self.add_run("r" + suffix, "as" + suffix)
        self.assertEqual(
            self.db.execute("SELECT COUNT(*) FROM run_attempts WHERE state='running'").fetchone()[
                0
            ],
            2,
        )

    def test_one_live_assignment_and_attempt_per_work(self):
        self.work()
        self.assignment()
        with self.assertRaises(sqlite3.IntegrityError):
            self.assignment("as2")
        self.add_run()
        with self.assertRaises(sqlite3.IntegrityError):
            self.add_run("r2", epoch=2)
        self.db.execute("UPDATE run_attempts SET state='interrupted'")
        self.add_run("r2", epoch=2)

    def test_messages_and_command_ids_are_deduplicated(self):
        receipt = ("cmd", "p1", "user", "a" * 64, "completed", "{}", "2026-11-06")
        self.db.execute("INSERT INTO command_receipts VALUES (?,?,?,?,?,?,?)", receipt)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO command_receipts VALUES (?,?,?,?,?,?,?)", receipt)
        self.db.execute("INSERT INTO messages VALUES ('p1','m1','chat',1,'cmd','{}')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO messages VALUES ('p1','m2','chat',2,'cmd','{}')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO messages VALUES ('p1','m3','chat',1,NULL,'{}')")
        self.db.execute(
            "INSERT INTO command_receipts VALUES "
            "('other','p2','user',?,'completed','{}','2026-11-06')",
            ("b" * 64,),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO messages VALUES ('p1','m4','chat',2,'other','{}')")

    def test_draft_compare_and_swap_and_send_preserves_newer_draft(self):
        self.db.execute("INSERT INTO drafts VALUES ('p1','chat','user',1,'{}')")
        update = (
            "UPDATE drafts SET revision=revision+1,content_json=? WHERE project_id='p1' "
            "AND conversation_id='chat' AND actor_id='user' AND revision=?"
        )
        self.assertEqual(self.db.execute(update, ('{"text":"new"}', 1)).rowcount, 1)
        self.assertEqual(self.db.execute(update, ('{"text":"stale"}', 1)).rowcount, 0)
        self.assertEqual(self.db.execute(update, ('{"text":""}', 1)).rowcount, 0)
        self.assertEqual(self.db.execute("SELECT revision FROM drafts").fetchone()[0], 2)
        # Clear by CAS + increment; never delete/recreate revision=1 (ABA stale-tab overwrite).
        self.assertEqual(self.db.execute(update, ('{"text":""}', 2)).rowcount, 1)
        self.assertEqual(self.db.execute(update, ('{"text":"stale"}', 1)).rowcount, 0)
        self.assertEqual(self.db.execute("SELECT revision FROM drafts").fetchone()[0], 3)

    def test_callback_transaction_fences_epoch_and_expired_lease(self):
        self.work()
        self.assignment()
        self.add_run()
        self.db.execute("INSERT INTO leases VALUES ('p1','r1','lease','host',100)")
        update = """UPDATE run_attempts SET revision=revision+1
          WHERE project_id='p1' AND id='r1' AND epoch=?
          AND epoch=(SELECT epoch FROM assignments WHERE project_id='p1' AND id='as1')
          AND EXISTS(SELECT 1 FROM leases WHERE project_id='p1'
            AND run_id='r1' AND id='lease' AND expires_at_ms>?)"""
        self.assertEqual(self.db.execute(update, (1, 99)).rowcount, 1)
        self.assertEqual(self.db.execute(update, (1, 100)).rowcount, 0)
        self.assertEqual(self.db.execute(update, (2, 99)).rowcount, 0)
        self.db.execute("UPDATE assignments SET epoch=2")
        self.assertEqual(self.db.execute(update, (1, 99)).rowcount, 0)

    def test_callback_and_scope_lock_unique_constraints(self):
        self.work()
        self.assignment()
        self.add_run()
        self.db.execute("INSERT INTO callback_inbox VALUES ('p1','r1','cb',1)")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO callback_inbox VALUES ('p1','r1','cb2',1)")
        self.db.execute("INSERT INTO reservations VALUES ('workspace:one','p1','r1',1)")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO reservations VALUES ('workspace:one','p1','r1',1)")

    def test_rollback_does_not_leave_events_or_outbox(self):
        self.db.execute("BEGIN IMMEDIATE")
        self.db.execute("UPDATE project_streams SET last_sequence=1 WHERE project_id='p1'")
        self.db.execute("INSERT INTO event_log VALUES ('e1','p1','epoch',1,'{}')")
        self.db.execute("INSERT INTO outbox(event_id) VALUES ('e1')")
        self.db.rollback()
        self.assertEqual(
            self.db.execute(
                "SELECT last_sequence FROM project_streams WHERE project_id='p1'"
            ).fetchone()[0],
            0,
        )
        for table in ("event_log", "outbox"):
            self.assertEqual(self.db.execute("SELECT COUNT(*) FROM " + table).fetchone()[0], 0)

    def test_event_sequence_unique_and_json_valid(self):
        self.db.execute("INSERT INTO event_log VALUES ('e1','p1','epoch',1,'{}')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO event_log VALUES ('e2','p1','epoch',1,'{}')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO event_log VALUES ('e3','p1','epoch',2,'invalid json')")
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
