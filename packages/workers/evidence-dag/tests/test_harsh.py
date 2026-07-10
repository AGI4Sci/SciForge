"""Harsh / adversarial / stress tests for base stability (no fine-tuning;
we make the deterministic core unbreakable). All offline (stub/fake LLM) so
they are fast and deterministic. Run: python -m unittest tests.test_harsh -v
"""
from __future__ import annotations

import http.client
import json
import os
import random
import socket
import sys
import threading
import unittest
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from evidence_dag import provjson  # noqa: E402
from evidence_dag.extractor import _parse_json, build_graph, render_trace  # noqa: E402
from evidence_dag.graph import ThreadGraph  # noqa: E402
from evidence_dag.llm import StubLLM  # noqa: E402
from evidence_dag.metrics import all_metrics  # noqa: E402
from evidence_dag.model import EdgeRel, NodeStatus, NodeType, normalize  # noqa: E402
from evidence_dag.server import Handler  # noqa: E402
from evidence_dag.service import Engine  # noqa: E402
from evidence_dag.verifier import edge_nli, noisy_or, nli_score, parse_judge_score, split_sentences, verify  # noqa: E402


class FakeLLM:
    """Returns a fixed string from chat() regardless of input — to test the
    verifier's tolerance of garbage NLI output."""
    def __init__(self, reply: str):
        self.reply = reply

    def chat(self, messages, *, temperature=0.0, max_tokens=2048):
        return self.reply


# ---------------------------------------------------------------------------
class TestParseJsonRobustness(unittest.TestCase):
    def test_code_fence(self):
        self.assertEqual(_parse_json('```json\n{"a":1}\n```'), {"a": 1})

    def test_prose_around_json(self):
        self.assertEqual(_parse_json('Sure! Here it is: {"a": 2} Hope that helps.'), {"a": 2})

    def test_plain(self):
        self.assertEqual(_parse_json('{"x": [1,2,3]}'), {"x": [1, 2, 3]})

    def test_garbage_raises(self):
        with self.assertRaises(Exception):
            _parse_json("not json at all, no braces")


class TestBuildGraphNeverCrashes(unittest.TestCase):
    """build_graph must tolerate ANY dict-shaped input without raising."""

    HOSTILE = [
        {},
        {"nodes": None, "edges": None},
        {"nodes": "a string not a list", "edges": 42},
        {"nodes": [None, 5, "x", {}], "edges": [None, "y", {}]},
        {"nodes": [{"type": "claim"}]},                         # missing content
        {"nodes": [{"type": "bogus", "content": "c"}]},          # bad type
        {"nodes": [{"type": "claim", "content": 12345}]},        # non-str content
        {"nodes": [{"type": "claim", "content": "c", "tmp_id": None}]},
        {"nodes": [{"type": "source_assertion", "content": "s", "ref": "not a dict"}]},
        {"edges": [{"rel": "supports", "src": "ghost", "dst": "ghost2"}]},
        {"edges": [{"src": "a"}]},                               # missing rel
        {"nodes": [{"type": "claim", "content": "c", "tmp_id": "n1"}],
         "edges": [{"rel": "weird", "src": "n1", "dst": "n1"}]},  # bad rel + self loop
    ]

    def test_hostile_inputs(self):
        for i, payload in enumerate(self.HOSTILE):
            with self.subTest(case=i):
                g = build_graph(payload, "t")  # must not raise
                self.assertIsInstance(g, ThreadGraph)
                # graph must remain internally consistent: no dangling/self edges
                for e in g.edges.values():
                    self.assertIn(e.src, g.nodes)
                    self.assertIn(e.dst, g.nodes)
                    self.assertNotEqual(e.src, e.dst)

    def test_non_dict_parsed(self):
        for bad in ([], "str", 7, None):
            self.assertEqual(len(build_graph(bad, "t").nodes), 0)

    def test_idempotent_build(self):
        payload = {"nodes": [{"type": "source_assertion", "content": "E", "tmp_id": "s"},
                             {"type": "claim", "content": "C", "tmp_id": "c"}],
                   "edges": [{"src": "s", "dst": "c", "rel": "supports"}]}
        g1, g2 = build_graph(payload, "t"), build_graph(payload, "t")
        self.assertEqual(g1.to_dict()["nodes"], g2.to_dict()["nodes"])
        self.assertEqual(g1.to_dict()["edges"], g2.to_dict()["edges"])


