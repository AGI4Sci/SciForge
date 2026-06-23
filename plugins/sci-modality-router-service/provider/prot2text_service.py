"""Isolated Prot2Text micro-service (protein 3D structure -> function text).

Prot2Text-Large (ESM-2-650M encoder + RGCN structure encoder + GPT-2 decoder) is a
genuine multimodal *to-text* model: given a protein's 3D structure it **generates** a
free-text description of the protein's function. It is the open SOTA for structure-
conditioned protein-function text generation.

Why a separate service instead of an expert inside the main provider:
its graph pipeline needs `graphein` + the DSSP binary, whose dependency closure
(biopython / older pandas / networkx) is too invasive to install into the shared
`serve` env that runs the other experts. We therefore run Prot2Text in its own cloned
env (`p2t`, which has graphein + DSSP) as a tiny FastAPI service. The main provider's
`ProteinStructureExpert` simply HTTP-proxies a PDB payload here. Output is text only.

Deployment box has no internet, so Prot2Text's AlphaFold-ID download path is unusable.
Instead we accept a raw PDB payload and pre-place it at the exact path the model's
`download_alphafold_structure(uniprot_id, out_dir)` would return (it short-circuits when
the file already exists), so the model's own unmodified graph+generate code runs on it.

Bind: 127.0.0.1:8002  (PROT2TEXT_PORT to override). Run with the `p2t` interpreter.
"""

from __future__ import annotations

import os
import sys
import threading

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

MODEL_DIR = os.environ.get(
    "PROT2TEXT_MODEL_DIR",
    "/fs-computility-new/upzd_share/shared/sciforge-expert-models/prot2text-large",
)
DEVICE = os.environ.get("PROT2TEXT_DEVICE", "cuda:1")
HOST = os.environ.get("PROT2TEXT_HOST", "127.0.0.1")
PORT = int(os.environ.get("PROT2TEXT_PORT", "8002"))

_lock = threading.Lock()
_model = None
_tokenizer = None
# The PDB text for the in-flight request. The monkeypatched downloader reads it; access is
# serialized by _lock so one global is safe (structure inference runs one-at-a-time anyway).
_current_pdb = ""


def _ensure() -> None:
    global _model, _tokenizer
    if _model is not None:
        return
    from transformers import AutoModelForCausalLM, AutoTokenizer

    tok = AutoTokenizer.from_pretrained(MODEL_DIR, trust_remote_code=True)
    model = (
        AutoModelForCausalLM.from_pretrained(MODEL_DIR, trust_remote_code=True)
        .to(DEVICE)
        .eval()
    )
    # The box has no internet, so Prot2Text's AlphaFold downloader cannot fetch structures.
    # Replace it with one that writes the current request's PDB to the path the model expects
    # and returns it — the rest of the model's own graph+generate pipeline runs unchanged.
    mod = sys.modules[type(model).__module__]

    def _local_pdb(uniprot_id, out_dir, version=4):  # noqa: ANN001
        os.makedirs(out_dir, exist_ok=True)
        dst = os.path.join(out_dir, f"AF-{uniprot_id.upper()}-F1-model_v{version}.pdb")
        with open(dst, "w") as fh:
            fh.write(_current_pdb)
        return dst

    mod.download_alphafold_structure = _local_pdb
    _tokenizer = tok
    _model = model


def _describe(pdb_text: str) -> str:
    global _current_pdb
    _ensure()
    _current_pdb = pdb_text
    try:
        # protein_pdbID is a placeholder; the patched downloader serves _current_pdb. The
        # model builds the graph (graphein+DSSP), generates text, and cleans up its temp files.
        text = _model.generate_protein_description(
            protein_pdbID="QUERY", tokenizer=_tokenizer, device=DEVICE
        )
    finally:
        _current_pdb = ""
    return (text or "").strip()


class DescribeRequest(BaseModel):
    pdb: str


app = FastAPI(title="Prot2Text structure->text", version="1.0.0")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "device": DEVICE, "loaded": _model is not None}


@app.post("/describe")
def describe(req: DescribeRequest) -> dict:
    if not req.pdb or "ATOM" not in req.pdb:
        raise HTTPException(status_code=400, detail="payload is not a PDB structure (no ATOM records)")
    with _lock:  # graph pipeline uses fixed temp paths; serialize requests.
        try:
            text = _describe(req.pdb)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"prot2text failed: {exc}") from exc
    if not text:
        raise HTTPException(status_code=502, detail="prot2text returned empty text")
    return {"text": text}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
