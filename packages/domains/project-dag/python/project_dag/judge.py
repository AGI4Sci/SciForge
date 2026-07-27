"""llm_judge(task_type, payload) -> dict — the single funnel for every LLM
judgement in the compile pipeline (distill / entity_same / claim_equiv /
contradiction).

Reuses the evidence-dag Model Router client. Every call is cached in SQLite by
(task_type, payload hash) so re-compiles are free and replayable; majority
voting for entity resolution runs the SAME payload with vote_seed 0..2 so the
votes are independent cache entries.
"""
from __future__ import annotations

import hashlib
import json
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from collections.abc import Iterator
from typing import Any, Optional

from .store import Store

PROMPTS: dict[str, str] = {
    "distill": """PDAG-TASK: distill
You promote ONE claim node from a session evidence-DAG into a project-level
claim candidate. You only restate and classify what the subgraph already says;
you NEVER invent facts.
Input JSON: {claim, subgraph:{nodes:[{id,type,content}],edges}, active_goals:[{id,title,description}]}
Output STRICT JSON only:
{"statement":"<one self-contained sentence, past-tense finding>",
 "claim_type":"hypothesis|finding|method_result|negative_result|decision",
 "mentioned_entities":["<dataset/variable/material/method names in the statement>"],
 "addresses_goal":"<goal id or 'none'>",
 "source_node_ids":["<ids from subgraph.nodes that ground the statement>"],
 "confidence":0.0}
source_node_ids MUST be copied verbatim from subgraph.nodes ids.""",

    "entity_same": """PDAG-TASK: entity_same
Decide whether NAME refers to the SAME real-world entity as CANDIDATE (a
dataset, variable, material, method, hypothesis object...). Different naming or
casing of one thing => same. Different version/subset/derivative => NOT same.
Output STRICT JSON only: {"same": true|false, "confidence": 0.0}""",

    "claim_equiv": """PDAG-TASK: claim_equiv
Compare a NEW claim against a POOL of existing claims from the same goal.
- equivalent: states the same finding (possibly reworded / different precision)
- refines: strictly narrows, qualifies or extends one existing claim
- new: none of the above
Output STRICT JSON only:
{"relation":"equivalent|refines|new","target":"<pool claim id or null>","confidence":0.0}""",

    "goal_match": """PDAG-TASK: goal_match
Re-evaluate which active project Goal an EXISTING committed claim addresses after
the Goal tree changed. Do not rewrite the claim. Choose exactly one active goal
only when the claim materially contributes to it; otherwise choose none.
Output STRICT JSON only:
{"goal_id":"<active goal id or none>","confidence":0.0,"reason":"<visible rationale>"}""",

    "contradiction": """PDAG-TASK: contradiction
Do these two claims contradict each other (cannot both hold)? Answer ONLY
whether they conflict; do NOT judge which is right.
Output STRICT JSON only: {"contradicts": true|false, "confidence": 0.0}""",

    "a1_verify": """PDAG-TASK: a1_verify
You are an independent verifier. You did NOT produce the claim or its distill
output. Given one project claim, its explicit support assertions, provenance
metadata and scope, separately assess semantic entailment and applicability.
Do not infer missing facts. Output STRICT JSON only:
{"entailment":{"result":"passed|failed|uncertain","confidence":0.0,"reason":"..."},
 "applicability":{"result":"passed|failed|uncertain","confidence":0.0,"reason":"..."}}""",

    "a2_adversarial": """PDAG-TASK: a2_adversarial
You are an independent adversarial reviewer in a snapshot-isolated context.
Challenge methodology, source independence, alternative explanations and
reproducibility using only the supplied claim/support/provenance metadata.
Missing information must produce uncertain, never passed. Output STRICT JSON:
{"methodology":{"result":"passed|failed|uncertain","confidence":0.0,"reason":"..."},
 "reproducibility":{"result":"passed|failed|uncertain","confidence":0.0,"reason":"..."},
 "independence":{"result":"passed|failed|uncertain","confidence":0.0,"reason":"..."}}""",
}

_REPAIR_OUTPUT_TOKENS = 16_384
_REPAIR_INSTRUCTION = """

Your previous response was not valid complete JSON. Re-run the same task on the
same input and return exactly one complete JSON object matching the output
schema above. Return JSON only: no markdown fence, commentary, or omitted
fields. The first character must be `{` and the last character must be `}`."""


