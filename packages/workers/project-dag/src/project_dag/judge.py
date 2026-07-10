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


def _parse_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        raise ValueError(f"no JSON object in LLM response: {text[:200]!r}")
    return json.loads(m.group(0))


class Judge:
    def __init__(self, llm: Any, store: Optional[Store] = None) -> None:
        self.llm = llm          # evidence_dag.llm.LLM protocol (chat())
        self.store = store

    def __call__(self, task_type: str, payload: dict, *, vote_seed: int = 0) -> dict:
        system = PROMPTS[task_type]
        user = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        key = hashlib.sha1(f"{task_type}|{vote_seed}|{user}".encode("utf-8")).hexdigest()
        if self.store is not None:
            cached = self.store.cache_get(key)
            if cached is not None:
                return json.loads(cached)
        if vote_seed:
            user += f'\n(vote {vote_seed})'
        raw = self.llm.chat(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.3 if vote_seed else 0.0)
        out = _parse_json(raw)
        if self.store is not None:
            self.store.cache_put(key, task_type, json.dumps(out, ensure_ascii=False))
        return out

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

    def __call__(self, task_type: str, payload: dict, *, vote_seed: int = 0) -> dict:
        self.calls.append((task_type, payload))
        h = self.handlers.get(task_type)
        if h is None:
            raise KeyError(f"StubJudge: no handler for {task_type}")
        return h(payload)

    def entity_votes(self, payload: dict, n: int = 3) -> tuple[bool, float]:
        out = self("entity_same", payload)
        return bool(out.get("same")), float(out.get("confidence", 0.0))
