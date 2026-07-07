"""SciForge local expert-translator runtime.

OpenAI-compatible /v1/chat/completions compatibility layer for local domain experts
behind the Model-Router-managed sci-modality worker. It does not accept or forward to
arbitrary upstream LLM providers.
Every expert is a real domain model whose **native output is text**: it runs a real
forward pass that generates a natural-language description of the input. There are NO
general-LLM interpreters here — only models that natively translate their modality to
text. Experts are translate-only (describe, never solve the task) and load lazily on
first use, so the runtime boots instantly and unused modalities cost no VRAM.

  esm2text-protein         protein sequence  Esm2Text-Base (ESM-2 + GPT, seq-only)
  prot2text-structure      protein PDB/mmCIF Prot2Text-Large (ESM-2 + RGCN + GPT-2) [via p2t service]
  biot5-molecule           SMILES / molecule BioT5+ (T5 SELFIES->caption, ChEBI-20 SOTA)
  c2s-singlecell           scRNA-seq         C2S-Scale-Gemma-2-27B (Cell2Sentence)

Every expert's output is natural-language text from a real forward pass; nothing is
fabricated. Experts load lazily on first request, so the runtime boots instantly and
only used modalities consume VRAM.

Bind: 127.0.0.1:8001  (EXPERT_TRANSLATOR_HOST / EXPERT_TRANSLATOR_PORT to override)
"""

from __future__ import annotations

import os
import secrets
import time
import uuid
from typing import Any

import torch
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from experts.protein import ProteinExpert
from experts.protein_structure import ProteinStructureExpert
from experts.singlecell import SingleCellExpert
from experts.molecule import MoleculeExpert

if os.environ.get("SCIFORGE_ENABLE_LOCAL_EXPERT_PROVIDER", "").strip() != "1":
    raise RuntimeError(
        "Local expert runtime is disabled by default. Set "
        "SCIFORGE_ENABLE_LOCAL_EXPERT_PROVIDER=1 only after verifying the model licenses."
    )

DEVICE = os.environ.get("EXPERT_DEVICE", "cuda:0")
# C2S-Scale-27B (~54GB) gets its own GPU (C2S_DEVICE) so it doesn't contend with the smaller
# experts (BioT5 + Esm2Text, together <5GB) which share DEVICE. Override with C2S_DEVICE if needed.
C2S_DEVICE = os.environ.get("C2S_DEVICE", "cuda:1")
HOST = os.environ.get("EXPERT_TRANSLATOR_HOST", "127.0.0.1")
PORT = int(os.environ.get("EXPERT_TRANSLATOR_PORT", "8001"))
MODEL_DIR = os.environ.get("EXPERT_MODEL_DIR", "").strip()
LEGACY_EXPERT_PROVIDER_API_KEY = os.environ.get("EXPERT_PROVIDER_API_KEY", "").strip()
EXPERT_TRANSLATOR_RUNTIME_TOKEN = os.environ.get("EXPERT_TRANSLATOR_RUNTIME_TOKEN", "").strip()
if LEGACY_EXPERT_PROVIDER_API_KEY:
    raise RuntimeError(
        "EXPERT_PROVIDER_API_KEY is not supported. Use EXPERT_TRANSLATOR_RUNTIME_TOKEN "
        "for the local expert-translator runtime bearer token."
    )
MAX_BODY_BYTES = int(os.environ.get("EXPERT_TRANSLATOR_MAX_BODY_BYTES", str(40 * 1024 * 1024)))

if not MODEL_DIR:
    raise RuntimeError("EXPERT_MODEL_DIR is required; commercial builds do not bundle expert weights.")
if not EXPERT_TRANSLATOR_RUNTIME_TOKEN:
    raise RuntimeError("EXPERT_TRANSLATOR_RUNTIME_TOKEN is required to start the local expert-translator runtime.")
if MAX_BODY_BYTES <= 0:
    raise RuntimeError("EXPERT_TRANSLATOR_MAX_BODY_BYTES must be positive.")

