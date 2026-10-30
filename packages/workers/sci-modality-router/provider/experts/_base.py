"""Shared plumbing for the text-output scientific experts.

Every expert in this provider is a *translate-only text generator*: it turns one
non-text scientific input (protein sequence / structure / molecule / single cell)
into natural-language evidence by running a real forward pass through a domain model
whose **native output is text**. Nothing here is composed from hand-rolled numeric
features and there are no general-LLM interpreters — the returned prose is the model's
own generated text. The expert never reasons about the task, answers the user, or
claims completion; it only describes what its model emitted, so the text-only main
agent can "see" the data.

Three pieces live here:

  * ``TRANSLATE_ONLY_SYSTEM`` — the shared system instruction.
  * ``LazyCausalLM`` — load-on-first-use wrapper around a HuggingFace causal LM
    (used by the C2S-Scale single-cell expert).
  * ``LazySeq2SeqLM`` — the same, for encoder-decoder models (used by BioT5+ molecule).

Lazy loading is deliberate: experts don't all load at startup, so a modality nobody
uses costs no VRAM and the provider boots instantly.
"""

from __future__ import annotations

import re
import threading
from typing import Any

import torch

# Residual chat/control tokens some models (e.g. Gemma's <ctrlNNN>, <end_of_turn>) emit that
# tokenizer skip_special_tokens does not strip. Remove them so the agent gets clean prose.
_ARTIFACT_RE = re.compile(r"<\s*(?:ctrl\d+|pad|eos|bos|unk|s|/s|end_of_turn|start_of_turn)\s*>", re.IGNORECASE)


def clean_output(text: str) -> str:
    return _ARTIFACT_RE.sub("", text).strip()

# Shared translate-only contract. Mirrors the Model Router vision-translator
# contract: produce faithful textual evidence, never solve the task / answer the
# user / claim completion.
TRANSLATE_ONLY_SYSTEM = (
    "You are a SciForge scientific-modality translator. Convert the provided "
    "non-text scientific input into concise, faithful natural-language evidence "
    "for another agent. Describe only what the input and the model show. Do NOT "
    "reason about the task, answer the user, give advice, draw conclusions, or "
    "claim task completion. You translate scientific signal into words — nothing more."
)


class LazyCausalLM:
    """Load-on-first-use wrapper around a HuggingFace causal language model.

    The model + tokenizer are loaded the first time ``generate_text`` is called,
    behind a lock so concurrent first requests don't double-load. ``trust_remote``
    is required by models that ship custom modeling code. Used by the C2S-Scale
    single-cell expert.
    """

    def __init__(
        self,
        model_path: str,
        device: str = "cuda:0",
        *,
        trust_remote: bool = False,
        torch_dtype: Any = None,
    ) -> None:
        self.model_path = model_path
        self.device = device
        self._trust_remote = trust_remote
        self._torch_dtype = torch_dtype if torch_dtype is not None else torch.bfloat16
        self._tokenizer = None
        self._model = None
        self._lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def _ensure(self) -> None:
        if self._model is not None:
            return
        with self._lock:
            if self._model is not None:
                return
            from transformers import AutoModelForCausalLM, AutoTokenizer

            tok = AutoTokenizer.from_pretrained(
                self.model_path, trust_remote_code=self._trust_remote
            )
            model = AutoModelForCausalLM.from_pretrained(
                self.model_path,
                trust_remote_code=self._trust_remote,
                torch_dtype=self._torch_dtype,
            ).to(self.device).eval()
            if tok.pad_token_id is None and tok.eos_token_id is not None:
                tok.pad_token = tok.eos_token
            self._tokenizer = tok
            self._model = model

    @torch.inference_mode()
    def generate_text(self, prompt: str, *, max_new_tokens: int = 256, temperature: float = 0.0) -> str:
        """Run a real forward pass and return only the newly generated text."""
        self._ensure()
        tok = self._tokenizer
        model = self._model
        inputs = tok(prompt, return_tensors="pt", truncation=True, max_length=4096).to(self.device)
        gen_kwargs: dict[str, Any] = {
            "max_new_tokens": max_new_tokens,
            "do_sample": temperature > 0,
            "pad_token_id": tok.pad_token_id if tok.pad_token_id is not None else (tok.eos_token_id or 0),
        }
        if temperature > 0:
            gen_kwargs["temperature"] = temperature
        output_ids = model.generate(**inputs, **gen_kwargs)
        # Strip the prompt tokens so we return only the model's own continuation.
        new_ids = output_ids[0][inputs["input_ids"].shape[1]:]
        return clean_output(tok.decode(new_ids, skip_special_tokens=True))


class LazySeq2SeqLM:
    """Load-on-first-use wrapper around a HuggingFace seq2seq (T5/BART) model.

    Used by encoder-decoder text-output experts (e.g. MolT5 SMILES->caption). The
    input string is encoded and the decoder generates the natural-language output.
    """

    def __init__(self, model_path: str, device: str = "cuda:0") -> None:
        self.model_path = model_path
        self.device = device
        self._tokenizer = None
        self._model = None
        self._lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def _ensure(self) -> None:
        if self._model is not None:
            return
        with self._lock:
            if self._model is not None:
                return
            from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

            self._tokenizer = AutoTokenizer.from_pretrained(self.model_path)
            self._model = (
                AutoModelForSeq2SeqLM.from_pretrained(self.model_path).to(self.device).eval()
            )

    @torch.inference_mode()
    def generate_text(self, text: str, *, max_new_tokens: int = 256, num_beams: int = 5) -> str:
        self._ensure()
        tok = self._tokenizer
        inputs = tok(text, return_tensors="pt", truncation=True, max_length=512).to(self.device)
        output_ids = self._model.generate(**inputs, max_new_tokens=max_new_tokens, num_beams=num_beams)
        return clean_output(tok.decode(output_ids[0], skip_special_tokens=True))
