# @sciforge/sci-modality-router

A SciForge **worker** (`packages/workers/sci-modality-router`) — the scientific-data analogue of
the vision translator. It translates a **non-text scientific input** (protein sequence or 3D
structure, small molecule, single-cell expression) into **natural-language evidence** using real
expert models on GPU, so a text-only main agent (DeepSeek V4) can "see" the data.

- **Translate-only.** Each expert describes what its model generated about the input. It
  never reasons, answers the user, gives advice, draws conclusions, or claims task
  completion. Reasoning stays with the main agent.
- **Native-to-text models, no cheating.** Every translation is the natural-language text
  *generated* by a real domain model (Esm2Text, Prot2Text, BioT5+, C2S-Scale) on a real forward
  pass — never invented, and never a prompted general LLM. The provider stamps a
  `system_fingerprint` (`expert@device <ms>ms`) on every response. Experts load lazily on
  first use.
- **Self-contained.** Zero runtime npm dependencies (Node 20+ `node:http` + `fetch`). The
  TypeScript service (`src/`) and the Python GPU provider (`provider/`) live in this one folder.
- **HTTP service, not an MCP tool.** It returns a stable `ServiceResult` envelope and is invoked
  by the host during input pre-extraction (a deterministic transform), not chosen by an agent.

## Architecture (Model Router owned)

```
GUI/Kun/Codex input_object ref  ──>  Model Router  ──HTTP──>  @sciforge/sci-modality-router (this, TS)  ──OpenAI-compat──>  provider/ (Python, GPU)
       workspace file ref              gating + fallback       ServiceResult contract + retry                    four native-to-text expert models
```

- **This worker** owns the `ServiceResult` contract, modality detection, and robustness.
- **Model Router** (`@sciforge/model-router`) is the only in-repo caller. Runtimes pass structured
  workspace file refs; they do not read `SCIFORGE_SCIMODALITY_SERVICE_URL` or call this service
  directly. Model Router reads it via that env var (see `packages/workers/model-router/src/router.ts`).
- **`provider/`** is the GPU "model provider" — the `expert-translator` FastAPI app (port 8001).
  It runs on the GPU server; each of the four modalities maps to one registered **native-to-text**
  expert model that loads lazily on first request. `protein_structure` runs in an isolated
  micro-service (port 8002) because its graph pipeline pulls invasive deps.

## The four modalities

Every expert is a genuine domain model whose **native output is text** — there are no general-LLM
interpreters and nothing is composed from hand-rolled numeric summaries. We only support modalities
for which an open, commercially-usable, natively-to-text model deploys cleanly.

| Modality | Expert id | Model (native text output) | Notes |
|---|---|---|---|
| `protein` | `esm2text-protein` | Esm2Text-Base (ESM-2 + GPT, sequence-only) | sequence → function description |
| `protein_structure` | `prot2text-structure` | Prot2Text-Large (ESM-2 + RGCN + GPT-2) | 3D structure (PDB) → function description; isolated `p2t` micro-service (graphein + DSSP) |
| `molecule` | `biot5-molecule` | BioT5+ (T5, SELFIES→caption) | SMILES → caption; ChEBI-20 captioning SOTA among open checkpoints |
| `single_cell` | `c2s-singlecell` | C2S-Scale-Gemma-2 (Cell2Sentence) | scRNA-seq "cell sentence" → cell-type text |

**Deliberately not supported** (no clean native-to-text + open + commercial model): `nucleotide`
(ChatNT is non-commercial; genomic foundation models emit task tokens, not text), `spectrometry`
(MS models output structures/SMILES, not text), `spatial` (no open spatial→text model). These are
rejected at detection rather than translated by a stand-in LLM.

All weights download via `HF_ENDPOINT=https://hf-mirror.com` (behind the GFW) into `$EXPERT_MODEL_DIR`.

## Run

The provider runs on the GPU server; the TS worker can run on the GPU server **or** locally
against a tunneled provider. See [`DEPLOYMENT.md`](DEPLOYMENT.md) for the full GPU-server setup.

```bash
# 1) Provider (on the GPU server): the four native-to-text experts (lazy-loaded)
cd provider && HF_ENDPOINT=https://hf-mirror.com bash start.sh   # FastAPI on :8001 (cuda:0)
bash provider/start_prot2text.sh                                 # protein_structure micro-service on :8002

# 2) This worker (from the SciForge repo root)
npm --workspace @sciforge/sci-modality-router run start         # http://127.0.0.1:3898
#   reads EXPERT_PROVIDER_BASE_URL from the environment or packages/workers/sci-modality-router/.env
```

