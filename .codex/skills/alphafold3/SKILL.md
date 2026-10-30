---
name: alphafold3
description: Submit, monitor and retrieve AlphaFold3 predictions using an explicitly configured compatible inference service and optional Kubernetes data plane.
---

# AlphaFold3 inference service

Submit, monitor and download protein structure predictions using an operator-provided API compatible with the C550 task protocol. No endpoint, account, cluster or storage location is supplied by this skill. It does not install models or grant access.

Always distinguish (1) submission accepted, (2) inference reached a terminal state, and (3) CIF coordinates retrieved and analyzed. A queued/running task is not molecular evidence; completion without CIF retrieval is execution-level evidence only.

## Explicit configuration

Obtain configuration and authorization from your own operator. Set environment variables or shell assignments in a **trusted**, untracked `.env` beside this file. The script sources that file as shell code: never load an untrusted file or commit credentials. Prefer HTTPS; HTTP is accepted only for explicitly selected deployments. Do not embed credentials in URLs.

| Variable | Required for |
|---|---|
| `ALPHAFOLD3_AUTH_URL` | Full HTTP(S) authentication endpoint, all operations |
| `ALPHAFOLD3_TASKS_URL` | Full HTTP(S) task endpoint, all operations |
| `ALPHAFOLD3_USERNAME` | Your service username, all operations |
| `ALPHAFOLD3_PASSWORD` | Your service password, all operations |
| `ALPHAFOLD3_MODEL_DIR` | Absolute remote model directory, submission; `--model-dir` overrides |
| `ALPHAFOLD3_NAMESPACE` | Kubernetes namespace, upload/download/preflight |
| `ALPHAFOLD3_KUBECONFIG` | Readable explicit kubeconfig, upload/download/preflight; `--kubeconfig` overrides |
| `ALPHAFOLD3_INPUT_BASE` | Absolute remote upload root, local JSON/sequence |
| `ALPHAFOLD3_OUTPUT_BASE` | Absolute remote fallback output root, download |

Missing required values fail with the variable name **before any HTTP or kubectl invocation**. Malformed endpoints, embedded URL credentials, relative required remote roots and unreadable kubeconfig also fail locally. Cluster operations never fall back to ambient kubeconfig. HTTP-only submission/polling of existing remote input requires no cluster configuration.

`--help` is offline. `--preflight` is **not offline**: with full configuration it authenticates and queries the selected cluster. Run only with authorization; it proves neither inference nor coordinate retrieval.

## Quick start

After explicitly configuring the variables required by your mode:

```bash
# Local sequence: upload → submit → poll → download
bash .codex/skills/alphafold3/scripts/alphafold3_submit.sh \
  --sequence MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG \
  --name My_Protein --output-dir ./outputs/alphafold3/my_run

# Local JSON (alias: --json)
bash .codex/skills/alphafold3/scripts/alphafold3_submit.sh \
  --json-input ./my_input.json --output-dir ./outputs/alphafold3/my_run

# Existing remote batch
bash .codex/skills/alphafold3/scripts/alphafold3_submit.sh \
  --input-dir "${REMOTE_INPUT_DIR:?Provide the existing remote directory}" --no-wait

# One existing remote JSON (alias: --json-path)
bash .codex/skills/alphafold3/scripts/alphafold3_submit.sh \
  --remote-json "${REMOTE_INPUT_JSON:?Provide the existing remote JSON path}" --no-wait
```

`--input-dir` skips upload; `--remote-json` isolates one file instead of risking invalid neighboring JSON files. The compatible API's `input_json` is a remote filename, **not inline JSON**. Confirm filesystem accessibility with your operator.

## Input format

```json
{
  "name": "My_Protein", "dialect": "alphafold3", "version": 1,
  "modelSeeds": [1],
  "sequences": [{"protein": {
    "id": "A", "sequence": "MQIFVKTLTG",
    "unpairedMsa": "", "pairedMsa": "", "templates": []
  }}]
}
```

The supported protocol requires `unpairedMsa`, `pairedMsa` and `templates`; empty values are supported when the server computes MSA. Missing fields can cause `ValueError: missing unpaired MSA`. For complexes, add entries with distinct chain IDs.

## Options

```text
--sequence SEQ    Generate AF3 JSON from a protein sequence
--name NAME       Task name (default: Fold)
--json PATH       Upload local JSON (alias: --json-input)
--input-dir DIR   Existing absolute remote batch directory
--remote-json F   Existing absolute remote .json (alias: --json-path)
--output-dir DIR  Local CIF download directory
--model-dir DIR   Explicit remote model directory; overrides environment
--kubeconfig F    Explicit kubeconfig; overrides environment
--max-wait N      Maximum polls, 60 seconds apart (default: 90)
--no-wait         Return after submission
--preflight       Authorized HTTP and cluster readiness check
--help            Offline help
```

