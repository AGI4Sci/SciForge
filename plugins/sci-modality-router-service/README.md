# SciForge Sci-Modality Router Service

A **standalone, pluggable** SciForge service module — the scientific-data sibling of the
[Vision Router](../vision-router-service/), and a peer plugin module beside it. It translates a
**non-text scientific input** (protein sequence or 3D structure, small molecule, single-cell
expression) into **natural-language evidence** using real expert models on GPU, so a text-only
main agent (DeepSeek V4) can "see" the data.

- **Translate-only.** Each expert describes what its model generated about the input. It
  never reasons, answers the user, gives advice, draws conclusions, or claims task
  completion. Reasoning stays with the main agent.
- **Native-to-text models, no cheating.** Every translation is the natural-language text
  *generated* by a real domain model (Esm2Text, Prot2Text, BioT5+, C2S-Scale) on a real forward
  pass — never invented, and never a prompted general LLM. The provider stamps a
  `system_fingerprint` (`expert@device <ms>ms`) on every response. Experts load lazily on
  first use.
- **Independent.** No dependency on the SciForge main repo. Zero runtime npm dependencies
  (Node 20+ `node:http` + `fetch`).
- **Template-conformant.** Returns the `ServiceResult` envelope from
  [`../Servic_Module_Template.md`](../Servic_Module_Template.md). Per the template's placement
  rules this is an **HTTP service** (a stable transform invoked by the host during input
  pre-extraction), not an Agent-chosen MCP tool.

## Architecture (Model Router owned)

```
GUI/Kun/Codex input_object ref  ──>  Model Router  ──HTTP──>  sci-modality-router-service (this, TS)  ──OpenAI-compat──>  provider/ (Python, GPU)
       workspace file ref              gating + fallback       ServiceResult contract + retry                  four native-to-text expert models
```

- **This service** owns the `ServiceResult` contract, modality detection, and robustness.
  It is the analogue of `vision-router-service` (which calls Qwen).
- **Model Router** is the only in-repo caller. Runtimes pass structured workspace file refs; they
  do not read `SCIFORGE_SCIMODALITY_SERVICE_URL` or call this service directly.
- **`provider/`** is the GPU "model provider" — the `expert-translator` FastAPI app (port 8001),
  analogue of the Qwen endpoint. It runs on the GPU server; each of the four modalities maps to
  one registered **native-to-text** expert model that loads lazily on first request.

## The four modalities

Every expert is a genuine domain model whose **native output is text** — there are no general-LLM
interpreters and nothing is composed from hand-rolled numeric summaries. We only support modalities
for which an open, commercially-usable, natively-to-text model deploys cleanly; modalities whose
only options are encoders, structure generators, or non-commercial weights are deliberately omitted
(see the note below) rather than faked with a prompted general LLM.

| Modality | Expert id | Model (native text output) | Notes |
|---|---|---|---|
| `protein` | `esm2text-protein` | Esm2Text-Base (ESM-2 + GPT, sequence-only) | sequence → function description; Prot2Text family |
| `protein_structure` | `prot2text-structure` | Prot2Text-Large (ESM-2 + RGCN + GPT-2) | 3D structure (PDB) → function description; runs in an isolated `p2t` micro-service (graphein + DSSP) |
| `molecule` | `biot5-molecule` | BioT5+ (T5, SELFIES→caption) | SMILES → caption; ChEBI-20 captioning SOTA among open checkpoints |
| `single_cell` | `c2s-singlecell` | C2S-Scale-Gemma-2-27B (Cell2Sentence) | scRNA-seq "cell sentence" → cell-type text |

**Deliberately not supported** (no clean native-to-text + open + commercial model): `nucleotide`
(ChatNT is non-commercial; genomic foundation models emit task tokens, not text), `spectrometry`
(MS models output structures/SMILES, not text), `spatial` (no open spatial→text model — C2S
degenerates to gene-list dumps on mixed regions). These are rejected at detection rather than
translated by a stand-in LLM.

All download via `HF_ENDPOINT=https://hf-mirror.com` (behind the GFW) into `$EXPERT_MODEL_DIR`.
Weights live on the shared mount (`/fs-computility-new/.../sciforge-expert-models`).

## Run

