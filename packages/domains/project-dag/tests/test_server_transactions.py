"""Regression tests for Project DAG sidecar connection ownership."""
from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest
import urllib.request
from contextlib import contextmanager
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from project_dag.server import Handler, RuntimeActors


def _update_payload(project_key: str) -> dict:
    return {
        "projectKey": project_key,
        "evidenceVector": [],
        "capturedScope": {
            "includedSessions": [],
            "excludedSessions": [],
            "isolatedSessions": [],
        },
        "reason": "manual_immediate",
    }


class RuntimeActorTransactionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.sessions = os.path.join(self.tmp.name, "threads")
        os.makedirs(self.sessions)
        self.actors = RuntimeActors.create(
            os.path.join(self.tmp.name, "project.db"), self.sessions)

    def tearDown(self) -> None:
        for engine in (self.actors.api, self.actors.update, self.actors.audit):
            engine.store.close()
        self.tmp.cleanup()

    def test_concurrent_runtime_actors_own_distinct_sqlite_connections(self) -> None:
        connections = {
            id(self.actors.api.store.conn),
            id(self.actors.update.store.conn),
            id(self.actors.audit.store.conn),
        }
        self.assertEqual(len(connections), 3)

        receipt = self.actors.api.enqueue_update(_update_payload("path:/workspace/a"))
        result = self.actors.update.process_updates("path:/workspace/a")

        self.assertIsNotNone(result)
        status = self.actors.api.update_receipt_status(
            receipt["jobId"],
            receipt["acceptedRequestVersion"],
            receipt["desiredFingerprint"],
        )
        self.assertEqual(status["state"], "committed")

    def test_enqueue_cannot_commit_the_update_workers_open_transaction(self) -> None:
        first_project = "path:/workspace/first"
        second_project = "path:/workspace/second"
        self.actors.api.enqueue_update(_update_payload(first_project))
        entered_commit = threading.Event()
        release_commit = threading.Event()
        enqueue_started = threading.Event()
        original_commit = self.actors.update.workflow._commit_project_snapshot
        errors: list[BaseException] = []

        def paused_commit(*args, **kwargs):
            self.assertTrue(self.actors.update.store.conn.in_transaction)
            entered_commit.set()
            self.assertTrue(release_commit.wait(2))
            return original_commit(*args, **kwargs)

        def capture(callable_, *args):
            try:
                callable_(*args)
            except BaseException as exc:  # noqa: BLE001 - test captures worker failures
                errors.append(exc)

        def enqueue_second_project():
            enqueue_started.set()
            self.actors.api.enqueue_update(_update_payload(second_project))

        with patch.object(
                self.actors.update.workflow,
                "_commit_project_snapshot",
                side_effect=paused_commit):
            worker = threading.Thread(
                target=capture,
                args=(self.actors.update.process_updates, first_project))
            worker.start()
            self.assertTrue(entered_commit.wait(2))
            enqueue = threading.Thread(
                target=capture,
                args=(enqueue_second_project,))
            enqueue.start()
            self.assertTrue(enqueue_started.wait(2))
            self.assertTrue(self.actors.update.store.conn.in_transaction)
            release_commit.set()
            worker.join(3)
            enqueue.join(3)

        self.assertFalse(worker.is_alive())
        self.assertFalse(enqueue.is_alive())
        self.assertEqual(errors, [])
        self.assertIsNotNone(
            self.actors.update.workflow.latest_snapshot(first_project))
        self.assertEqual(
            self.actors.api.update_status(second_project)["state"], "pending")

    def test_enqueue_during_atomic_claim_preserves_both_receipt_generations(self) -> None:
        project = "path:/workspace/generation-race"
        first = self.actors.api.enqueue_update(_update_payload(project))
        selected = threading.Event()
        release_claim = threading.Event()
        enqueue_started = threading.Event()
        enqueue_finished = threading.Event()
        original_q1 = self.actors.update.store.q1
        compiler = self.actors.update.workflow.compiler
        original_compile = compiler.compile_transaction
        paused = False
        errors: list[BaseException] = []
        second_receipts: list[dict] = []

        def pause_after_select(sql, args=()):
            nonlocal paused
            row = original_q1(sql, args)
            if not paused and "SELECT * FROM project_update_job WHERE" in sql:
                paused = True
                self.assertTrue(self.actors.update.store.conn.in_transaction)
                selected.set()
                self.assertTrue(release_claim.wait(2))
            return row

        @contextmanager
        def compile_after_enqueue(*args, **kwargs):
            self.assertTrue(enqueue_finished.wait(2))
            with original_compile(*args, **kwargs) as result:
                yield result

        def process() -> None:
            try:
                self.actors.update.process_updates(project)
            except BaseException as exc:  # noqa: BLE001 - test captures worker failures
                errors.append(exc)

        def enqueue_new_generation() -> None:
            enqueue_started.set()
            try:
                payload = {**_update_payload(project), "autonomyMode": "autonomous"}
                second_receipts.append(self.actors.api.enqueue_update(payload))
            except BaseException as exc:  # noqa: BLE001 - test captures API failures
                errors.append(exc)
            finally:
                enqueue_finished.set()

        with patch.object(self.actors.update.store, "q1", side_effect=pause_after_select), \
                patch.object(
                    compiler, "compile_transaction", side_effect=compile_after_enqueue):
            worker = threading.Thread(target=process)
            worker.start()
            self.assertTrue(selected.wait(2))
            enqueue = threading.Thread(target=enqueue_new_generation)
            enqueue.start()
            self.assertTrue(enqueue_started.wait(2))
            release_claim.set()
            enqueue.join(3)
            worker.join(3)

        self.assertEqual(errors, [])
        self.assertEqual(len(second_receipts), 1)
        second = second_receipts[0]
        self.assertEqual(second["jobId"], first["jobId"])
        self.assertEqual(
            second["acceptedRequestVersion"],
            first["acceptedRequestVersion"] + 1,
        )
        first_status = self.actors.api.update_receipt_status(
            first["jobId"],
            first["acceptedRequestVersion"],
            first["desiredFingerprint"],
        )
        second_status = self.actors.api.update_receipt_status(
            second["jobId"],
            second["acceptedRequestVersion"],
            second["desiredFingerprint"],
        )
        self.assertEqual(first_status["state"], "committed")
        self.assertEqual(second_status["state"], "queued")
        self.assertEqual(
            self.actors.api.workflow.job(first["jobId"])["processing_version"],
            first["acceptedRequestVersion"],
        )

    def test_audit_selection_and_claim_share_one_explicit_transaction(self) -> None:
        project = "path:/workspace/audit-claim"
        self.actors.api.enqueue_update(_update_payload(project))
        self.assertIsNotNone(self.actors.update.process_updates(project))
        original_q1 = self.actors.audit.store.q1
        observed_claim_transaction: list[bool] = []

        def observe_claim(sql, args=()):
            if "SELECT id FROM project_update_job WHERE" in sql:
                observed_claim_transaction.append(
                    self.actors.audit.store.conn.in_transaction)
            return original_q1(sql, args)

        with patch.object(self.actors.audit.store, "q1", side_effect=observe_claim):
            result = self.actors.audit.process_audits(project)

        self.assertIsNotNone(result)
        self.assertEqual(observed_claim_transaction, [True])


class HttpActorSerializationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        sessions = os.path.join(self.tmp.name, "threads")
        os.makedirs(sessions)
        self.actors = RuntimeActors.create(
            os.path.join(self.tmp.name, "project.db"), sessions)
        self.previous_engine = Handler.engine
        self.previous_token = Handler.api_token
        Handler.engine = self.actors.api
        Handler.api_token = "test-token"
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server_thread = threading.Thread(
            target=self.server.serve_forever, daemon=True)
        self.server_thread.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.server_thread.join(2)
        Handler.engine = self.previous_engine
        Handler.api_token = self.previous_token
        for engine in (self.actors.api, self.actors.update, self.actors.audit):
            engine.store.close()
        self.tmp.cleanup()

    def _request(self, method: str, path: str, body: dict | None = None) -> dict:
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.server.server_port}{path}",
            method=method,
            data=data,
            headers={
                "Authorization": "Bearer test-token",
                "Content-Type": "application/json",
            },
        )
        with urllib.request.urlopen(request, timeout=3) as response:
            return json.loads(response.read())

    def test_threaded_http_enqueue_and_status_are_serialized_on_api_connection(self) -> None:
        project = "path:/workspace/http"
        entered_enqueue = threading.Event()
        release_enqueue = threading.Event()
        entered_status = threading.Event()
        original_enqueue = self.actors.api.enqueue_update
        original_status = self.actors.api.update_status
        responses: list[dict] = []
        errors: list[BaseException] = []
        status_request_started = threading.Event()

        def paused_enqueue(payload, *, actor="runtime"):
            entered_enqueue.set()
            self.assertTrue(release_enqueue.wait(2))
            return original_enqueue(payload, actor=actor)

        def observed_status(project_key):
            entered_status.set()
            return original_status(project_key)

        def capture(callable_, *args):
            try:
                responses.append(callable_(*args))
            except BaseException as exc:  # noqa: BLE001 - test captures request failures
                errors.append(exc)

        def request_status():
            status_request_started.set()
            return self._request(
                "GET", f"/updates/status?projectKey={project}")

        with patch.object(self.actors.api, "enqueue_update", side_effect=paused_enqueue), \
                patch.object(self.actors.api, "update_status", side_effect=observed_status):
            enqueue = threading.Thread(
                target=capture,
                args=(self._request, "POST", "/updates", _update_payload(project)))
            enqueue.start()
            self.assertTrue(entered_enqueue.wait(2))
            status = threading.Thread(
                target=capture,
                args=(request_status,))
            status.start()
            self.assertTrue(status_request_started.wait(2))
            self.assertFalse(entered_status.wait(0.05))
            self.assertFalse(entered_status.is_set())
            release_enqueue.set()
            enqueue.join(3)
            status.join(3)

        self.assertFalse(enqueue.is_alive())
        self.assertFalse(status.is_alive())
        self.assertTrue(entered_status.is_set())
        self.assertEqual(errors, [])
        self.assertEqual(len(responses), 2)
        self.assertTrue(all(response["ok"] for response in responses))


if __name__ == "__main__":
    unittest.main(verbosity=2)
