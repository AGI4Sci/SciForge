"""Curated showcase project: exercises EVERY node type and DAG feature the
图谱 view can render, fully offline (deterministic StubJudge, no LLM).

Theme: LLM hallucination research — small (8 alive claims) but每个功能都有展位:
  * 5 subtopic groups (sessions), entity-derived labels
  * a claim independently confirmed by TWO sessions  -> ×2 badge, 2 evidence, supported
  * a 3-deep derived chain inside one group          -> nested claim tree (L3/L4)
  * a cross-group derived_from edge                  -> purple arrow between groups
  * an evenly-matched contradiction                  -> both ⚠, red dashed edge
                                                        between two collapsed group cards
  * one benchmark report as the SOLE evidence of two -> shared evidence ×2 + ⚡2
    claims                                              (dominator load-bearing)
  * single-source claims                             -> fragile amber rings
(`invalidated` never shows in the alive graph by design.)

Usage:  python samples/seed_showcase.py <db_path> <session_dir>
"""
from __future__ import annotations

import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import project_dag  # noqa: F401  (sys.path side effect for evidence_dag)
from evidence_dag import provjson
from evidence_dag.graph import ThreadGraph
from evidence_dag.model import EdgeRel, NodeStatus, NodeType

from project_dag.judge import StubJudge
from project_dag.reconcile import full_reconcile
from project_dag.service import Engine

GOAL_TITLE = "理解并降低大语言模型的幻觉率"

ENTITY_RULES = [                      # keyword -> canonical entity (group labels)
    ("幻觉", "幻觉率"), ("低频事实", "训练数据"), ("微调", "指令微调"),
    ("奖励模型", "指令微调"), ("检索增强", "RAG"), ("RAG", "RAG"),
    ("TruthfulQA", "TruthfulQA"), ("真实性", "TruthfulQA"),
    ("规模", "模型规模"), ("长尾", "模型规模"),
]


def _norm(s: str) -> str:
    return " ".join((s or "").lower().split())


def make_judge() -> StubJudge:
    def distill(p):
        goals = p.get("active_goals") or []
        ents = sorted({canon for kw, canon in ENTITY_RULES if kw in p["claim"]})
        return {"statement": p["claim"], "claim_type": "finding",
                "mentioned_entities": ents,
                "addresses_goal": goals[0]["id"] if goals else "none",
                "source_node_ids": [n["id"] for n in p["subgraph"]["nodes"]],
                "confidence": 0.9}

    def entity_same(p):
        return {"same": _norm(p["name"]) == _norm(p["candidate"]), "confidence": 0.95}

    def claim_equiv(p):
        strip = lambda s: _norm(s).replace("(replicated) ", "")
        new = strip(p["new"])
        for c in p["pool"]:
            if strip(c["statement"]) == new:
                return {"relation": "equivalent", "target": c["id"], "confidence": 0.95}
        return {"relation": "new", "target": None, "confidence": 0.9}

    def contradiction(p):
        a, b = _norm(p["a"]), _norm(p["b"])
        scaling = ("规模" in a) and ("规模" in b)
        opposed = ("降低" in a and "反升" in b) or ("反升" in a and "降低" in b)
        return {"contradicts": scaling and opposed, "confidence": 0.9}

    return StubJudge({"distill": distill, "entity_same": entity_same,
                      "claim_equiv": claim_equiv, "contradiction": contradiction})


def write_session(session_dir: str, sid: str, rows: list[tuple[str, str, str]]) -> None:
    g = ThreadGraph(sid)
    for claim_text, source_text, cred in rows:
        s = g.add_or_get_node(NodeType.SOURCE, source_text, credibility=cred)
        c = g.add_or_get_node(NodeType.CLAIM, claim_text)
        c.status = NodeStatus.SUPPORTED
        g.add_edge(s.id, c.id, EdgeRel.SUPPORTS, nli_score=0.9)
    safe = re.sub(r'[/\\:<>"|?*]', "_", sid)
    with open(os.path.join(session_dir, f"{safe}.prov.json"), "w", encoding="utf-8") as fh:
        fh.write(provjson.dumps(g))


TRUTHFULQA = "TruthfulQA 基准技术报告：817 个对抗性问题上的真实性评测"