```bash
# 1) Provider (on the GPU server): the four native-to-text experts (lazy-loaded)
cd provider && HF_ENDPOINT=https://hf-mirror.com bash start.sh   # FastAPI on :8001 (cuda:0)
# protein_structure also needs the isolated Prot2Text micro-service: bash start_prot2text.sh (:8002)

# 2) This module (calls the provider)
npm install
cp .env.example .env                    # EXPERT_PROVIDER_BASE_URL -> the running provider
npm start                               # http://127.0.0.1:3898
```

When SciForge runs on a different machine than the GPU server, expose the provider/module over a
stable SSH port-forward (preferred over public tunnels):
`ssh -p 2222 -N -L 3898:127.0.0.1:3898 <gpu-server>` and point the host at `http://127.0.0.1:3898`.

## API

```
GET  /health   -> { ok, service, checkedAt }
GET  /version  -> { service, version, provider, modalities }
POST /modality/translate
```

`POST /modality/translate` request:

```jsonc
{
  "payload": "MKTAYIAKQR...",        // raw scientific text (FASTA / SMILES / matrix / peak list)
  "modality": "protein",             // optional — omit to auto-detect from payload
  "instruction": "what is this?",    // optional context (NOT a task to solve)
  "objectId": "upload-123",          // optional, echoed into provenance
  "requestId": "optional"
}
```

Response — `ServiceResult<ModalityTranslation>`:

```jsonc
{
  "ok": true,
  "summary": "[esm2-protein] mean NLL 2.13; pseudo-perplexity 8.4; …",   // bounded preview
  "data": {
    "summary": "…full multi-line evidence from the model…",
    "modality": "protein",
    "model": "esm2-protein",
    "modalitySource": "detected"
  },
  "provenance": { "serviceId": "sciforge.sci-modality-router", "operation": "modality_translate", "requestId": "…" }
}
```

Failures return `{ ok: false, error: { code, message, retryable }, provenance }` with codes
`INVALID_ARGUMENT` / `UNAUTHENTICATED` / `NOT_FOUND` / `RATE_LIMITED` / `TIMEOUT` / `UNAVAILABLE` / `INTERNAL_ERROR`.

## Robustness (lives here, not in the caller)

The main agent cannot read these modalities, so a raw-payload fallback is useless — this
service is the authority on "keep trying until the expert answers". Each call retries transient
failures (timeout / 5xx / 429 / network) with exponential backoff; only auth (401/403) and an
unregistered-expert (404) stop it early, plus a caller disconnect. The HTTP caller (SciForge)
therefore stays a thin one-shot POST. Tunables (env):

| Var | Default | Meaning |
|---|---|---|
| `EXPERT_PROVIDER_TIMEOUT_MS` | `180000` | Per-attempt timeout (GPU can be slow). |
| `EXPERT_PROVIDER_MAX_ATTEMPTS` | `6` | Total attempts before giving up. |
| `EXPERT_PROVIDER_RETRY_BASE_MS` | `1500` | Exponential backoff base (capped at 15s). |

## How SciForge uses it

Model Router consumes this module during input routing:

- GUI copies explicit scientific uploads into the workspace under `.sciforge/uploads/` and passes a
  structured `input_object` ref through the runtime.
- Model Router gates refs by explicit scientific extensions such as `.fasta`, `.smi`, `.mol`,
  `.sdf`, `.mgf`, `.pdb`, `.cif`, `.vcf`, `.bed`, and `.seq`. Generic `.txt`, `.csv`, and `.tsv`
  are not auto-routed to this service.
- When `SCIFORGE_SCIMODALITY_SERVICE_URL` is set in the Model Router environment, Model Router
  reads the workspace file text, POSTs it here (`/modality/translate`), and injects the returned
  evidence into the text reasoner. When unset or unavailable, Model Router falls back to readable
  raw text where safe.
- **Router transparency.** Model Router does not hide this step: it prepends the expert's **raw
  output verbatim** (and the chosen expert model id) to the answer, so SciForge users see exactly
  what the translate-only domain model emitted, separate from the main agent's reasoning.

## Test

```bash
npm test            # stubbed provider, no network, no GPU (TS module)
npm run typecheck

# the SciForge-dev hook unit test:
cd ../SciForge-dev && npm run smoke:scimodality-preextract
```

The real-model end-to-end proof (no cheating) lives in [`tests/e2e_real_models.py`](tests/e2e_real_models.py) —
it drives this service against the live GPU provider and asserts real model fingerprints and that
distinct inputs yield distinct generated text across all four modalities. (Any expert whose weights
are absent is skipped rather than failed, so it still passes on a partial deployment.)
