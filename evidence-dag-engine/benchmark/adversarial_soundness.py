"""Adversarial Provenance-Soundness benchmark — the RIGOROUS verifier eval.

Built directly on the methodology our literature review surfaced (see
EVAL_METHODOLOGY.md): the headline weakness of a similarity baseline is that it
keys on TOPIC, not on actual entailment, so we manufacture HARD NEGATIVES from
SciFact that are topically near-identical to a true support but do NOT entail:

  positive      claim + its gold SUPPORT rationale                  (label 1)
  same_topic    claim + NON-rationale sentences from the SAME paper (label 0, hard)
  scope         claim narrowed with a qualifier + its rationale     (label 0, hard)
  contrastive   negated/flipped claim + its rationale (VitaminC-ish)(label 0, hard)
  contradict    claim + a CONTRADICT rationale                      (label 0, easy)
  random        claim + an unrelated abstract                       (label 0, easy)

We score four methods — lexical Jaccard, TF-IDF cosine, BM25, NLI-judge — and
report ROC-AUC (threshold-free headline, à la TRUE), PR-AUC, F1 at a threshold
tuned on a held-out dev split, and (for the NLI ν) calibration ECE + Brier.
Numbers are reported on ALL pairs and on the HARD-NEGATIVE subset separately;
the verifier's win should widen on the hard subset where cosine collapses.

Usage: set EDAG_LLM_* env, then `python benchmark/adversarial_soundness.py --n 160`
"""
from __future__ import annotations

import argparse
import math
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
sys.path.insert(0, os.path.dirname(__file__))

from soundness_benchmark import cosine_scores, ensure_data, load_jsonl, roc_auc, tokenize  # noqa: E402

from evidence_dag.llm import OpenAICompatLLM  # noqa: E402
from evidence_dag.verifier import edge_nli  # noqa: E402

SCOPE_QUALIFIERS = [
    " only in pediatric patients", " exclusively in men over 65",
    " by more than 95%", " within the first hour of onset",
    " in the absence of any other treatment",
]
# antonym / negation flips for the contrastive (content-sensitivity) negatives
_FLIPS = [
    (r"\bincreases?\b", "does not increase"), (r"\bdecreases?\b", "does not decrease"),
    (r"\breduces?\b", "does not reduce"), (r"\bimproves?\b", "does not improve"),
    (r"\binhibits?\b", "does not inhibit"), (r"\bcauses?\b", "does not cause"),
    (r"\bis associated with\b", "is not associated with"),
    (r"\bare associated with\b", "are not associated with"),
    (r"\bis\b", "is not"), (r"\bare\b", "are not"), (r"\bwas\b", "was not"),
    (r"\bcan\b", "cannot"),
]


def negate(claim: str) -> tuple[str, bool]:
    for pat, repl in _FLIPS:
        new = re.sub(pat, repl, claim, count=1, flags=re.IGNORECASE)
        if new != claim:
            return new, True
    return claim, False


def build_pairs(data_dir: str, n: int, seed: int = 11) -> list[dict]:
    corpus = {d["doc_id"]: d for d in load_jsonl(os.path.join(data_dir, "corpus.jsonl"))}
    claims = load_jsonl(os.path.join(data_dir, "claims_dev.jsonl"))
    doc_ids = list(corpus.keys())
    pairs: list[dict] = []

    def add(premise, claim, label, kind):
        if premise and premise.strip():
            pairs.append({"premise": premise, "claim": claim, "label": label, "kind": kind})

    for i, c in enumerate(claims):
        evidence = c.get("evidence") or {}
        if not evidence:
            continue
        claim = c["claim"]
        for doc_id, rationales in evidence.items():
            doc = corpus.get(int(doc_id)) or corpus.get(doc_id) or {}
            ab = doc.get("abstract", [])
            if not ab:
                continue
            rat_idx = {s for r in rationales for s in r["sentences"]}
            for r in rationales:
                sents = " ".join(ab[s] for s in r["sentences"] if s < len(ab))
                if not sents:
                    continue
                if r["label"] == "SUPPORT":
                    add(sents, claim, 1, "positive")
                    # scope: narrow the claim -> rationale no longer entails it
                    add(sents, claim.rstrip(". ") + SCOPE_QUALIFIERS[i % len(SCOPE_QUALIFIERS)] + ".", 0, "scope")
                    # contrastive: flip the claim's polarity (topic identical)
                    neg, ok = negate(claim)
                    if ok:
                        add(sents, neg, 0, "contrastive")
                else:  # CONTRADICT
                    add(sents, claim, 0, "contradict")
            # same-topic hard negative: non-rationale sentences from the SAME paper
            non_rat = [ab[j] for j in range(len(ab)) if j not in rat_idx]
            if non_rat:
                add(" ".join(non_rat[:2]), claim, 0, "same_topic")
        # one easy random negative
        other = corpus[doc_ids[(i * 2654435761 + seed) % len(doc_ids)]]
        if other.get("abstract"):
            add(" ".join(other["abstract"][:3]), claim, 0, "random")
        if len(pairs) >= n:
            break
    return pairs[:n]