class JudgePreparationRequired(RuntimeError):
    """Signals that a model response must be prepared outside a transaction."""

    def __init__(self, task_type: str, payload: dict, vote_seed: int = 0) -> None:
        super().__init__(f"model judgement requires preparation: {task_type}")
        self.task_type = task_type
        self.payload = payload
        self.vote_seed = vote_seed


class ProjectJudgementError(RuntimeError):
    """Stable, non-sensitive failure for deterministic judgement output."""

    def __init__(self, task_type: str, *, attempts: int) -> None:
        self.code = "project_judgement_invalid_json"
        self.task_type = task_type
        self.attempts = attempts
        self.retryable = False
        super().__init__(
            "Project model judgement did not return a complete JSON object "
            f"(task={task_type}, attempts={attempts}).")


class _InvalidJudgementOutput(ValueError):
    """Internal parse signal that never reflects model output."""


def _parse_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        raise _InvalidJudgementOutput(
            "Project model judgement did not contain a JSON object.")
    try:
        parsed = json.loads(m.group(0))
    except json.JSONDecodeError as exc:
        raise _InvalidJudgementOutput(
            "Project model judgement contained invalid JSON.") from exc
    if not isinstance(parsed, dict):
        raise _InvalidJudgementOutput(
            "Project model judgement JSON must be an object.")
    return parsed


class Judge:
    def __init__(self, llm: Any, store: Optional[Store] = None) -> None:
        self.llm = llm          # evidence_dag.llm.LLM protocol (chat())
        self.store = store
        self._prepared: dict[str, dict] = {}
        self._prepared_lock = threading.RLock()
        self._local = threading.local()

    @contextmanager
    def model_calls_forbidden(self) -> Iterator[None]:
        previous = bool(getattr(self._local, "model_calls_forbidden", False))
        self._local.model_calls_forbidden = True
        try:
            yield
        finally:
            self._local.model_calls_forbidden = previous

    @staticmethod
    def _request(task_type: str, payload: dict, vote_seed: int = 0) -> tuple[str, str, str]:
        system = PROMPTS[task_type]
        user = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        key = hashlib.sha1(f"{task_type}|{vote_seed}|{user}".encode("utf-8")).hexdigest()
        return key, system, user

    def _invoke(self, task_type: str, payload: dict, vote_seed: int = 0) -> dict:
        _, system, user = self._request(task_type, payload, vote_seed)
        if vote_seed:
            user += f'\n(vote {vote_seed})'
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]
        raw = self.llm.chat(
            messages, temperature=0.3 if vote_seed else 0.0)
        try:
            return _parse_json(raw)
        except _InvalidJudgementOutput:
            repaired = self.llm.chat(
                [
                    {"role": "system", "content": system + _REPAIR_INSTRUCTION},
                    {"role": "user", "content": user},
                ],
                temperature=0.0,
                max_tokens=_REPAIR_OUTPUT_TOKENS,
            )
            try:
                return _parse_json(repaired)
            except _InvalidJudgementOutput as exc:
                raise ProjectJudgementError(task_type, attempts=2) from exc

    def __call__(self, task_type: str, payload: dict, *, vote_seed: int = 0) -> dict:
        key, _, _ = self._request(task_type, payload, vote_seed)
        with self._prepared_lock:
            prepared = self._prepared.get(key)
        if prepared is not None:
            return dict(prepared)
        if self.store is not None:
            with self.store.transaction_lock:
                cached = self.store.cache_get(key)
                if cached is not None:
                    return json.loads(cached)
                if bool(getattr(self._local, "model_calls_forbidden", False)):
                    raise JudgePreparationRequired(task_type, payload, vote_seed)
        out = self._invoke(task_type, payload, vote_seed)
        if self.store is not None:
            with self.store.transaction_lock:
                self.store.cache_put(key, task_type, json.dumps(out, ensure_ascii=False))
                # Outside the compiler's explicit atomic transaction, keep
                # cache persistence as its own short write so later model calls
                # do not inherit a transaction opened by cache_put.
                self.store.conn.commit()
        return out

    def warm_many(self, requests: list[tuple[str, dict, int]], *, workers: int = 4) -> list[dict]:
        """Prepare model judgements without holding a SQLite write transaction.

        Cache reads and the final cache flush are short serialized sections;
        network calls run concurrently in between.  The in-memory prepared map
        also guarantees the following compiler transaction cannot miss a
        warmed response even if cache persistence is unavailable.
        """
        if not requests:
            return []
        unique: dict[str, tuple[str, dict, int]] = {}
        for task_type, payload, vote_seed in requests:
            key, _, _ = self._request(task_type, payload, vote_seed)
            unique.setdefault(key, (task_type, payload, vote_seed))

        resolved: dict[str, dict] = {}
        lock = self.store.transaction_lock if self.store is not None else self._prepared_lock
        with lock:
            for key in unique:
                with self._prepared_lock:
                    prepared = self._prepared.get(key)
                if prepared is not None:
                    resolved[key] = prepared
                    continue
                if self.store is not None:
                    cached = self.store.cache_get(key)
                    if cached is not None:
                        resolved[key] = json.loads(cached)

        missing = [(key, request) for key, request in unique.items() if key not in resolved]

        def invoke(item: tuple[str, tuple[str, dict, int]]) -> tuple[str, dict]:
            key, (task_type, payload, vote_seed) = item
            return key, self._invoke(task_type, payload, vote_seed)

        if missing:
            with ThreadPoolExecutor(max_workers=max(1, min(workers, len(missing)))) as executor:
                for key, output in executor.map(invoke, missing):
                    resolved[key] = output

        with self._prepared_lock:
            self._prepared.update({key: dict(value) for key, value in resolved.items()})
        if self.store is not None and missing:
            with self.store.transaction_lock:
                try:
                    for key, (task_type, _, _) in missing:
                        self.store.cache_put(
                            key, task_type, json.dumps(resolved[key], ensure_ascii=False))
                    self.store.conn.commit()
                except Exception:
                    self.store.conn.rollback()
                    raise

        outputs = []
        for task_type, payload, vote_seed in requests:
            key, _, _ = self._request(task_type, payload, vote_seed)
            outputs.append(dict(resolved[key]))
        return outputs

    def entity_votes(self, payload: dict, n: int = 3) -> tuple[bool, float]:
        """N-vote majority for entity resolution. Returns (same, confidence)
        where confidence = mean confidence of the majority side weighted by
        its share of votes."""
        votes = [self(f"entity_same", payload, vote_seed=i) for i in range(n)]
        yes = [v for v in votes if v.get("same")]
        no = [v for v in votes if not v.get("same")]
        winner = yes if len(yes) > len(no) else no
        share = len(winner) / max(len(votes), 1)
        conf = sum(float(v.get("confidence", 0.5)) for v in winner) / max(len(winner), 1)
        return (winner is yes), round(conf * share, 4)


