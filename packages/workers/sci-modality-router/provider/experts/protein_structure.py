"""Protein-structure expert — PDB 3D structure to natural-language function text.

This is a thin proxy. The real model (Prot2Text-Large: ESM-2 + RGCN structure encoder +
GPT-2 decoder) runs in an isolated `p2t` env behind a small FastAPI service (see
``prot2text_service.py``), because its graph pipeline needs graphein + DSSP, whose
dependencies are too invasive for the shared provider env. This expert forwards the raw
PDB payload to that service and returns the generated text. Output is text only;
translate-only — it describes the protein's function, it does not solve the user's task.

Distinct from the sequence-only ``esm2text-protein`` expert: this one *uses the 3D
structure*, so its input is a PDB file (ATOM records), not a bare amino-acid sequence.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

EXPERT_ID = "prot2text-structure"
MODEL_ID = "habdine/Prot2Text-Large-v1-1 (ESM-2 + RGCN structure + GPT-2)"


class ProteinStructureExpert:
    def __init__(self, service_url: str | None = None, device: str = "cuda:1", timeout: float = 300.0) -> None:
        self.device = device
        self.model_id = MODEL_ID
        self._url = (service_url or os.environ.get("PROT2TEXT_SERVICE_URL", "http://127.0.0.1:8002")).rstrip("/")
        self._timeout = timeout

    def analyze(self, payload: str, instruction: str = "", system: str = "") -> str:
        if "ATOM" not in payload:
            return (
                "The input is not a PDB 3D structure (no ATOM records). The protein-structure "
                "expert needs a PDB file; for a bare amino-acid sequence use the protein modality."
            )
        body = json.dumps({"pdb": payload}).encode("utf-8")
        req = urllib.request.Request(
            f"{self._url}/describe",
            data=body,
            headers={"content-type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "ignore")
            raise RuntimeError(f"prot2text service HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(
                f"prot2text service unreachable at {self._url} ({exc.reason}); is the p2t service running?"
            ) from exc
        text = (data.get("text") or "").strip()
        return text or "The protein-structure model did not return a description."