# --- baselines --------------------------------------------------------------
def jaccard_scores(pairs: list[dict]) -> list[float]:
    out = []
    for p in pairs:
        a, b = set(tokenize(p["premise"])), set(tokenize(p["claim"]))
        out.append(len(a & b) / len(a | b) if (a | b) else 0.0)
    return out


def bm25_scores(pairs: list[dict], k1: float = 1.5, b: float = 0.75) -> list[float]:
    docs = [tokenize(p["premise"]) for p in pairs]
    queries = [tokenize(p["claim"]) for p in pairs]
    n = len(docs)
    df: dict[str, int] = {}
    for d in docs:
        for t in set(d):
            df[t] = df.get(t, 0) + 1
    idf = {t: math.log(1 + (n - c + 0.5) / (c + 0.5)) for t, c in df.items()}
    avgdl = (sum(len(d) for d in docs) / n) if n else 0.0
    out = []
    for d, q in zip(docs, queries):
        tf: dict[str, int] = {}
        for t in d:
            tf[t] = tf.get(t, 0) + 1
        dl = len(d) or 1
        score = 0.0
        for t in set(q):
            if t in tf:
                f = tf[t]
                score += idf.get(t, 0.0) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * dl / (avgdl or 1)))
        out.append(score)
    # normalise to [0,1] for fair thresholding/calibration display
    mx = max(out) or 1.0
    return [s / mx for s in out]


# --- metrics ----------------------------------------------------------------
def average_precision(labels: list[int], scores: list[float]) -> float:
    order = sorted(range(len(scores)), key=lambda i: -scores[i])
    tp = 0
    total_pos = sum(labels)
    if total_pos == 0:
        return float("nan")
    ap = 0.0
    for k, i in enumerate(order, 1):
        if labels[i] == 1:
            tp += 1
            ap += tp / k
    return ap / total_pos


def best_f1_threshold(labels: list[int], scores: list[float]) -> float:
    cands = sorted(set(scores))
    best_t, best_f1 = 0.5, -1.0
    for t in cands:
        f1 = f1_at(t, labels, scores)
        if f1 > best_f1:
            best_f1, best_t = f1, t
    return best_t


def f1_at(t: float, labels: list[int], scores: list[float]) -> float:
    tp = sum(1 for l, s in zip(labels, scores) if s >= t and l == 1)
    fp = sum(1 for l, s in zip(labels, scores) if s >= t and l == 0)
    fn = sum(1 for l, s in zip(labels, scores) if s < t and l == 1)
    prec = tp / (tp + fp) if (tp + fp) else 0.0
    rec = tp / (tp + fn) if (tp + fn) else 0.0
    return 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0


def ece(labels: list[int], probs: list[float], bins: int = 10) -> float:
    n = len(labels)
    if n == 0:
        return float("nan")
    total = 0.0
    for k in range(bins):
        lo, hi = k / bins, (k + 1) / bins
        idx = [i for i, p in enumerate(probs) if (p > lo or (k == 0 and p == 0)) and p <= hi]
        if not idx:
            continue
        conf = sum(probs[i] for i in idx) / len(idx)
        acc = sum(labels[i] for i in idx) / len(idx)
        total += (len(idx) / n) * abs(conf - acc)
    return total


def brier(labels: list[int], probs: list[float]) -> float:
    return sum((p - l) ** 2 for l, p in zip(labels, probs)) / len(labels) if labels else float("nan")