# Construct experts (cheap — models load lazily on first request, not here). Every expert is a
# genuine domain model that natively outputs text; there are no general-LLM interpreters.
print(f"[expert-translator] registering native-to-text experts (lazy load, device={DEVICE}, c2s={C2S_DEVICE}) ...", flush=True)
EXPERTS: dict[str, Any] = {
    "esm2text-protein": ProteinExpert(f"{MODEL_DIR}/esm2text-base", device=DEVICE),
    # Structure expert proxies to the isolated p2t micro-service (graphein+DSSP env).
    "prot2text-structure": ProteinStructureExpert(),
    "biot5-molecule": MoleculeExpert(f"{MODEL_DIR}/biot5-plus-base-chebi20", device=DEVICE),
    "c2s-singlecell": SingleCellExpert(f"{MODEL_DIR}/c2s-scale-gemma2-27b", device=C2S_DEVICE),
}
print(f"[expert-translator] ready. registered models: {list(EXPERTS)}", flush=True)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    model: str
    messages: list[ChatMessage]
    temperature: float | None = None
    max_tokens: int | None = None


app = FastAPI(title="SciForge Local Expert Translator", version="3.0.0")


@app.middleware("http")
async def require_runtime_token_and_cap_body(request: Request, call_next):
    if not _has_valid_bearer(request.headers.get("authorization")):
        return JSONResponse(status_code=401, content={"detail": "Unauthorized."})

    raw_content_length = request.headers.get("content-length")
    if raw_content_length:
        try:
            if int(raw_content_length) > MAX_BODY_BYTES:
                return JSONResponse(status_code=413, content={"detail": "Request body is too large."})
        except ValueError:
            return JSONResponse(status_code=400, content={"detail": "Invalid Content-Length."})

    if request.method in {"POST", "PUT", "PATCH"}:
        body = await request.body()
        if len(body) > MAX_BODY_BYTES:
            return JSONResponse(status_code=413, content={"detail": "Request body is too large."})

    return await call_next(request)


@app.get("/v1/models")
def list_models() -> dict[str, Any]:
    return {
        "object": "list",
        "data": [
            {"id": name, "object": "model", "owned_by": "sciforge-expert"}
            for name in EXPERTS
        ],
    }


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "device": DEVICE,
        "torch_cuda_available": torch.cuda.is_available(),
        "experts": list(EXPERTS),
        "loaded": [name for name, e in EXPERTS.items() if getattr(getattr(e, "_lm", None), "loaded", False)],
    }


@app.post("/v1/chat/completions")
def chat_completions(req: ChatRequest) -> dict[str, Any]:
    expert = EXPERTS.get(req.model)
    if expert is None:
        raise HTTPException(
            status_code=404,
            detail=f"unknown model {req.model!r}. registered: {list(EXPERTS)}",
        )

    system = next((m.content for m in req.messages if m.role == "system"), "")
    user = next((m.content for m in req.messages if m.role == "user"), "")
    if not user:
        raise HTTPException(status_code=400, detail="missing user message")

    instruction, payload = _split_instruction_and_payload(user)
    started = time.time()
    try:
        text = expert.analyze(payload=payload, instruction=instruction, system=system)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"expert {req.model!r} failed: {exc}") from exc
    elapsed_ms = int((time.time() - started) * 1000)

    device = getattr(expert, "device", DEVICE)
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:24]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": req.model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": text},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        "system_fingerprint": f"expert-translator/{req.model}@{device} {elapsed_ms}ms",
    }


def _split_instruction_and_payload(user_text: str) -> tuple[str, str]:
    """Router wraps payload in '--- <label> input ---' fences. Strip if present."""
    if "--- " in user_text and " input ---" in user_text:
        head, _, rest = user_text.partition("--- ")
        body, _, _tail = rest.partition("--- end ")
        payload_lines = body.split("\n", 1)
        payload = payload_lines[1].rstrip() if len(payload_lines) > 1 else body
        instruction = head.strip()
        if instruction.startswith("User request context:"):
            instruction = instruction.split(":", 1)[1].strip()
        return instruction, payload.strip()
    return "", user_text.strip()


def _has_valid_bearer(value: str | None) -> bool:
    if not value:
        return False
    scheme, _, token = value.partition(" ")
    return scheme.lower() == "bearer" and secrets.compare_digest(token.strip(), EXPERT_TRANSLATOR_RUNTIME_TOKEN)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
