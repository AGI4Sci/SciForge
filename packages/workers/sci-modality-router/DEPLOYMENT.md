# Scientific-modality plug-in — GPU server deployment

This plug-in translates uploaded **scientific files** (protein sequence / protein 3D structure /
molecule / single-cell) into natural-language evidence using **real native-to-text expert models
on a GPU**. It is optional and decoupled: when it is not running, the app simply reads the raw file
text instead — no errors (see *When the server is down*).

## Where things run

```
  GPU server (this plug-in)                 Local machine                    Cloud
  ─────────────────────────                 ─────────────                    ─────
  expert-translator        :8001  ┐── provider (real text-output models, lazy)
  sci-modality module      :3898  ┘── ServiceResult HTTP API  <—— SSH tunnel ——  SciForge app
                                                                                 model-router ──> DeepSeek (text)
                                                                                              └─> Qwen3.7-Plus (vision)
```

- The **GPU server** runs only the experts + this module. It can be shut down anytime.
- The **app + model-router** run on the local machine; **DeepSeek (text)** and **Qwen3.7-Plus
  (vision)** are cloud endpoints — so **text and image still work even when the GPU server is off**;
  only scientific-file translation needs this plug-in.

## One-time setup (on the GPU server)

1. **Python env** (CUDA-enabled), e.g. `conda create -n serve python=3.10 && conda activate serve`.
2. Install a CUDA torch build, then the provider deps:
   ```bash
   pip install torch --index-url https://download.pytorch.org/whl/cu121
   pip install -r provider/requirements.txt
   ```
3. **Download the models** into `$EXPERT_MODEL_DIR` (default the shared mount
   `/fs-computility-new/upzd_share/shared/sciforge-expert-models`). Behind the GFW use the
   mirror: `export HF_ENDPOINT=https://hf-mirror.com`. All four are open, runnable weights:
   ```bash
   D=$EXPERT_MODEL_DIR
   huggingface-cli download habdine/Esm2Text-Base-v1-1       --local-dir $D/esm2text-base            # protein
   huggingface-cli download habdine/Prot2Text-Large-v1-1     --local-dir $D/prot2text-large          # protein_structure
   huggingface-cli download QizhiPei/biot5-plus-base-chebi20 --local-dir $D/biot5-plus-base-chebi20  # molecule
   huggingface-cli download vandijklab/C2S-Scale-Gemma-2-27B --local-dir $D/c2s-scale-gemma2-27b     # single_cell
   ```
   BioT5+ needs `pip install selfies` (SMILES→SELFIES).
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

```bash
cd packages/workers/sci-modality-router
bash deploy/start.sh                # idempotent; brings up experts(:8001) + module(:3898)
bash provider/start_prot2text.sh &  # protein_structure micro-service on :8002 (p2t env)
bash deploy/verify.sh               # no-cheat check: real fingerprints + input-dependent generated text
bash deploy/stop.sh                 # frees the GPUs
```

Useful env overrides: `PYTHON`, `EXPERT_MODEL_DIR`, `EXPERT_DEVICE` (default `cuda:0`),
`C2S_DEVICE` (default `cuda:1`; C2S-Scale-27B ~54GB gets its own GPU), `HF_ENDPOINT`
(default `https://hf-mirror.com`). Experts load lazily on first request, so startup is instant
and only the modalities you actually use consume VRAM. `protein_structure` is served by the
separate `start_prot2text.sh` process (`PROT2TEXT_DEVICE`, default GPU1).

**Run it when the server boots** — just re-run `bash deploy/start.sh` (it skips anything already up).
To make it automatic, add that line to a `@reboot` cron entry or a systemd unit.

## Connect Model Router

```bash
# 1) tunnel the module port to your machine:
ssh -p <port> -N -L 3898:127.0.0.1:3898 <user>@<server>
# 2) point the Model Router process at it:
export SCIFORGE_SCIMODALITY_SERVICE_URL=http://127.0.0.1:3898
```

Check it from the Model Router host: `curl http://127.0.0.1:3898/experts/status` lists each expert's
online state and device.

## When the server is down (graceful, no errors)

If the GPU server is off (or the tunnel is down), Model Router fails open and **falls back to
readable raw file text where safe**. The turn still completes, and GUI/Kun/Codex do not call this
service directly. Text chat and image (Qwen) are unaffected. Nothing to do — bring the server back
up and re-run `deploy/start.sh` to restore experts.

## Troubleshooting

- **Reloading after editing the module/provider**: kill the OLD process by PID first (it holds the
  port; a restart that races it dies with `EADDRINUSE` and the old code keeps serving). Verify a
  reload by hitting a changed behavior, not just `/health`. Free a port with `fuser -k 3898/tcp`.
  Never `pkill -f <token>` where the token also appears in your SSH command line — it kills your
  own shell.
- **GPU out of memory**: experts load lazily, so only loaded modalities use VRAM; move experts to
  a freer `EXPERT_DEVICE`, or restart the provider to evict models you are not using.
- **An expert shows offline in `/experts/status`**: check `deploy/run/experts.log` (and the
  prot2text micro-service log for `protein_structure`); usually a missing model download or VRAM pressure.
