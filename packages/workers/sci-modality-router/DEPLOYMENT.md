# Scientific-modality worker — optional self-hosting after license review

This plug-in translates uploaded **scientific files** (protein sequence / protein 3D structure /
molecule / single-cell) into natural-language evidence through a local Model Router boundary and
an operator-managed native-to-text expert runtime. It is optional and decoupled: when it is not running, Model Router
falls back to readable raw file text where safe (see *When the server is down*).

Commercial builds do not bundle model weights, do not auto-start this runtime, and do not ship a
direct expert/provider connection. Use this document only after independently verifying that every selected
model, dependency, and deployment mode is allowed for your commercial use case.

## Where things run

```
  Operator-managed GPU host                 Local machine                    Model Router-managed upstreams
  ─────────────────────────                 ─────────────                    ─────
  expert-translator        :8001  ┐── local expert runtime (licensed text-output models, lazy)
  sci-modality module      :3898  ┘── ServiceResult HTTP API  <—— SSH tunnel ——  SciForge app
  local Model Router /v1   :3892  ─── only HTTP model boundary used by sci-modality
                                                                                 model-router ──> configured text provider
                                                                                              └─> configured vision provider
```

- The **operator-managed service** runs only the experts + this module. It can be shut down anytime.
- The **app + Model Router** run on the local machine; text, vision, and other LLM/API traffic still
  go through Model Router. Only scientific-file translation needs this optional worker.

## One-time setup (operator-managed service)

1. **Python env** (CUDA-enabled), e.g. `conda create -n serve python=3.10 && conda activate serve`.
2. Install a CUDA torch build, then the local expert runtime deps:
   ```bash
   pip install torch --index-url https://download.pytorch.org/whl/cu121
   pip install -r provider/requirements.txt
   ```
3. Place reviewed, licensed model weights outside the repository and set
   `EXPERT_MODEL_DIR` / `PROT2TEXT_MODEL_DIR` to those absolute paths. Do not commit, package,
   or publish the weights from this repo. BioT5+-style molecule providers need `pip install selfies`
   (SMILES→SELFIES).
4. **Prot2Text micro-service (`protein_structure`)** runs in its own conda env because its graph
   pipeline pulls invasive deps; keep it out of the main `serve` env:
   ```bash
   conda create -y -n p2t --clone serve
   /root/miniconda3/envs/p2t/bin/pip install graphein         # graph construction
   apt-get install -y dssp                                     # provides /usr/bin/mkdssp (secondary structure)
   ```
   Prot2Text ships old custom modeling code: `provider/start_prot2text.sh` patches its
   `transformers.deepspeed` import, seeds the `transformers_modules` cache with its `.py` files, and
   monkeypatches the AlphaFold downloader to consume the request's raw PDB (the box has no internet).
5. `npm install` once at the repo root so this module's `tsx` runtime is available.

## Start / stop / verify

Start or tunnel a local SciForge Model Router first; the sci-modality TS worker refuses non-local
`/v1` base URLs and never reads direct expert-provider env vars.

```bash
cd packages/workers/sci-modality-router
export SCIFORGE_ENABLE_LOCAL_EXPERT_PROVIDER=1
export EXPERT_TRANSLATOR_RUNTIME_TOKEN=<local-expert-runtime-token>
export EXPERT_MODEL_DIR=/absolute/path/to/licensed/expert-models
export PROT2TEXT_MODEL_DIR=/absolute/path/to/licensed/prot2text-checkpoint
export SCIFORGE_MODEL_ROUTER_BASE_URL=http://127.0.0.1:3892/v1
export SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY=<local-model-router-runtime-token>
export SCIMODALITY_ROUTER_RUNTIME_TOKEN=<sci-modality-runtime-token>
export SCIMODALITY_ROUTER_URL=http://127.0.0.1:3898
export LOCAL_EXPERT_RUNTIME_URL=http://127.0.0.1:8001
bash provider/start.sh &            # local expert runtime on :8001
bash provider/start_prot2text.sh &  # protein_structure micro-service on :8002 (p2t env)
npm --workspace @sciforge/sci-modality-router run start  # module on :3898
python3 tests/e2e_real_models.py    # no-cheat check: real fingerprints + input-dependent generated text
bash deploy/stop.sh                 # frees the GPUs
```

Required license-gated env: `SCIFORGE_ENABLE_LOCAL_EXPERT_PROVIDER=1`, `EXPERT_MODEL_DIR`, and
`PROT2TEXT_MODEL_DIR` for the structure micro-service. The sci-modality TS worker also requires
`SCIFORGE_MODEL_ROUTER_BASE_URL` to be a local `/v1` URL and
`SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY`; legacy `EXPERT_PROVIDER_*` env vars are rejected there.

Useful env overrides: `PYTHON`, `EXPERT_DEVICE` (default `cuda:0`),
`C2S_DEVICE` (default `cuda:1`; C2S-Scale-27B ~54GB gets its own GPU), `HF_ENDPOINT`
(default `https://hf-mirror.com`). Experts load lazily on first request, so startup is instant
and only the modalities you actually use consume VRAM. `protein_structure` is served by the
separate `start_prot2text.sh` process (`PROT2TEXT_DEVICE`, default GPU1).

For unattended service management, keep the same license-gated environment in your process manager.

## Connect Model Router

```bash
# 1) tunnel the module port to your machine:
ssh -p <port> -N -L 3898:127.0.0.1:3898 <user>@<server>
# 2) point the Model Router sidecar/CLI at it; it will generate `translators.scientific`:
export SCIFORGE_SCIMODALITY_SERVICE_URL=http://127.0.0.1:3898
export SCIFORGE_SCIMODALITY_SERVICE_TOKEN=<same-token-as-SCIMODALITY_ROUTER_RUNTIME_TOKEN>
```

Check the worker directly from the Model Router host:
`curl -H "Authorization: Bearer $SCIFORGE_SCIMODALITY_SERVICE_TOKEN" http://127.0.0.1:3898/experts/status`
reports whether the local Model Router boundary is reachable for each expert id; lazy weight
loading remains behind that boundary.

## When the server is down (graceful, no errors)

If the optional service is off (or the private connection is down), Model Router fails open and
**falls back to readable raw file text where safe**. The turn still completes, and GUI/local runtime/Codex/Claude
do not call this service directly. Other model traffic is unaffected.

## Troubleshooting

- **Reloading after editing the module/local runtime**: kill the OLD process by PID first (it holds the
  port; a restart that races it dies with `EADDRINUSE` and the old code keeps serving). Verify a
  reload by hitting a changed behavior, not just `/health`. Free a port with `fuser -k 3898/tcp`.
  Never `pkill -f <token>` where the token also appears in your SSH command line — it kills your
  own shell.
- **GPU out of memory**: experts load lazily, so only loaded modalities use VRAM; move experts to
  a freer `EXPERT_DEVICE`, or restart the local runtime to evict models you are not using.
- **An expert shows offline in `/experts/status`**: check `deploy/run/experts.log` (and the
  prot2text micro-service log for `protein_structure`); usually a missing model download or VRAM pressure.