def evaluate(name: str, labels, scores, dev_idx, test_idx, *, is_prob=False) -> dict:
    t = best_f1_threshold([labels[i] for i in dev_idx], [scores[i] for i in dev_idx])
    test_labels = [labels[i] for i in test_idx]
    test_scores = [scores[i] for i in test_idx]
    row = {
        "method": name,
        "roc_auc": round(roc_auc(test_labels, test_scores), 3),
        "pr_auc": round(average_precision(test_labels, test_scores), 3),
        "f1@dev_thr": round(f1_at(t, test_labels, test_scores), 3),
    }
    if is_prob:
        row["ece"] = round(ece(test_labels, test_scores), 3)
        row["brier"] = round(brier(test_labels, test_scores), 3)
    return row


def fmt(rows: list[dict]) -> str:
    cols = ["method", "roc_auc", "pr_auc", "f1@dev_thr", "ece", "brier"]
    head = "  ".join(f"{c:>10}" for c in cols)
    lines = [head]
    for r in rows:
        lines.append("  ".join(f"{str(r.get(c, '-')):>10}" for c in cols))
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=160)
    args = ap.parse_args()

    data_dir = ensure_data()
    pairs = build_pairs(data_dir, args.n)
    kinds: dict[str, int] = {}
    for p in pairs:
        kinds[p["kind"]] = kinds.get(p["kind"], 0) + 1
    print(f"built {len(pairs)} pairs: {kinds}")

    labels = [p["label"] for p in pairs]
    scorers = {
        "jaccard": jaccard_scores(pairs),
        "cosine": cosine_scores(pairs),
        "bm25": bm25_scores(pairs),
    }
    llm = OpenAICompatLLM()
    print(f"scoring NLI-judge via {llm.model} over {len(pairs)} pairs ...")
    scorers["nli"] = [edge_nli(llm, p["premise"], p["claim"]) for p in pairs]

    # deterministic 50/50 dev/test split (even/odd) — threshold tuned on dev only
    dev_idx = [i for i in range(len(pairs)) if i % 2 == 0]
    test_idx = [i for i in range(len(pairs)) if i % 2 == 1]

    def rows_for(sel_idx):
        d = [i for i in dev_idx if i in set(sel_idx)]
        t = [i for i in test_idx if i in set(sel_idx)]
        return [evaluate(name, labels, sc, d, t, is_prob=(name in ("nli", "cosine", "bm25", "jaccard")))
                for name, sc in scorers.items()]

    all_rows = rows_for(list(range(len(pairs))))
    hard_kinds = {"positive", "same_topic", "scope", "contrastive"}
    hard_sel = [i for i, p in enumerate(pairs) if p["kind"] in hard_kinds]
    hard_rows = rows_for(hard_sel)

    print("\n== ALL pairs (test split) ==")
    print(fmt(all_rows))
    print("\n== HARD-NEGATIVE subset (positive vs same_topic/scope/contrastive) ==")
    print(fmt(hard_rows))

    nli_all = next(r for r in all_rows if r["method"] == "nli")
    cos_all = next(r for r in all_rows if r["method"] == "cosine")
    nli_hard = next(r for r in hard_rows if r["method"] == "nli")
    cos_hard = next(r for r in hard_rows if r["method"] == "cosine")
    print("\n== VERDICT ==")
    print(f"  ALL : NLI roc_auc {nli_all['roc_auc']} vs cosine {cos_all['roc_auc']}  "
          f"-> {'PASS' if nli_all['roc_auc'] > cos_all['roc_auc'] else 'FAIL'}")
    print(f"  HARD: NLI roc_auc {nli_hard['roc_auc']} vs cosine {cos_hard['roc_auc']}  "
          f"-> {'PASS' if nli_hard['roc_auc'] > cos_hard['roc_auc'] else 'FAIL'}  "
          f"(gap widens by {round((nli_hard['roc_auc']-cos_hard['roc_auc'])-(nli_all['roc_auc']-cos_all['roc_auc']),3):+})")

    import json
    out = {"n": len(pairs), "kinds": kinds, "all": all_rows, "hard": hard_rows}
    os.makedirs(os.path.join(os.path.dirname(__file__), "..", "out"), exist_ok=True)
    with open(os.path.join(os.path.dirname(__file__), "..", "out", "adversarial_soundness.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