Use `set -o pipefail` when piping logs to `tee`. Logs can include operator-selected paths and task metadata; review before sharing.

## Manual API

Use only an authorized service. Authenticate using JSON-encoded credentials:

```bash
: "${ALPHAFOLD3_AUTH_URL:?}" "${ALPHAFOLD3_TASKS_URL:?}"
: "${ALPHAFOLD3_USERNAME:?}" "${ALPHAFOLD3_PASSWORD:?}"
export ALPHAFOLD3_USERNAME ALPHAFOLD3_PASSWORD
AUTH_PAYLOAD=$(python3 -c 'import json,os; print(json.dumps({"username":os.environ["ALPHAFOLD3_USERNAME"],"password":os.environ["ALPHAFOLD3_PASSWORD"]}))')
TOKEN=$(curl -fsS -X POST "$ALPHAFOLD3_AUTH_URL" \
  -H 'Content-Type: application/json' -d "$AUTH_PAYLOAD" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')
```

Submit a single existing remote JSON (use `input_dir` and your directory for batches):

```bash
: "${ALPHAFOLD3_TASKS_URL:?}" "${TOKEN:?}" "${REMOTE_INPUT_JSON:?}" "${ALPHAFOLD3_MODEL_DIR:?}"
PAYLOAD=$(python3 -c 'import json,sys; print(json.dumps({"task_type":"fold","inputs":{"input_json":sys.argv[1],"model_dir":sys.argv[2]}}))' "$REMOTE_INPUT_JSON" "$ALPHAFOLD3_MODEL_DIR")
TASK_ID=$(curl -fsS -X POST "$ALPHAFOLD3_TASKS_URL" \
  -H "Authorization: Bearer $TOKEN" -H 'x-original-model: alphafold3' \
  -H 'Content-Type: application/json' -d "$PAYLOAD" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["task_id"])')
```

GET and POST **task** requests require the model-routing header:

```bash
: "${ALPHAFOLD3_TASKS_URL:?}" "${TASK_ID:?}" "${TOKEN:?}"
curl -fsS "${ALPHAFOLD3_TASKS_URL}/${TASK_ID}" \
  -H "Authorization: Bearer $TOKEN" -H 'x-original-model: alphafold3'
```

Inspect task-reported `outputs.output_path`, confirm ownership of that path, then retrieve with the actual pod name (not a deployment):

```bash
: "${ALPHAFOLD3_KUBECONFIG:?}" "${ALPHAFOLD3_NAMESPACE:?}"
: "${REMOTE_CIF_PATH:?Set the task output path}" "${LOCAL_CIF_PATH:?Set local destination}"
POD=$(kubectl --kubeconfig "$ALPHAFOLD3_KUBECONFIG" -n "$ALPHAFOLD3_NAMESPACE" \
  get pods -l app=alphafold3 -o jsonpath='{.items[0].metadata.name}')
: "${POD:?No AlphaFold3 pod found}"
kubectl --kubeconfig "$ALPHAFOLD3_KUBECONFIG" -n "$ALPHAFOLD3_NAMESPACE" \
  cp "${POD}:${REMOTE_CIF_PATH}" "$LOCAL_CIF_PATH"
```

## Output and troubleshooting

- Open CIF/mmCIF coordinates in PyMOL, ChimeraX or Biopython `MMCIFParser`.
- Prefer task-reported paths; `ALPHAFOLD3_OUTPUT_BASE` supplies a fallback. Do not infer a private deployment's layout.
- Completed metadata does not prove that a CIF was downloaded. Inspect coordinates before structural claims.
- For API 404, check routing headers and endpoint compatibility with the operator, not another private host.
- The script refreshes auth every ten polls. Token lifetime, rate limits, PVC sharing and output retention depend on the operator.
- For `kubectl cp` failures, check explicit kubeconfig, namespace, actual pod name and authorization, not a personal default context.

## Offline regression tests

Only Python stdlib and Bash are needed; HTTP/cluster commands are local test executables. Use a caller-owned `TMPDIR`/`HOME` for isolation:

```bash
python3 -B .codex/skills/alphafold3/tests/test_submit.py -v
```

These are offline contract tests, **not** real inference acceptance. Never use mocked responses as molecular results.
