"""Single-cell expert backed by C2S-Scale (Cell2Sentence-Scale, Gemma-2).

C2S-Scale (`vandijklab/C2S-Scale-Gemma-2-2B`, GitHub vandijklab/cell2sentence) turns
single-cell RNA-seq into text. The Cell2Sentence representation expresses a cell as a
"cell sentence": its gene symbols listed in descending order of expression. That
sentence is fed to a Gemma-2 model fine-tuned on cell sentences, which *generates*
natural-language output (cell-type identification, description). We build the cell
sentence deterministically from the input, then run a real forward pass and return
the model's own text. Translate-only — it never solves the user's task.

Replaces the previous SciBERT *encoder* expert (which only scored cosine similarity
to a hand-written marker catalogue). C2S-Scale's output is natural-language text.
"""

from __future__ import annotations

import re

from ._base import LazyCausalLM, TRANSLATE_ONLY_SYSTEM

EXPERT_ID = "c2s-singlecell"
MODEL_ID = "vandijklab/C2S-Scale-Gemma-2-2B"

GENE_TOKEN_RE = re.compile(r"^[A-Za-z][A-Za-z0-9.\-]{1,14}$")


def _clean_celltype(raw: str) -> str:
    """C2S-Scale answers with a cell-type label, then often continues generating a predicted
    'cell sentence' (a list of gene symbols). Keep only the leading natural-language label and
    drop any gene-token tail, so the agent gets clean prose."""
    text = raw.strip()
    # Take the prose prefix: stop at the first run that looks like a gene-symbol list.
    out_words: list[str] = []
    upper_streak = 0
    for tok in text.replace("\n", " ").split(" "):
        t = tok.strip()
        if not t:
            continue
        is_gene = bool(re.fullmatch(r"[A-Z0-9][A-Z0-9.\-]{1,14}", t.rstrip(".,")))
        upper_streak = upper_streak + 1 if is_gene else 0
        if upper_streak >= 3:  # three consecutive gene-like tokens => cell-sentence dump begins
            out_words = out_words[: len(out_words) - 2]
            break
        out_words.append(t)
    label = " ".join(out_words).strip(" .,")
    if not label:
        return text.split("\n", 1)[0].strip(" .,")
    return label[0].upper() + label[1:] + "."


def _is_number(s: str) -> bool:
    try:
        float(s)
        return True
    except ValueError:
        return False


def build_cell_sentence(payload: str, max_genes: int = 100) -> list[str]:
    """Return gene symbols ordered by descending expression (a 'cell sentence').

    Accepts three shapes: gene/value pairs (``GENE  3.2`` / ``GENE:3.2``), a
    ``gene<sep>value`` table, or a bare marker list (already-ranked, one per line).
    """
    lines = [ln.strip() for ln in payload.splitlines() if ln.strip()]
    pairs: list[tuple[str, float]] = []
    bare: list[str] = []
    for ln in lines:
        parts = re.split(r"[\s,:=\t]+", ln)
        if len(parts) >= 2 and GENE_TOKEN_RE.match(parts[0]) and _is_number(parts[1]):
            pairs.append((parts[0], float(parts[1])))
        elif len(parts) == 1 and GENE_TOKEN_RE.match(parts[0]) and re.search(r"[A-Z]", parts[0]):
            bare.append(parts[0])
    if pairs:
        pairs.sort(key=lambda p: -p[1])
        return [g for g, _ in pairs[:max_genes]]
    # No values: treat a bare list as an already-ranked cell sentence.
    return bare[:max_genes]


class SingleCellExpert:
    def __init__(self, model_path: str, device: str = "cuda:0") -> None:
        self.device = device
        self.model_id = MODEL_ID
        self._lm = LazyCausalLM(model_path, device=device)

    def analyze(self, payload: str, instruction: str = "", system: str = "") -> str:
        genes = build_cell_sentence(payload)
        if len(genes) < 2:
            return "No gene-expression or marker genes were found in the input."

        cell_sentence = " ".join(genes)
        prompt = (
            f"{TRANSLATE_ONLY_SYSTEM}\n\n"
            f"{('Context: ' + instruction.strip() + chr(10)) if instruction.strip() else ''}"
            "The following genes are listed in descending order of expression for a single cell. "
            f"Name the most likely cell type.\nGenes: {cell_sentence}\nCell type:"
        )
        raw = self._lm.generate_text(prompt, max_new_tokens=64)
        label = _clean_celltype(raw)
        return label or "The single-cell model did not return an interpretation."