class TestRenderTraceRobustness(unittest.TestCase):
    def test_adversarial_items(self):
        trace = [
            {},                                                  # empty -> fallback id
            {"id": "s1", "type": "message", "content": None},
            {"id": "s2", "type": "tool_result", "content": {"nested": [1, 2, {"x": "y"}]}},
            {"id": "s3", "type": "tool_call", "tool_name": "t", "arguments": {"q": "x" * 5000}},
            {"id": "s4", "type": "message", "role": "user", "content": "emoji 🧪🔬 and 中文 and \n newlines"},
            {"id": "s5", "type": "weirdtype", "content": 12345},
        ]
        out = render_trace(trace)  # must not raise
        self.assertIn("[s1]", out)
        self.assertIn("🧪", out)
        self.assertLess(len(out), 20000)  # huge args got truncated


class TestGraphRobustness(unittest.TestCase):
    def test_dedup_whitespace_case(self):
        g = ThreadGraph("t")
        a = g.add_or_get_node(NodeType.SOURCE_ASSERTION, "Paper A.")
        b = g.add_or_get_node(NodeType.SOURCE_ASSERTION, "  paper   A.  ")
        self.assertEqual(a.id, b.id)
        self.assertEqual(len(g.nodes), 1)

    def test_dedup_different_type_not_merged(self):
        g = ThreadGraph("t")
        a = g.add_or_get_node(NodeType.SOURCE_ASSERTION, "X")
        b = g.add_or_get_node(NodeType.CLAIM, "X")
        self.assertNotEqual(a.id, b.id)

    def test_self_loop_and_dangling_rejected(self):
        g = ThreadGraph("t")
        a = g.add_or_get_node(NodeType.CLAIM, "A")
        self.assertIsNone(g.add_edge(a.id, a.id, EdgeRel.SUPPORTS))
        self.assertIsNone(g.add_edge(a.id, "missing", EdgeRel.SUPPORTS))
        self.assertEqual(len(g.edges), 0)

    def test_multi_cycle_report(self):
        g = ThreadGraph("t")
        ids = [g.add_or_get_node(NodeType.CLAIM, f"N{i}").id for i in range(4)]
        g.add_edge(ids[0], ids[1], EdgeRel.SUPPORTS)
        g.add_edge(ids[1], ids[0], EdgeRel.SUPPORTS)   # cycle 1
        g.add_edge(ids[2], ids[3], EdgeRel.SUPPORTS)
        g.add_edge(ids[3], ids[2], EdgeRel.SUPPORTS)   # cycle 2
        rep = g.detect_cycles()
        self.assertFalse(rep["acyclic"])
        self.assertEqual(rep["cycle_count"], 2)

    def test_provenance_terminates_on_cycle(self):
        g = ThreadGraph("t")
        a = g.add_or_get_node(NodeType.CLAIM, "A")
        b = g.add_or_get_node(NodeType.CLAIM, "B")
        g.add_edge(a.id, b.id, EdgeRel.SUPPORTS)
        g.add_edge(b.id, a.id, EdgeRel.SUPPORTS)
        path = g.provenance_path(a.id)  # must not infinite-loop
        self.assertEqual(set(path["nodes"][0].keys()) and len(path["nodes"]), 2)

    def test_provenance_unknown_node_raises(self):
        with self.assertRaises(KeyError):
            ThreadGraph("t").provenance_path("nope")

    def test_layers_with_cycle_no_crash(self):
        g = ThreadGraph("t")
        a = g.add_or_get_node(NodeType.CLAIM, "A")
        b = g.add_or_get_node(NodeType.CLAIM, "B")
        g.add_edge(a.id, b.id, EdgeRel.SUPPORTS)
        g.add_edge(b.id, a.id, EdgeRel.SUPPORTS)
        self.assertIsInstance(g.layers(), list)  # cyclic nodes excluded, no crash


class TestProvJsonAdversarial(unittest.TestCase):
    def _roundtrip(self, g: ThreadGraph):
        self.assertEqual(provjson.loads(provjson.dumps(g)).to_dict(), g.to_dict())

    def test_unicode_none_and_long(self):
        g = ThreadGraph("t-🔬", meta={"k": "中文"})
        s = g.add_or_get_node(NodeType.SOURCE_ASSERTION, "源 🧪 " + "x" * 3000)
        c = g.add_or_get_node(NodeType.CLAIM, "结论。")
        g.add_edge(s.id, c.id, EdgeRel.SUPPORTS, nli_score=0.5)
        self._roundtrip(g)

    def test_cyclic_graph_roundtrip(self):
        g = ThreadGraph("t")
        a = g.add_or_get_node(NodeType.CLAIM, "A")
        b = g.add_or_get_node(NodeType.CLAIM, "B")
        g.add_edge(a.id, b.id, EdgeRel.SUPPORTS, nli_score=0.9)
        g.add_edge(b.id, a.id, EdgeRel.CONTRADICTS)
        self._roundtrip(g)

    def test_empty_and_minimal_docs(self):
        self.assertEqual(len(provjson.from_prov_json({}).nodes), 0)
        self.assertEqual(len(provjson.from_prov_json({"entity": {}}).nodes), 0)

    def test_unknown_keys_ignored(self):
        doc = provjson.to_prov_json(ThreadGraph("t"))
        doc["someOtherProvRelation"] = {"r1": {"x": 1}}
        doc["activity"] = {"a1": {}}
        g = provjson.from_prov_json(doc)  # must not crash
        self.assertEqual(len(g.nodes), 0)