SESSIONS = [
    ("topic-causes", [
        ("模型幻觉率与训练数据中低频事实的占比正相关",
         "Kalai & Vempala 理论分析：校准良好的模型必然以不低于单次出现事实占比的下限幻觉", "high"),
        ("指令微调会放大模型的过度自信，让幻觉以确定口吻表述",
         "RLHF 行为分析：微调后模型在错误回答上的置信度显著上升", "medium"),
        ("奖励模型偏好流畅完整的回答，间接惩罚了「我不知道」",
         "小规模消融实验（n=3 模型）：移除流畅度奖励后拒答率回升", "low"),
    ]),
    # 文件名排序决定编译顺序（'2' > '.'）：原始 claim 先入库，复现合并进去
    # -> 干净表述 + ×2 徽标 + 双证据 -> supported
    ("topic-causes2", [
        ("(replicated) 模型幻觉率与训练数据中低频事实的占比正相关",
         "独立复现：在开源语料上重现了低频事实占比与幻觉率的相关性", "high"),
    ]),
    ("topic-mitigation", [
        ("检索增强生成（RAG）可显著降低事实型问答的幻觉率",
         "RAG 系统评测论文：事实型 QA 幻觉率相对下降约 40%", "high"),
    ]),
    ("topic-benchmark", [
        # 两条 claim 共享同一份报告作唯一证据 -> ×2 共享 + ⚡2 承重 + 双 fragile
        ("TruthfulQA 上模型规模与真实性得分并非单调正相关", TRUTHFULQA, "medium"),
        ("多数开源模型在对抗性问题上的真实性得分低于 50%", TRUTHFULQA, "medium"),
    ]),
    ("topic-scaling-pro", [
        ("扩大模型规模能持续降低幻觉率",
         "内部扩展实验：7B→70B 幻觉率单调下降", "medium"),
    ]),
    ("topic-scaling-con", [
        ("规模扩大后长尾知识上的幻觉率不降反升",
         "长尾知识评测：参数量增大时低频实体问答错误率上升", "medium"),
    ]),
]


def main() -> None:
    db = sys.argv[1] if len(sys.argv) > 1 else "./showcase-project.db"
    threads = sys.argv[2] if len(sys.argv) > 2 else "./showcase-threads"
    os.makedirs(threads, exist_ok=True)
    for fn in os.listdir(threads):
        if fn.endswith(".prov.json"):
            os.remove(os.path.join(threads, fn))
    for ext in ("", "-wal", "-shm"):
        if os.path.exists(db + ext):
            os.remove(db + ext)

    for sid, rows in SESSIONS:
        write_session(threads, sid, rows)

    e = Engine(db, threads, judge=make_judge())
    e.create_goal(GOAL_TITLE, description="按成因 / 缓解 / 评测子课题拆解，跨 session 汇总证据链。")
    r = e.compile()
    st = e.store

    def claim_id(like: str) -> str:
        row = st.q1("SELECT id FROM claim WHERE statement LIKE ? AND t_invalid IS NULL",
                    (f"%{like}%",))
        assert row, f"claim not found: {like}"
        return row["id"]

    cause = claim_id("低频事实的占比正相关")
    tuning = claim_id("指令微调会放大")
    reward = claim_id("奖励模型偏好")
    rag = claim_id("检索增强生成")

    # 组内 3 层派生链：成因 ← 指令微调 ← 奖励模型
    st.add_edge(tuning, cause, "derived_from", meta={"via": "showcase"})
    st.add_edge(reward, tuning, "derived_from", meta={"via": "showcase"})
    # 跨组派生（紫色指向）：RAG 缓解结论 derived_from 成因结论
    st.add_edge(rag, cause, "derived_from", meta={"via": "showcase"})

    st.conn.commit()
    full_reconcile(st)

    g = e.graph()
    stats = r["stats"]
    by = {}
    for c in g["claims"]:
        by[c["status"]] = by.get(c["status"], 0) + 1
    print(f"[showcase] {stats['sessions_compiled']} sessions -> {len(g['claims'])} claims / "
          f"{len(g['evidence'])} evidence / {len(g['edges'])} edges; "
          f"merged={stats['claims_merged']} conflicts={stats['conflicts']}; statuses={by}")
    e.store.close()


if __name__ == "__main__":
    main()
