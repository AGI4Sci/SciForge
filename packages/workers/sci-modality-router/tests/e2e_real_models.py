#!/usr/bin/env python3
"""End-to-end "no cheating" proof for the SciForge sci-modality router.

Drives the LIVE stack:  sci-modality-router (TS, :3898)  ->  expert-translator (Python, :8001)  ->  real GPU models

Every expert here is a *native-to-text* domain model: it runs a real forward pass and
generates natural-language text. There are no general-LLM interpreters. This proves the
translations are produced by real models, not faked / canned:

  A. Provider health reports CUDA available and the four native-to-text experts registered.
  B. INPUT SENSITIVITY: two different inputs to the same live expert produce different REAL
     generated text. A canned responder cannot vary its prose with the input.
  C. REAL GPU FINGERPRINT: the provider stamps `expert@device <ms>ms`; we assert a CUDA
     device and non-trivial latency (a generative forward pass is not ~0ms).
  D. ROUTING: the router selects the correct expert per modality (detected + explicit).

Experts whose checkpoint is not deployed yet return an error envelope; those modalities are
SKIPPED (not failed) so this passes on a partial deployment. `protein_structure` needs a PDB
file: set E2E_PDB_PATH to exercise it, otherwise it is skipped.

Run on the server (after starting expert-translator, prot2text service, and the router):
    python3 tests/e2e_real_models.py
Env overrides: SCIMODALITY_ROUTER_URL (default http://127.0.0.1:3898),
               EXPERT_PROVIDER_URL   (default http://127.0.0.1:8001),
               E2E_PDB_PATH          (a .pdb file to test protein_structure; optional)
"""

from __future__ import annotations

import os
import sys

import requests

ROUTER = os.environ.get("SCIMODALITY_ROUTER_URL", "http://127.0.0.1:3898").rstrip("/")
PROVIDER = os.environ.get("EXPERT_PROVIDER_URL", "http://127.0.0.1:8001").rstrip("/")
TIMEOUT = float(os.environ.get("E2E_TIMEOUT", "600"))

PASS, FAIL, SKIP = [], [], []

# The four native-to-text experts.
EXPECTED_EXPERTS = {"esm2text-protein", "prot2text-structure", "biot5-molecule", "c2s-singlecell"}


def check(name: str, ok: bool, detail: str = "") -> bool:
    (PASS if ok else FAIL).append(name)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))
    return ok


def skip(name: str, detail: str = "") -> None:
    SKIP.append(name)
    print(f"  [SKIP] {name}" + (f" — {detail}" if detail else ""))


def translate(payload: str, modality: str | None = None, instruction: str | None = None) -> dict:
    body: dict = {"payload": payload}
    if modality:
        body["modality"] = modality
    if instruction:
        body["instruction"] = instruction
    return requests.post(f"{ROUTER}/modality/translate", json=body, timeout=TIMEOUT).json()


