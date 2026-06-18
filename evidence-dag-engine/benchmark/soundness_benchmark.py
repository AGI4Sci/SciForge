"""Provenance Soundness benchmark (Gate 1B core 门槛).

Question: does the NLI-judge that fills ν on supports edges separate
TRUE support from non-support better than a cosine-similarity baseline?

Data: SciFact (Wadden et al. 2020), a real public scientific claim-verification
benchmark with gold rationales. We build (premise, claim, label) pairs where
  label=1  the cited rationale SUPPORTS the claim   (ν should be high)
  label=0  the rationale CONTRADICTS the claim, or a random unrelated abstract
We score every pair with (a) the NLI-judge and (b) TF-IDF cosine, and compare
ROC-AUC. The Gate passes when NLI-AUC > cosine-AUC on the held-out set.

Usage (PowerShell): set EDAG_LLM_* env, then `python benchmark/soundness_benchmark.py --n 50`
"""
from __future__ import annotations

import argparse
import io
import json
import math
import os
import re
import sys
import tarfile
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from evidence_dag.llm import OpenAICompatLLM  # noqa: E402
from evidence_dag.verifier import edge_nli  # noqa: E402

DATA_URL = "https://scifact.s3-us-west-2.amazonaws.com/release/latest/data.tar.gz"
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
_TOKEN = re.compile(r"[a-z0-9]+")
_STOP = set("the a an of to in is are and or for on with that this we our by as be it at from".split())


def ensure_data() -> str:
    marker = os.path.join(DATA_DIR, "data", "corpus.jsonl")
    if os.path.exists(marker):
        return os.path.dirname(marker)
    os.makedirs(DATA_DIR, exist_ok=True)
    print(f"downloading SciFact from {DATA_URL} ...")
    raw = urllib.request.urlopen(DATA_URL, timeout=120).read()
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tar:
        tar.extractall(DATA_DIR)
    return os.path.dirname(marker)


def load_jsonl(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def build_pairs(data_dir: str, n: int, seed: int = 7) -> list[dict]:
    corpus = {d["doc_id"]: d for d in load_jsonl(os.path.join(data_dir, "corpus.jsonl"))}
    claims = load_jsonl(os.path.join(data_dir, "claims_dev.jsonl"))
    doc_ids = list(corpus.keys())
    pairs: list[dict] = []
    # deterministic pseudo-random pick of a "random unrelated" doc, seed-mixed
    def rnd_doc(i: int) -> dict:
        return corpus[doc_ids[(i * 2654435761 + seed) % len(doc_ids)]]

    for i, c in enumerate(claims):
        evidence = c.get("evidence") or {}
        if not evidence:
            continue
        for doc_id, rationales in evidence.items():
            doc = corpus.get(int(doc_id)) or corpus.get(doc_id) or {}
            ab = doc.get("abstract", [])
            if not ab:
                continue
            for r in rationales:
                sents = " ".join(ab[s] for s in r["sentences"] if s < len(ab))
                if not sents:
                    continue
                pairs.append({"premise": sents, "claim": c["claim"],
                              "label": 1 if r["label"] == "SUPPORT" else 0,
                              "kind": "support" if r["label"] == "SUPPORT" else "contradict"})
            # one random-unrelated negative per claim
            other = rnd_doc(i)
            if other.get("abstract"):
                pairs.append({"premise": " ".join(other["abstract"][:3]), "claim": c["claim"],
                              "label": 0, "kind": "random"})
        if len(pairs) >= n:
            break
    return pairs[:n]


# --- TF-IDF cosine baseline (stdlib) ----------------------------------------
def tokenize(text: str) -> list[str]:
    return [t for t in _TOKEN.findall(text.lower()) if t not in _STOP]


def cosine_scores(pairs: list[dict]) -> list[float]:
    docs = [tokenize(p["premise"]) + tokenize(p["claim"]) for p in pairs]
    df: dict[str, int] = {}
    for toks in docs:
        for t in set(toks):
            df[t] = df.get(t, 0) + 1
    n = len(docs)
    idf = {t: math.log((n + 1) / (c + 1)) + 1 for t, c in df.items()}

    def vec(toks: list[str]) -> dict[str, float]:
        tf: dict[str, float] = {}
        for t in toks:
            tf[t] = tf.get(t, 0) + 1
        return {t: (f / len(toks)) * idf.get(t, 0.0) for t, f in tf.items()} if toks else {}

    out = []
    for p in pairs:
        a, b = vec(tokenize(p["premise"])), vec(tokenize(p["claim"]))
        dot = sum(a[t] * b.get(t, 0.0) for t in a)
        na = math.sqrt(sum(v * v for v in a.values()))
        nb = math.sqrt(sum(v * v for v in b.values()))
        out.append(dot / (na * nb) if na and nb else 0.0)
    return out


# --- ROC-AUC (stdlib, rank method) ------------------------------------------
def roc_auc(labels: list[int], scores: list[float]) -> float:
    order = sorted(range(len(scores)), key=lambda i: scores[i])
    ranks = [0.0] * len(scores)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and scores[order[j + 1]] == scores[order[i]]:
            j += 1
        avg = (i + j) / 2.0 + 1.0
        for k in range(i, j + 1):
            ranks[order[k]] = avg
        i = j + 1
    pos = [r for r, l in zip(ranks, labels) if l == 1]
    n_pos, n_neg = len(pos), labels.count(0)
    if n_pos == 0 or n_neg == 0:
        return float("nan")
    return (sum(pos) - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=50, help="number of pairs")
    args = ap.parse_args()

    data_dir = ensure_data()
    pairs = build_pairs(data_dir, args.n)
    pos = sum(p["label"] for p in pairs)
    print(f"built {len(pairs)} pairs ({pos} support / {len(pairs) - pos} non-support)")

    cos = cosine_scores(pairs)
    llm = OpenAICompatLLM()
    print(f"scoring NLI-judge via {llm.model} ...")
    nli = [edge_nli(llm, p["premise"], p["claim"]) for p in pairs]

    labels = [p["label"] for p in pairs]
    auc_cos = roc_auc(labels, cos)
    auc_nli = roc_auc(labels, nli)
    print("\n== Provenance Soundness: separating SUPPORT from non-support ==")
    print(f"  cosine-baseline ROC-AUC : {auc_cos:.3f}")
    print(f"  NLI-judge       ROC-AUC : {auc_nli:.3f}")
    verdict = "PASS" if auc_nli > auc_cos else "FAIL"
    print(f"  Gate 1B (NLI > cosine)  : {verdict}  (Δ={auc_nli - auc_cos:+.3f})")

    out = {"n": len(pairs), "support": pos, "auc_cosine": auc_cos, "auc_nli": auc_nli,
           "delta": auc_nli - auc_cos, "verdict": verdict, "model": llm.model}
    os.makedirs(os.path.join(os.path.dirname(__file__), "..", "out"), exist_ok=True)
    with open(os.path.join(os.path.dirname(__file__), "..", "out", "soundness.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
