"""Molecule expert — SMILES to natural-language caption.

The strongest **open, to-text** molecule captioner that deploys cleanly is **BioT5+**
(`QizhiPei/biot5-plus-base-chebi20`, ACL 2024 Findings): a T5 fine-tuned on the
ChEBI-20 captioning task. It is the molecule-captioning SOTA among open checkpoints
and clearly supersedes the previous MolT5-Large expert. BioT5 represents a molecule as
a **SELFIES** string (not raw SMILES), wrapped in `<bom>…<eom>` and prefixed with a
fixed task definition; the decoder then *generates* a free-text description. Its output
is text; it runs as a plain `transformers` seq2seq model. Translate-only — it describes,
it never solves a task.

We convert the input SMILES -> SELFIES with the `selfies` library (BioT5's expected
input form), build BioT5's exact captioning prompt, and return the model's own text.

Replaces the previous MolT5-Large expert.
"""

from __future__ import annotations

import os
import re

import selfies as sf

from ._base import LazySeq2SeqLM

EXPERT_ID = "biot5-molecule"
MODEL_ID = "QizhiPei/biot5-plus-base-chebi20"

# BioT5's fixed molecule-captioning instruction (must match training format verbatim).
_TASK_DEFINITION = (
    "Definition: You are given a molecule SELFIES. Your job is to generate the molecule "
    "description in English that fits the molecule SELFIES.\n\n"
)

_ORGANIC = set("BCNOPSFIbcnops")


def _extract_smiles(payload: str) -> str | None:
    for raw in payload.splitlines():
        line = re.sub(r"(?i)^\s*smiles\s*[:=]\s*", "", raw.strip())
        if not line or line.startswith(("#", ">", "//")):
            continue
        token = line.split()[0] if line.split() else ""
        if len(token) >= 2 and re.search(r"[A-Za-z]", token) and any(
            c in _ORGANIC or c in "()[]=#@+-./\\1234567890" for c in token
        ):
            return token
    return None


def _build_prompt(selfies_str: str) -> str:
    # Mirrors BioT5's inference format: task definition + <bom>SELFIES<eom> + "Output: ".
    return f"{_TASK_DEFINITION}Now complete the following example -\nInput: <bom>{selfies_str}<eom>\nOutput: "


class MoleculeExpert:
    def __init__(self, model_path: str | None = None, device: str = "cuda:0") -> None:
        self.device = device
        self.model_id = MODEL_ID
        path = model_path or os.environ.get("BIOT5_MODEL_DIR", "/root/expert-models/biot5-plus-base-chebi20")
        self._lm = LazySeq2SeqLM(path, device=device)

    def analyze(self, payload: str, instruction: str = "", system: str = "") -> str:
        smiles = _extract_smiles(payload)
        if not smiles:
            return "No SMILES string was found in the input."
        try:
            selfies_str = sf.encoder(smiles)
        except Exception:
            return (
                f"Could not convert SMILES {smiles!r} to SELFIES; BioT5+ requires a chemically "
                "valid molecule. No description was generated."
            )
        caption = self._lm.generate_text(_build_prompt(selfies_str), max_new_tokens=256, num_beams=5)
        return caption.strip() or "The molecule model did not return a description for this SMILES."