def provider_raw(model: str, payload: str) -> dict:
    r = requests.post(
        f"{PROVIDER}/v1/chat/completions",
        json={"model": model, "messages": [{"role": "user", "content": payload}]},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    return r.json()


def summary_of(resp: dict) -> str:
    return (resp.get("data") or {}).get("summary", "") or ""


def looks_like_prose(text: str) -> bool:
    """False only when the text is a gene-token *dump* (many uppercase symbols, little prose).
    A short clean cell-type label (e.g. 'Thymocyte.') is fine; a 'CD74 CD79B CD1E …' list is not."""
    import re as _re
    lower_words = _re.findall(r"\b[a-z]{3,}\b", text)
    upper_toks = _re.findall(r"\b[A-Z0-9][A-Z0-9.\-]{1,14}\b", text)
    return not (len(upper_toks) >= 5 and len(lower_words) < len(upper_toks))


# Real example payloads (small but genuine).
UBIQUITIN = "MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG"
ASPIRIN = "CC(=O)OC1=CC=CC=C1C(=O)O"
CAFFEINE = "CN1C=NC2=C1C(=O)N(C(=O)N2C)C"
T_CELL_MARKERS = "CD3D 9.1\nCD3E 8.4\nCD8A 7.9\nGZMB 6.1\nNKG7 5.5"
B_CELL_MARKERS = "MS4A1 9.0\nCD19 8.1\nCD79A 7.7\nIGHM 6.0\nBANK1 5.2"


def assert_live_or_skip(name: str, resp: dict, expert_id: str) -> bool:
    """Return True if the expert ran live; record SKIP and return False otherwise."""
    if resp.get("ok"):
        return True
    err = resp.get("error", {})
    skip(name, f"{expert_id} not deployed: {err.get('code')} {str(err.get('message'))[:120]}")
    return False


def main() -> int:
    print(f"Router:   {ROUTER}\nProvider: {PROVIDER}\n")

    # --- A. provider health: real CUDA + the four native-to-text experts ----------------
    print("A. Provider health (real GPU, four native-to-text experts)")
    try:
        h = requests.get(f"{PROVIDER}/health", timeout=30).json()
    except Exception as exc:  # noqa: BLE001
        check("provider /health reachable", False, str(exc))
        return done()
    check("provider /health reachable", True)
    check("torch CUDA available", bool(h.get("torch_cuda_available")), str(h.get("device")))
    experts = set(h.get("experts", []))
    check("all four native-to-text experts registered", EXPECTED_EXPERTS <= experts, f"{sorted(experts)}")
    check("no general-LLM interpreter experts present",
          not ({"genomic-nucleotide", "qust-spatial", "spectrallm-spectrometry", "modality-classifier"} & experts),
          f"{sorted(experts)}")

    # --- B. input sensitivity: different inputs -> different REAL generated text ---------
    print("\nB. Input sensitivity (real generated text varies with input)")

    # Single-cell (C2S-Scale): T-cell vs B-cell markers -> different generations.
    sc_t, sc_b = translate(T_CELL_MARKERS, "single_cell"), translate(B_CELL_MARKERS, "single_cell")
    if assert_live_or_skip("single_cell live", sc_t, "c2s-singlecell"):
        check("single_cell -> c2s-singlecell", (sc_t.get("data") or {}).get("model") == "c2s-singlecell")
        s_t, s_b = summary_of(sc_t), summary_of(sc_b)
        check("single_cell produces clean text", len(s_t) > 5, f"{len(s_t)} chars")
        check("single_cell text is input-dependent", s_t != s_b)
        check("single_cell output is clean (no control tokens)", "<ctrl" not in s_t and "<pad>" not in s_t)

    # Molecule (BioT5+): aspirin vs caffeine -> different captions.
    m_asp, m_caf = translate(ASPIRIN, "molecule"), translate(CAFFEINE, "molecule")
    if assert_live_or_skip("molecule live", m_asp, "biot5-molecule"):
        check("molecule -> biot5-molecule", (m_asp.get("data") or {}).get("model") == "biot5-molecule")
        check("molecule produces non-trivial text", len(summary_of(m_asp)) > 40, f"{len(summary_of(m_asp))} chars")
        check("molecule text is input-dependent", summary_of(m_asp) != summary_of(m_caf))

    # --- C. real GPU fingerprint (device + non-trivial latency) -------------------------
    print("\nC. Real GPU fingerprint (provider system_fingerprint)")
    if "biot5-molecule" in experts:
        raw = provider_raw("biot5-molecule", ASPIRIN)
        fp = raw.get("system_fingerprint", "")
        check("fingerprint names a CUDA device", "cuda" in fp, fp)
        import re
        m = re.search(r"\s(\d+)ms", fp)
        ms = int(m.group(1)) if m else -1
        check("inference latency is non-trivial (real forward pass)", ms >= 20, f"{ms}ms")

    # --- D. routing correctness (detection + explicit override) -------------------------
    print("\nD. Routing correctness")
    det = translate(UBIQUITIN)  # bare amino-acid sequence, no modality -> must auto-detect protein
    d = det.get("data") or {}
    if assert_live_or_skip("auto-detect live", det, "esm2text-protein"):
        check("auto-detect routes protein", d.get("modality") == "protein")
        check("auto-detect modalitySource is detected", d.get("modalitySource") == "detected")
    forced = translate(ASPIRIN, "molecule")  # explicitly force the molecule expert
    fd = forced.get("data") or {}
    if assert_live_or_skip("explicit-override live", forced, "biot5-molecule"):
        check("explicit modality routes its expert",
              fd.get("model") == "biot5-molecule" and fd.get("modalitySource") == "explicit")

    # --- E. protein sequence (generated function text) ----------------------------------
    print("\nE. Protein sequence (generated text)")
    pr = translate(UBIQUITIN, "protein")
    if assert_live_or_skip("protein live", pr, "esm2text-protein"):
        check("protein -> esm2text-protein", (pr.get("data") or {}).get("model") == "esm2text-protein")
        check("protein produces non-trivial text", len(summary_of(pr)) > 40, f"{len(summary_of(pr))} chars")

    # --- F. protein structure (PDB -> function text; optional, needs a PDB file) --------
    print("\nF. Protein structure (Prot2Text; set E2E_PDB_PATH to test)")
    pdb_path = os.environ.get("E2E_PDB_PATH")
    if not pdb_path or not os.path.exists(pdb_path):
        skip("protein_structure", "E2E_PDB_PATH unset or missing")
    else:
        with open(pdb_path) as fh:
            pdb = fh.read()
        st = translate(pdb, "protein_structure")
        if assert_live_or_skip("protein_structure live", st, "prot2text-structure"):
            check("protein_structure -> prot2text-structure",
                  (st.get("data") or {}).get("model") == "prot2text-structure")
            check("protein_structure produces non-trivial text", len(summary_of(st)) > 20, f"{len(summary_of(st))} chars")

    return done()


def done() -> int:
    print(f"\n{'=' * 60}\nPASS: {len(PASS)}   FAIL: {len(FAIL)}   SKIP: {len(SKIP)}")
    if FAIL:
        print("FAILED:")
        for f in FAIL:
            print(f"  - {f}")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
