"""Protein expert — amino-acid sequence to natural-language function description.

The table's preferred model is ProtT3 (ESM + Q-Former + Galactica), whose checkpoint
is gated and needs its custom repo. The strongest **open, sequence-only, to-text**
protein model that deploys cleanly is **Esm2Text-Base** (`habdine/Esm2Text-Base-v1-1`,
the sequence-only member of the Prot2Text family, arXiv 2405.something): an ESM-2
encoder + GPT decoder that *generates* a free-text description of a protein's function
from its sequence alone — no structure / AlphaFold / torch-geometric required (unlike
full Prot2Text). Its output is text. Translate-only: it describes function, it does
not solve the user's task.

Replaces the previous ESM-2 encoder expert (which only emitted perplexity numbers).
"""

from __future__ import annotations

import os
import re
import threading

import torch

EXPERT_ID = "esm2text-protein"
MODEL_ID = "habdine/Esm2Text-Base-v1-1 (Prot2Text family, sequence-only)"

AA_CHARS = set("ACDEFGHIKLMNPQRSTVWY")
# ESM-2 understands X (unknown residue); rarer ambiguity / non-standard codes are mapped to their
# closest standard residue so the sequence is preserved rather than silently corrupted by deletion
# (U=selenocysteine→C, O=pyrrolysine→K, B=Asx→N, Z=Glx→Q, J=Xle→L).
_AA_MAP = {"U": "C", "O": "K", "B": "N", "Z": "Q", "J": "L"}
_FASTA_HEADER_RE = re.compile(r"^>([^\n]*)", re.MULTILINE)


def _extract_sequence(raw: str) -> tuple[str, str | None]:
    header = None
    match = _FASTA_HEADER_RE.search(raw)
    if match:
        header = match.group(1).strip()
        body = raw[match.end():]
        # Multi-record FASTA: keep only the first record so two proteins are never concatenated.
        next_header = _FASTA_HEADER_RE.search(body)
        if next_header:
            body = body[: next_header.start()]
    else:
        body = raw
    out: list[str] = []
    for c in re.sub(r"[^A-Za-z]", "", body).upper():
        if c in AA_CHARS or c == "X":
            out.append(c)
        elif c in _AA_MAP:
            out.append(_AA_MAP[c])
        # else: a letter that is not any amino-acid code — drop it.
    return "".join(out), header


class ProteinExpert:
    def __init__(self, model_path: str | None = None, device: str = "cuda:0") -> None:
        self.device = device
        self.model_id = MODEL_ID
        self.model_path = model_path or os.environ.get("ESM2TEXT_MODEL_DIR", "/root/expert-models/esm2text-base")
        self._tokenizer = None
        self._model = None
        self._lock = threading.Lock()

    def _ensure(self) -> None:
        if self._model is not None:
            return
        with self._lock:
            if self._model is not None:
                return
            from transformers import AutoModelForCausalLM, AutoTokenizer

            self._tokenizer = AutoTokenizer.from_pretrained(self.model_path, trust_remote_code=True)
            self._model = (
                AutoModelForCausalLM.from_pretrained(self.model_path, trust_remote_code=True)
                .to(self.device)
                .eval()
            )

    @torch.inference_mode()
    def analyze(self, payload: str, instruction: str = "", system: str = "") -> str:
        seq, _header = _extract_sequence(payload)
        if len(seq) < 5:
            return "The input did not contain a recognisable amino-acid sequence."
        self._ensure()
        # Esm2Text reads the sequence and generates a free-text function description.
        description = self._model.generate_protein_description(
            protein_sequence=seq[:1021], tokenizer=self._tokenizer, device=self.device
        )
        return description.strip() or "The protein model did not return a description for this sequence."