class TestVerifierRobustness(unittest.TestCase):
    def test_noisy_or_edges(self):
        self.assertEqual(noisy_or([]), 0.0)
        self.assertEqual(noisy_or([1.0]), 1.0)
        self.assertEqual(noisy_or([0.0, 0.0]), 0.0)
        self.assertAlmostEqual(noisy_or([1.0, 0.5]), 1.0)
        self.assertAlmostEqual(noisy_or([2.0, -1.0]), 1.0)  # clamped

    def test_split_sentences_variants(self):
        self.assertEqual(split_sentences(""), [])
        self.assertEqual(split_sentences("no punctuation here"), ["no punctuation here"])
        self.assertEqual(len(split_sentences("中文一。中文二。")), 2)

    def test_nli_garbage_output_falls_back(self):
        self.assertEqual(nli_score(FakeLLM("absolutely yes, strongly entailed!"), "p", "h"), 0.0)
        self.assertAlmostEqual(nli_score(FakeLLM("score is 0.83 I think"), "p", "h"), 0.83)
        self.assertAlmostEqual(nli_score(FakeLLM('{"entailment": 1.7}'), "p", "h"), 1.0)  # clamp

    def test_judge_score_parser_rejects_unkeyed_prose_numbers(self):
        self.assertIsNone(parse_judge_score("1 strong reason supports this, but no score was given"))
        self.assertAlmostEqual(parse_judge_score('```json\n{"support": 0.62}\n```'), 0.62)
        self.assertAlmostEqual(parse_judge_score("Here is the result: {\"contradiction\": 0.4}"), 0.4)

    def test_verify_empty_graph(self):
        g = ThreadGraph("t")
        diff = verify(g, StubLLM(nli_handler=lambda p, h: 0.9))
        self.assertEqual(diff["supports_edges_scored"], 0)
        self.assertEqual(diff["status_changes"], [])


class TestMetricsEdgeCases(unittest.TestCase):
    def test_empty_graph(self):
        m = all_metrics(ThreadGraph("t"))
        self.assertEqual(m["provenance_coverage"], 1.0)
        self.assertEqual(m["provenance_soundness"], 0.0)
        self.assertEqual(m["audit_effort"], 0.0)
        self.assertEqual(m["contradiction_transparency"]["ratio"], 1.0)

    def test_claim_without_source(self):
        g = ThreadGraph("t")
        g.add_or_get_node(NodeType.CLAIM, "lonely claim")
        m = all_metrics(g)
        self.assertEqual(m["provenance_coverage"], 0.0)  # no path to a source
        self.assertEqual(m["provenance_soundness"], 0.0)


class TestFuzz(unittest.TestCase):
    def test_random_payloads_never_crash(self):
        rng = random.Random(1234)
        types = ["source", "reasoning", "claim", "bogus", None, 5]
        rels = ["supports", "contradicts", "refines", "prerequisite", "x", None]
        for _ in range(300):
            n = rng.randint(0, 8)
            nodes = []
            for j in range(n):
                node = {"tmp_id": f"n{j}", "type": rng.choice(types)}
                if rng.random() < 0.8:
                    node["content"] = rng.choice(["c" + str(j), "", None, 42, "重复内容"])
                nodes.append(node if rng.random() < 0.9 else rng.choice([None, "x", 3]))
            edges = [{"src": f"n{rng.randint(0, n + 1)}", "dst": f"n{rng.randint(0, n + 1)}",
                      "rel": rng.choice(rels)} for _ in range(rng.randint(0, 6))]
            g = build_graph({"nodes": nodes, "edges": edges}, "fuzz")  # must not raise
            # round-trip must survive any built graph
            self.assertEqual(provjson.loads(provjson.dumps(g)).to_dict(), g.to_dict())
            all_metrics(g)            # must not raise
            g.detect_cycles()         # must not raise
            for nid in list(g.nodes):
                g.provenance_path(nid)  # must terminate & not raise