When SciForge runs on a different machine than the GPU server, expose the provider (or this
worker) over a stable SSH port-forward (preferred over public tunnels), e.g.
`ssh -p 2222 -N -L 8001:127.0.0.1:8001 -L 8002:127.0.0.1:8002 <gpu-server>` and point
`EXPERT_PROVIDER_BASE_URL` at `http://127.0.0.1:8001/v1`. The repo ships a one-click launcher,
`scripts/start-sciforge-scimodality.ps1`, that wires the tunnel + worker + GUI together.

## API

```
GET  /health        -> { ok, service, checkedAt }
GET  /version       -> { service, version, provider, modalities }
GET  /experts/status-> { ok, providerReachable, device, experts[], checkedAt }
POST /modality/translate
```

`POST /modality/translate` request:

```jsonc
{
  "payload": "MKTAYIAKQR...",        // raw scientific text (FASTA / SMILES / matrix / PDB)
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
  "summary": "[esm2-protein] mean NLL 2.13; …",   // bounded preview
  "data": {
    "summary": "…full multi-line evidence from the model…",
    "modality": "protein",
    "model": "esm2text-protein",
    "modalitySource": "detected"
  },
  "provenance": { "serviceId": "sciforge.sci-modality-router", "operation": "modality_translate", "requestId": "…" }
}
```

Failures return `{ ok: false, error: { code, message, retryable }, provenance }` with codes
`INVALID_ARGUMENT` / `UNAUTHENTICATED` / `NOT_FOUND` / `RATE_LIMITED` / `TIMEOUT` / `UNAVAILABLE` / `INTERNAL_ERROR`.

## Robustness (lives here, not in the caller)

The main agent cannot read these modalities, so a raw-payload fallback is useless — this
worker is the authority on "keep trying until the expert answers". Each call retries transient
failures (timeout / 5xx / 429 / network) with exponential backoff; only auth (401/403) and an
unregistered-expert (404) stop it early, plus a caller disconnect. The HTTP caller (Model Router)
therefore stays a thin one-shot POST. Tunables (env):

| Var | Default | Meaning |
|---|---|---|
| `EXPERT_PROVIDER_BASE_URL` | _(required)_ | OpenAI-compatible provider, e.g. `http://127.0.0.1:8001/v1`. |
| `EXPERT_PROVIDER_API_KEY` | `sk-local` | Bearer token for the provider (usually a placeholder). |
| `EXPERT_PROVIDER_TIMEOUT_MS` | `180000` | Per-attempt timeout (GPU can be slow). |
| `EXPERT_PROVIDER_MAX_ATTEMPTS` | `6` | Total attempts before giving up. |
| `EXPERT_PROVIDER_RETRY_BASE_MS` | `1500` | Exponential backoff base (capped at 15s). |
| `SCIMODALITY_ROUTER_HOST` | `127.0.0.1` | Bind host for this worker. |
| `SCIMODALITY_ROUTER_PORT` | `3898` | Bind port for this worker. |

## How SciForge uses it

Model Router consumes this worker during input routing:

- GUI copies explicit scientific uploads into the workspace and passes a structured `input_object`
  ref through the runtime.
- Model Router gates refs by explicit scientific extensions such as `.fasta`, `.smi`, `.mol`,
  `.sdf`, `.mgf`, `.pdb`, `.cif`, `.vcf`, `.bed`, and `.seq`. Generic `.txt`, `.csv`, and `.tsv`
  are not auto-routed to this service.
- When `SCIFORGE_SCIMODALITY_SERVICE_URL` is set in the Model Router environment, Model Router
  reads the workspace file text, POSTs it here (`/modality/translate`), and injects the returned
  evidence into the text reasoner. When unset or unavailable, Model Router falls back to readable
  raw text where safe (fail-open).

## Test

```bash
npm --workspace @sciforge/sci-modality-router run test       # stubbed provider, no network, no GPU
npm --workspace @sciforge/sci-modality-router run typecheck
```

The real-model end-to-end proof (no cheating) lives in [`tests/e2e_real_models.py`](tests/e2e_real_models.py) —
it drives this worker against the live GPU provider and asserts real model fingerprints and that
distinct inputs yield distinct generated text across all four modalities. (Any expert whose weights
are absent is skipped rather than failed, so it still passes on a partial deployment.)