class StubJudge:
    """Offline deterministic judge for tests: routes by task_type to handlers."""

    def __init__(self, handlers: Optional[dict] = None) -> None:
        self.handlers = handlers or {}
        self.calls: list[tuple[str, dict]] = []
        self._prepared: dict[str, dict] = {}

    @staticmethod
    def _key(task_type: str, payload: dict, vote_seed: int = 0) -> str:
        user = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        return hashlib.sha1(f"{task_type}|{vote_seed}|{user}".encode("utf-8")).hexdigest()

    def __call__(self, task_type: str, payload: dict, *, vote_seed: int = 0) -> dict:
        prepared = self._prepared.get(self._key(task_type, payload, vote_seed))
        if prepared is not None:
            return dict(prepared)
        self.calls.append((task_type, payload))
        h = self.handlers.get(task_type)
        if h is None:
            raise KeyError(f"StubJudge: no handler for {task_type}")
        return h(payload)

    def warm_many(self, requests: list[tuple[str, dict, int]], *, workers: int = 4) -> list[dict]:
        del workers
        outputs = []
        for task_type, payload, vote_seed in requests:
            key = self._key(task_type, payload, vote_seed)
            if key not in self._prepared:
                self.calls.append((task_type, payload))
                handler = self.handlers.get(task_type)
                if handler is None:
                    raise KeyError(f"StubJudge: no handler for {task_type}")
                self._prepared[key] = handler(payload)
            outputs.append(dict(self._prepared[key]))
        return outputs

    def entity_votes(self, payload: dict, n: int = 3) -> tuple[bool, float]:
        out = self("entity_same", payload)
        return bool(out.get("same")), float(out.get("confidence", 0.0))