# ---------------------------------------------------------------------------
EXTRACT_JSON = ('{"nodes":[{"tmp_id":"s","type": "source_assertion","content":"Evidence.","trace_ref":"step-1"},'
                '{"tmp_id":"c","type":"claim","content":"Claim.","trace_ref":"step-2"}],'
                '"edges":[{"src":"s","dst":"c","rel":"supports"}]}')
SERVER_TOKEN = "test-evidence-dag-token"


class TestServerRobustness(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.prev_token = Handler.api_token
        cls.prev_max_body = Handler.max_json_body_bytes
        Handler.engine = Engine(StubLLM(extract_response=EXTRACT_JSON, nli_handler=lambda p, h: 0.9))
        Handler.api_token = SERVER_TOKEN
        Handler.max_json_body_bytes = 1_048_576
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        Handler.api_token = cls.prev_token
        Handler.max_json_body_bytes = cls.prev_max_body

    def _req(self, method, path, body=None, token=SERVER_TOKEN):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        headers = {"Content-Type": "application/json"}
        if token is not None:
            headers["Authorization"] = f"Bearer {token}"
        conn.request(method, path, body=json.dumps(body) if body is not None else None, headers=headers)
        resp = conn.getresponse()
        data = json.loads(resp.read().decode("utf-8"))
        conn.close()
        return resp.status, data

    def _raw_post(self, path, raw: bytes, token=SERVER_TOKEN):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        headers = {"Content-Type": "application/json"}
        if token is not None:
            headers["Authorization"] = f"Bearer {token}"
        conn.request("POST", path, body=raw, headers=headers)
        resp = conn.getresponse()
        data = json.loads(resp.read().decode("utf-8"))
        conn.close()
        return resp.status, data

    def _chunked_post(self, path, chunks, token=SERVER_TOKEN):
        body = b"".join(f"{len(chunk):x}\r\n".encode("ascii") + chunk + b"\r\n" for chunk in chunks)
        body += b"0\r\n\r\n"
        headers = [
            f"POST {path} HTTP/1.1",
            f"Host: 127.0.0.1:{self.port}",
            "Content-Type: application/json",
            "Transfer-Encoding: chunked",
        ]
        if token is not None:
            headers.append(f"Authorization: Bearer {token}")
        request = ("\r\n".join(headers) + "\r\n\r\n").encode("ascii") + body
        with socket.create_connection(("127.0.0.1", self.port), timeout=10) as sock:
            sock.sendall(request)
            sock.shutdown(socket.SHUT_WR)
            raw = b""
            while True:
                chunk = sock.recv(65536)
                if not chunk:
                    break
                raw += chunk
        header_bytes, _, response_body = raw.partition(b"\r\n\r\n")
        status = int(header_bytes.split(b" ", 2)[1])
        data = json.loads(response_body.decode("utf-8"))
        return status, data

    @staticmethod
    def _update_body(thread_id, *, watermark="w1"):
        return {
            "threadId": thread_id, "targetWatermark": watermark,
            "reason": "turn_committed", "priority": "P2",
            "workspaceRoot": os.getcwd(), "projectRoot": os.getcwd(), "projectKey": "tests",
            "trace": [{"id": "step-1", "type": "tool_result", "content": "Evidence."},
                      {"id": "step-2", "type": "message", "content": "Claim."}],
        }

    def test_health_version(self):
        self.assertEqual(self._req("GET", "/health", token=None)[0], 200)
        self.assertEqual(self._req("GET", "/version")[1]["data"]["service"], "evidence-dag-engine")

    def test_json_api_requires_configured_bearer_token(self):
        status, data = self._req("GET", "/threads", token=None)
        self.assertEqual(status, 401)
        self.assertEqual(data["error"]["code"], "UNAUTHORIZED")

        status, data = self._req("GET", "/threads", token="wrong")
        self.assertEqual(status, 401)
        self.assertEqual(data["error"]["code"], "UNAUTHORIZED")

        old_token = Handler.api_token
        old_env = os.environ.pop("SCIFORGE_EVIDENCE_DAG_API_KEY", None)
        try:
            Handler.api_token = ""
            status, data = self._req("GET", "/threads", token=SERVER_TOKEN)
            self.assertEqual(status, 503)
            self.assertEqual(data["error"]["code"], "UNAVAILABLE")
        finally:
            Handler.api_token = old_token
            if old_env is not None:
                os.environ["SCIFORGE_EVIDENCE_DAG_API_KEY"] = old_env

    def test_content_length_body_cap_is_413(self):
        old_max = Handler.max_json_body_bytes
        try:
            Handler.max_json_body_bytes = 8
            status, data = self._raw_post("/updates", b'{"trace":[]}')
            self.assertEqual(status, 413)
            self.assertEqual(data["error"]["code"], "PAYLOAD_TOO_LARGE")
        finally:
            Handler.max_json_body_bytes = old_max

    def test_chunked_body_cap_is_413(self):
        old_max = Handler.max_json_body_bytes
        try:
            Handler.max_json_body_bytes = 8
            status, data = self._chunked_post("/updates", [b'{"trace":', b'[]}'])
            self.assertEqual(status, 413)
            self.assertEqual(data["error"]["code"], "PAYLOAD_TOO_LARGE")
        finally:
            Handler.max_json_body_bytes = old_max

    def test_bad_json_body_is_400(self):
        status, data = self._raw_post("/updates", b"{ this is not json ")
        self.assertEqual(status, 400)
        self.assertEqual(data["error"]["code"], "INVALID_ARGUMENT")

    def test_json_non_object_body_is_400(self):
        status, data = self._raw_post("/updates", b"[1,2,3]")
        self.assertEqual(status, 400)

    def test_missing_required_update_fields_is_400(self):
        status, data = self._req("POST", "/updates", {"trace": []})
        self.assertEqual(status, 400)
        self.assertEqual(data["error"]["code"], "INVALID_ARGUMENT")

    def test_unknown_thread_is_404(self):
        status, data = self._req("GET", "/threads/ghost/graph")
        self.assertEqual(status, 404)
        self.assertEqual(data["error"]["code"], "NOT_FOUND")

    def test_provenance_missing_node_arg_is_400(self):
        self._req("POST", "/updates", self._update_body("tp"))
        status, _ = self._req("GET", "/threads/tp/provenance")
        self.assertEqual(status, 400)

    def test_full_flow_and_idempotency(self):
        trace = self._update_body("flow")
        s1, d1 = self._req("POST", "/updates", trace)
        s2, d2 = self._req("POST", "/updates", {**trace, "trace": None, "reason": "manual_update"})
        self.assertEqual((s1, s2), (200, 200))
        self.assertEqual(d1["data"]["snapshot"]["digest"], d2["data"]["snapshot"]["digest"])
        self.assertTrue(d2["data"]["idempotent"])
        sm, dm = self._req("GET", "/threads/flow/metrics")
        self.assertEqual(sm, 200)
        self.assertIn("provenance_coverage", dm["data"])

    def test_manual_and_auto_audit_runs(self):
        status, data = self._req("POST", "/updates", self._update_body("audit-flow"))
        self.assertEqual(status, 200)
        digest = data["data"]["snapshot"]["digest"]

        status, data = self._req("POST", "/audits",
                                 {"threadId": "audit-flow", "targetDigest": digest,
                                  "level": "L0", "trigger": "auto", "threshold": 0.7})
        self.assertEqual(status, 200)
        self.assertEqual(data["data"]["trigger"], "auto")

        status, data = self._req("GET", "/audits?threadId=audit-flow")
        self.assertEqual(status, 200)
        self.assertGreaterEqual(len(data["data"]["runs"]), 1)

        status, data = self._req("POST", "/audits",
                                 {"threadId": "audit-flow", "targetDigest": digest,
                                  "level": "L0", "trigger": "manual", "threshold": 0.7})
        self.assertEqual(status, 200)
        self.assertEqual(data["data"]["trigger"], "manual")
        self.assertIn("findings", data["data"])

        status, _ = self._req("GET", "/audits?threadId=missing-thread")
        self.assertEqual(status, 404)

    def test_thread_route_decodes_runtime_scoped_ids(self):
        status, _ = self._req("POST", "/updates", self._update_body("claude:thread/one"))
        self.assertEqual(status, 200)
        status, data = self._req("GET", "/threads/claude%3Athread%2Fone/graph")
        self.assertEqual(status, 200)
        self.assertEqual(data["data"]["summary"]["thread_id"], "claude:thread/one")

    def test_concurrent_requests(self):
        errors = []

        def hammer():
            try:
                for _ in range(10):
                    st, _ = self._req("GET", "/health")
                    if st != 200:
                        errors.append(st)
            except Exception as exc:  # noqa: BLE001
                errors.append(repr(exc))

        threads = [threading.Thread(target=hammer) for _ in range(12)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
