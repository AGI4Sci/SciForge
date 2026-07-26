"""Focused tests for Project DAG structured model judgements."""
from __future__ import annotations

import json
import os
import tempfile
import unittest

from evidence_dag.llm import LLMCallError
from project_dag.judge import Judge, ProjectJudgementError, _parse_json
from project_dag.store import Store


class SequenceLLM:
    def __init__(self, *responses: str | BaseException) -> None:
        self.responses = list(responses)
        self.calls: list[dict] = []

    def chat(self, messages: list[dict], *, temperature: float = 0.0,
             max_tokens: int = 2048) -> str:
        self.calls.append({
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        })
        response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        return response


class ProjectJudgementTests(unittest.TestCase):
    def test_parser_accepts_fenced_and_prose_wrapped_json_objects(self):
        self.assertEqual(
            _parse_json('```json\n{"same": true, "confidence": 0.8}\n```'),
            {"same": True, "confidence": 0.8},
        )
        self.assertEqual(
            _parse_json(
                'Judgement follows: {"same": false, "confidence": 0.7} done.'),
            {"same": False, "confidence": 0.7},
        )

    def test_truncated_output_repairs_once_with_same_task_and_payload(self):
        llm = SequenceLLM(
            '{"same": true, "confidence":',
            '{"same":true,"confidence":0.91}',
        )
        payload = {"name": "Dataset A", "candidate": "dataset-a"}

        result = Judge(llm)("entity_same", payload)

        self.assertEqual(result, {"same": True, "confidence": 0.91})
        self.assertEqual(len(llm.calls), 2)
        self.assertEqual(
            llm.calls[0]["messages"][1]["content"],
            llm.calls[1]["messages"][1]["content"],
        )
        self.assertEqual(
            json.loads(llm.calls[1]["messages"][1]["content"]),
            payload,
        )
        self.assertIn("PDAG-TASK: entity_same",
                      llm.calls[1]["messages"][0]["content"])
        self.assertIn("same task", llm.calls[1]["messages"][0]["content"])
        self.assertEqual(llm.calls[1]["temperature"], 0.0)
        self.assertEqual(llm.calls[1]["max_tokens"], 16_384)

    def test_repair_exhaustion_is_typed_bounded_and_not_cached(self):
        secret = "sk-sensitive-value-that-must-not-escape"
        llm = SequenceLLM(
            '{"same": true, "confidence":',
            f'not-json {secret} ' + "x" * 10_000,
            '{"same": true, "confidence":',
            "still not json",
        )
        with tempfile.TemporaryDirectory() as directory:
            store = Store(os.path.join(directory, "project.db"))
            judge = Judge(llm, store)
            payload = {"name": "Dataset A", "candidate": "Dataset A"}
            for expected_calls in (2, 4):
                with self.assertRaises(ProjectJudgementError) as raised:
                    judge("entity_same", payload)
                error = raised.exception
                self.assertEqual(error.code, "project_judgement_invalid_json")
                self.assertEqual(error.task_type, "entity_same")
                self.assertEqual(error.attempts, 2)
                self.assertFalse(error.retryable)
                self.assertNotIn(secret, str(error))
                self.assertLess(len(str(error)), 200)
                self.assertEqual(len(llm.calls), expected_calls)
            self.assertIsNone(store.q1("SELECT key FROM judge_cache"))
            store.close()

    def test_transport_error_propagates_without_a_judgement_repair(self):
        upstream = LLMCallError(
            "upstream_timeout",
            "Upstream request timed out.",
            attempts=5,
            retryable=True,
        )
        llm = SequenceLLM(upstream)

        with self.assertRaises(LLMCallError) as raised:
            Judge(llm)("entity_same", {
                "name": "Dataset A",
                "candidate": "Dataset A",
            })

        self.assertIs(raised.exception, upstream)
        self.assertEqual(len(llm.calls), 1)

    def test_successful_repair_is_the_only_result_written_to_cache(self):
        llm = SequenceLLM(
            '{"same":',
            '{"same":true,"confidence":0.95}',
        )
        with tempfile.TemporaryDirectory() as directory:
            store = Store(os.path.join(directory, "project.db"))
            judge = Judge(llm, store)
            payload = {"name": "Dataset A", "candidate": "Dataset A"}

            repaired = judge("entity_same", payload)
            cached = judge("entity_same", payload)

            self.assertEqual(cached, repaired)
            self.assertEqual(len(llm.calls), 2)
            cache_rows = store.q("SELECT response FROM judge_cache")
            self.assertEqual(len(cache_rows), 1)
            self.assertEqual(json.loads(cache_rows[0]["response"]), repaired)
            store.close()


if __name__ == "__main__":
    unittest.main()
