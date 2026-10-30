#!/bin/bash
set -euo pipefail

# ============================================================
# AlphaFold3 C550 Inference Platform — Submit & Monitor Script
# ============================================================
#
# Four modes:
#   Mode A — Submit from a local AlphaFold3 JSON file:
#     bash alphafold3_submit.sh --json ./input.json [--output-dir ./results]
#
#   Mode B — Auto-generate JSON from a protein sequence:
#     bash alphafold3_submit.sh --sequence "MQIFVK..." --name "MyFold"
#
#   Mode C — Submit a pre-staged PVC input directory:
#     bash alphafold3_submit.sh --input-dir /data/input/my_batch --no-wait
#
#   Mode D — Submit a single pre-staged PVC JSON file:
#     bash alphafold3_submit.sh --remote-json /data/input/my_batch/input.json --no-wait
#
# Credentials are read from the .env file alongside this script.
#
# Options:
#   --json        PATH   Submit a local AlphaFold3 JSON file.
#   --json-input  PATH   Alias for --json.
#   --sequence    TEXT   Protein sequence (auto-generates proper AF3 JSON).
#   --input-dir   PATH   Submit a PVC directory already containing AF3 JSON files.
#   --remote-json PATH   Submit a single JSON file already present on the PVC.
#   --json-path   PATH   Alias for --remote-json.
#   --name        TEXT   Task name (required with --sequence, default: "Fold").
#   --output-dir  PATH   Local directory for downloaded .cif results.
#   --model-dir   PATH   Explicit model directory (or ALPHAFOLD3_MODEL_DIR).
#   --kubeconfig  PATH   Explicit kubeconfig (or ALPHAFOLD3_KUBECONFIG).
#   --max-wait    N      Max poll iterations, each 60s (default: 90 = 1.5h).
#   --no-wait            Submit and return immediately; don't poll/download.
#   --preflight          Print redacted control-plane/data-plane readiness TSV and exit.
#   --help               Show this help.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ---- sourcing .env ----
if [[ -f "$SKILL_DIR/.env" ]]; then
    set -a; source "$SKILL_DIR/.env"; set +a
else
    echo "Warning: $SKILL_DIR/.env not found. Set ALPHAFOLD3_PASSWORD manually."
fi

API_AUTH="${ALPHAFOLD3_AUTH_URL:-}"
API_TASKS="${ALPHAFOLD3_TASKS_URL:-}"
K8S_NS="${ALPHAFOLD3_NAMESPACE:-}"
INPUT_BASE="${ALPHAFOLD3_INPUT_BASE:-}"
OUTPUT_BASE="${ALPHAFOLD3_OUTPUT_BASE:-}"

JSON_FILE=""
SEQUENCE=""
SEQUENCE_SET=false
TASK_NAME="Fold"
OUTPUT_DIR=""
MODEL_DIR="${ALPHAFOLD3_MODEL_DIR:-}"
MAX_WAIT=90
NO_WAIT=false
INPUT_DIR=""
REMOTE_JSON=""
KUBECONFIG_PATH="${ALPHAFOLD3_KUBECONFIG:-}"
PREFLIGHT=false

usage() {
    sed -n '2,36p' "$0"
    exit 0
}

# ---- argument parsing ----
while [[ $# -gt 0 ]]; do
    case "$1" in
        --json|--json-input) JSON_FILE="$2"; shift 2 ;;
        --sequence)    SEQUENCE="$2"; SEQUENCE_SET=true; shift 2 ;;
        --input-dir)   INPUT_DIR="$2";   shift 2 ;;
        --remote-json|--json-path) REMOTE_JSON="$2"; shift 2 ;;
        --name)        TASK_NAME="$2";   shift 2 ;;
        --output-dir)  OUTPUT_DIR="$2";  shift 2 ;;
        --model-dir)   MODEL_DIR="$2";   shift 2 ;;
        --kubeconfig)  KUBECONFIG_PATH="$2"; shift 2 ;;
        --max-wait)    MAX_WAIT="$2";    shift 2 ;;
        --no-wait)     NO_WAIT=true;     shift ;;
        --preflight)    PREFLIGHT=true;   shift ;;
        --help)        usage ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
done

# Sequence text is data, never Python source. Validate even when another mode
# takes precedence, before authentication, cluster access or temporary files.
if $SEQUENCE_SET; then
    python3 - "$SEQUENCE" <<'PY'
import re, sys
if not re.fullmatch(r'[A-Za-z]+', sys.argv[1].strip()):
    sys.exit('Error: --sequence must contain only protein one-letter codes (ASCII letters).')
PY
fi

# Validate the entire selected operation before any HTTP or cluster command.
require_config() {
    if [[ -z "${2//[[:space:]]/}" ]]; then
        echo "Error: $1 must be explicitly configured." >&2
        exit 2
    fi
}
require_config ALPHAFOLD3_AUTH_URL "$API_AUTH"
require_config ALPHAFOLD3_TASKS_URL "$API_TASKS"
require_config ALPHAFOLD3_USERNAME "${ALPHAFOLD3_USERNAME:-}"
require_config ALPHAFOLD3_PASSWORD "${ALPHAFOLD3_PASSWORD:-}"
python3 - "$API_AUTH" "$API_TASKS" <<'PY'
import sys
from urllib.parse import urlsplit
for name, value in zip(('ALPHAFOLD3_AUTH_URL', 'ALPHAFOLD3_TASKS_URL'), sys.argv[1:]):
    try:
        url = urlsplit(value)
        valid = (url.scheme in ('http', 'https') and url.hostname and
                 not url.username and not url.password and not url.fragment and
                 not any(c.isspace() or ord(c) < 32 for c in value))
        url.port
    except ValueError:
        valid = False
    if not valid:
        sys.exit('Error: ' + name + ' must be an explicit HTTP(S) URL without embedded credentials.')
PY
require_absolute_path() {
    require_config "$1" "$2"
    if [[ "$2" != /* ]]; then
        echo "Error: $1 must be an absolute path." >&2
        exit 2
    fi
}
if ! $PREFLIGHT; then
    require_absolute_path 'ALPHAFOLD3_MODEL_DIR (or --model-dir)' "$MODEL_DIR"
fi
if $PREFLIGHT || [[ -n "$JSON_FILE$SEQUENCE$OUTPUT_DIR" ]]; then
    require_config ALPHAFOLD3_NAMESPACE "$K8S_NS"
    require_config 'ALPHAFOLD3_KUBECONFIG (or --kubeconfig)' "$KUBECONFIG_PATH"
    if [[ ! -f "$KUBECONFIG_PATH" || ! -r "$KUBECONFIG_PATH" ]]; then
        echo 'Error: ALPHAFOLD3_KUBECONFIG (or --kubeconfig) must be a readable file.' >&2
        exit 2
    fi
fi
if [[ -n "$JSON_FILE$SEQUENCE" ]]; then
    require_absolute_path ALPHAFOLD3_INPUT_BASE "$INPUT_BASE"
fi
if [[ -n "$OUTPUT_DIR" ]]; then
    require_absolute_path ALPHAFOLD3_OUTPUT_BASE "$OUTPUT_BASE"
fi

# ---- helpers ----
get_token() {
    curl -s -X POST "$API_AUTH" \
        -H "Content-Type: application/json" \
        -d "$(ALPHAFOLD3_USERNAME="$ALPHAFOLD3_USERNAME" ALPHAFOLD3_PASSWORD="$ALPHAFOLD3_PASSWORD" python3 -c 'import json,os; print(json.dumps({"username":os.environ["ALPHAFOLD3_USERNAME"],"password":os.environ["ALPHAFOLD3_PASSWORD"]}))')" \
        | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])"
}

kubectl_cmd() {
    if [[ -n "$KUBECONFIG_PATH" ]]; then
        kubectl --kubeconfig "$KUBECONFIG_PATH" "$@"
    else
        kubectl "$@"
    fi
}

get_pod_name() {
    local output
    if ! output=$(kubectl_cmd -n "$K8S_NS" get pods -l app=alphafold3 \
        -o jsonpath='{.items[0].metadata.name}' 2>&1); then
        echo "Error: failed to query alphafold3 pod in namespace $K8S_NS." >&2
        echo "$output" >&2
        return 1
    fi
    printf '%s' "$output"
}

make_tmp_json() {
    local tmp_root="${TMPDIR:-/tmp}"
    tmp_root="${tmp_root%/}"
    mktemp "$tmp_root/alphafold3_input_XXXXXX"
}

run_preflight() {
    local token_output token_status context_output pod_output
    echo -e "check\tstatus\tdetail"

    if [[ -n "${ALPHAFOLD3_PASSWORD:-}" ]]; then
        echo -e "AF3_PASSWORD\tSET\tDetected in skill environment; value not printed."
    else
        echo -e "AF3_PASSWORD\tMISSING\tSet ALPHAFOLD3_PASSWORD in $SKILL_DIR/.env or the shell environment."
        return 2
    fi

    set +e
    token_output=$(get_token 2>&1)
    token_status=$?
    set -e
    if [[ $token_status -eq 0 && -n "$token_output" ]]; then
        echo -e "AF3_HTTP_AUTH\tOK\tToken acquired; token not printed."
    else
        echo -e "AF3_HTTP_AUTH\tFAIL\tAuthentication failed; private diagnostics withheld."
    fi

    set +e
    context_output=$(kubectl_cmd config current-context 2>&1)
    local context_status=$?
    set -e
    if [[ $context_status -eq 0 && -n "$context_output" ]]; then
        echo -e "KUBECTL_CONTEXT\tOK\tExplicit context resolved; value withheld."
    else
        echo -e "KUBECTL_CONTEXT\tFAIL\tContext query failed; private diagnostics withheld."
    fi

    set +e
    pod_output=$(kubectl_cmd -n "$K8S_NS" get pods -l app=alphafold3 -o jsonpath='{.items[0].metadata.name}' --request-timeout=8s 2>&1)
    local pod_status=$?
    set -e
    if [[ $pod_status -eq 0 && -n "$pod_output" ]]; then
        echo -e "KUBECTL_POD\tOK\tPod found; name withheld."
    else
        echo -e "KUBECTL_POD\tFAIL\tPod query failed; private diagnostics withheld."
    fi

    if [[ $token_status -eq 0 ]]; then
        echo -e "TASK_QUERY_ENDPOINT\tCONFIGURED\tEndpoint supplied; task query not exercised."
    else
        echo -e "TASK_QUERY_ENDPOINT\tSKIPPED\tHTTP auth failed."
    fi

    if [[ $token_status -eq 0 && -n "$token_output" && $context_status -eq 0 && -n "$context_output" && $pod_status -eq 0 && -n "$pod_output" ]]; then
        echo -e "DATA_PLANE\tOK\tLocal JSON upload and CIF download can use kubectl cp."
        return 0
    fi
    echo -e "DATA_PLANE\tBLOCKED\tLocal JSON upload and CIF download require working kubectl credentials or a service artifact API."
    return 2
}

if $PREFLIGHT; then
    if run_preflight; then
        exit 0
    else
        exit $?
    fi
fi

# ---- use a single pre-staged PVC JSON file (Mode D) ----
if [[ -n "$REMOTE_JSON" ]]; then
    if [[ "$REMOTE_JSON" != /* ]]; then
        echo "Error: --remote-json must be an absolute PVC path such as /data/input/my_batch/input.json"
        exit 1
    fi
    if [[ "${REMOTE_JSON##*.}" != "json" ]]; then
        echo "Error: --remote-json must point to a .json file."
        exit 1
    fi
    echo "=== Using pre-staged remote input_json ==="
    echo "  $REMOTE_JSON"

# ---- use pre-staged PVC input directory (Mode C) ----
elif [[ -n "$INPUT_DIR" ]]; then
    if [[ "$INPUT_DIR" != /* ]]; then
        echo "Error: --input-dir must be an absolute PVC path such as /data/input/my_batch"
        exit 1
    fi
    echo "=== Using pre-staged input_dir ==="
    echo "  $INPUT_DIR"

# ---- generate JSON from sequence (Mode B) ----
elif [[ -n "$SEQUENCE" ]]; then
    # Sanitize task name for filesystem
    SAFE_NAME=$(echo "$TASK_NAME" | tr ' ' '_' | tr -cd '[:alnum:]_-')
    INPUT_DIR="${INPUT_BASE%/}/${SAFE_NAME}_$(date +%s)"
    
    JSON_FILE=$(make_tmp_json)
    python3 - "$SEQUENCE" "$SAFE_NAME" "$JSON_FILE" <<'PY'
import json, sys
seq = sys.argv[1].strip()
doc = {
    'name': sys.argv[2],
    'dialect': 'alphafold3',
    'version': 1,
    'modelSeeds': [1],
    'sequences': [{
        'protein': {
            'id': 'A',
            'sequence': seq,
            'unpairedMsa': '',
            'pairedMsa': '',
            'templates': []
        }
    }]
}
with open(sys.argv[3], 'w') as f:
    json.dump(doc, f, indent=2)
print(f'Generated AF3 JSON ({len(seq)} aa) → {sys.argv[3]}')
PY

    echo "=== Uploading to $INPUT_DIR ==="
    POD=$(get_pod_name)
    if [[ -z "$POD" ]]; then
        echo "Error: No alphafold3 pod found."
        exit 1
    fi
    kubectl_cmd -n "$K8S_NS" exec "$POD" -- mkdir -p "$INPUT_DIR"
    kubectl_cmd -n "$K8S_NS" cp "$JSON_FILE" "${POD}:${INPUT_DIR}/$(basename "$JSON_FILE").json"
    echo "Upload done."
    rm -f "$JSON_FILE"

elif [[ -n "$JSON_FILE" ]]; then
    # Mode A: upload local JSON
    if [[ ! -f "$JSON_FILE" ]]; then
        echo "Error: JSON file not found: $JSON_FILE"
        exit 1
    fi
    
    # Validate JSON
    if ! python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$JSON_FILE" 2>/dev/null; then
        echo "Error: Invalid JSON in $JSON_FILE"
        exit 1
    fi
    
    # Extract name for input_dir
    BASE=$(basename "$JSON_FILE" .json)
    SAFE_NAME=$(echo "$BASE" | tr ' ' '_' | tr -cd '[:alnum:]_-')
    INPUT_DIR="${INPUT_BASE%/}/${SAFE_NAME}_$(date +%s)"
    
    echo "=== Uploading to $INPUT_DIR ==="
    POD=$(get_pod_name)
    if [[ -z "$POD" ]]; then
        echo "Error: No alphafold3 pod found."
        exit 1
    fi
    kubectl_cmd -n "$K8S_NS" exec "$POD" -- mkdir -p "$INPUT_DIR"
    kubectl_cmd -n "$K8S_NS" cp "$JSON_FILE" "${POD}:${INPUT_DIR}/$(basename "$JSON_FILE")"
    echo "Upload done."
else
    echo "Error: Provide --json <file>, --sequence <seq>, --input-dir <pvc-dir>, or --remote-json <pvc-json>."
    usage
fi

# ---- auth ----
echo "=== Authenticating ==="
TOKEN=$(get_token)
echo "Token obtained."

# ---- submit ----
echo "=== Submitting fold task ==="
echo "  model_dir: $MODEL_DIR"

if [[ -n "$REMOTE_JSON" ]]; then
    echo "  input_json: $REMOTE_JSON"
    TASK_PAYLOAD=$(python3 -c 'import json,sys; print(json.dumps({"task_type":"fold","inputs":{"input_json":sys.argv[1],"model_dir":sys.argv[2]}}))' "$REMOTE_JSON" "$MODEL_DIR")
else
    echo "  input_dir: $INPUT_DIR"
    TASK_PAYLOAD=$(python3 -c 'import json,sys; print(json.dumps({"task_type":"fold","inputs":{"input_dir":sys.argv[1],"model_dir":sys.argv[2]}}))' "$INPUT_DIR" "$MODEL_DIR")
fi

TASK_RESP=$(curl -s -X POST "$API_TASKS" \
    -H "Authorization: Bearer $TOKEN" \
    -H "x-original-model: alphafold3" \
    -H "Content-Type: application/json" \
    -d "$TASK_PAYLOAD")

TASK_ID=$(echo "$TASK_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['task_id'])")
echo "Task ID: $TASK_ID"

# ---- no-wait early exit ----
if $NO_WAIT; then
    echo ""
    echo "Task submitted. Poll manually with:"
    echo "  curl -s \"${API_TASKS}/${TASK_ID}\" -H 'Authorization: Bearer ...' -H 'x-original-model: alphafold3'"
    echo ""
    echo "To download results later, explicitly configure ALPHAFOLD3_KUBECONFIG,"
    echo "ALPHAFOLD3_NAMESPACE and ALPHAFOLD3_OUTPUT_BASE; see SKILL.md."
    exit 0
fi

# ---- poll ----
echo "=== Polling status (every 60s, max ${MAX_WAIT} iterations) ==="
STATUS_RESP=""
for i in $(seq 1 "$MAX_WAIT"); do
    # Refresh token every 10 polls (~10 min)
    if (( i % 10 == 1 && i > 1 )); then
        echo "  Refreshing token..."
        TOKEN=$(get_token)
    fi

    STATUS_RESP=$(curl -s "${API_TASKS}/${TASK_ID}" \
        -H "Authorization: Bearer $TOKEN" \
        -H "x-original-model: alphafold3")

    STATUS=$(echo "$STATUS_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','?'))")
    echo "[$i] $STATUS"

    if [[ "$STATUS" == "completed" ]]; then
        echo ""
        echo "=== Task completed successfully ==="
        break
    elif [[ "$STATUS" == "failed" ]]; then
        echo ""
        echo "=== Task FAILED ==="
        ERROR=$(echo "$STATUS_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error','unknown'))" 2>/dev/null || echo "unknown")
        echo "Error: $ERROR"
        echo ""
        # Helpful diagnostics
        if echo "$ERROR" | grep -qi "missing.*MSA\|unpaired.*MSA"; then
            echo "💡 This C550 AF3 server requires 'unpairedMsa' and 'pairedMsa' fields in the protein block."
            echo "   They can be empty strings if you want the server to compute MSA automatically:"
            echo ""
            echo '   "protein": {'
            echo '     "id": "A",'
            echo '     "sequence": "...",'
            echo '     "unpairedMsa": "",'
            echo '     "pairedMsa": "",'
            echo '     "templates": []'
            echo '   }'
            echo ""
            echo "   Or use --sequence to auto-generate the correct format."
        fi
        exit 1
    fi

    sleep 60
done

# ---- download results ----
if [[ -n "$OUTPUT_DIR" ]]; then
    echo "=== Downloading results ==="
    POD=$(get_pod_name)
    if [[ -z "$POD" ]]; then
        echo "Error: Could not find running alphafold3 pod."
        echo "Check with: kubectl -n $K8S_NS get pods -l app=alphafold3"
        exit 1
    fi
    echo "  Pod: $POD"

    mkdir -p "$OUTPUT_DIR"
    STATUS_OUTPUT_PATH=$(echo "$STATUS_RESP" | python3 -c "
import json, sys
try:
    resp = json.load(sys.stdin)
except Exception:
    print('')
    raise SystemExit
outputs = resp.get('outputs') or {}
paths = []
if isinstance(outputs, dict):
    for key in ('output_path', 'cif', 'cif_path', 'file', 'path'):
        value = outputs.get(key)
        if isinstance(value, str) and value.endswith('.cif'):
            paths.append(value)
for key in ('output_path', 'cif_path'):
    value = resp.get(key)
    if isinstance(value, str) and value.endswith('.cif'):
        paths.append(value)
print(paths[0] if paths else '')
" 2>/dev/null || true)

    CANDIDATE_REMOTE_FILES=()
    if [[ -n "$STATUS_OUTPUT_PATH" ]]; then
        CANDIDATE_REMOTE_FILES+=("$STATUS_OUTPUT_PATH")
    fi
    CANDIDATE_REMOTE_FILES+=("${OUTPUT_BASE%/}/${TASK_ID}.cif")

    REMOTE_FILE=""
    for CANDIDATE in "${CANDIDATE_REMOTE_FILES[@]}"; do
        if kubectl_cmd -n "$K8S_NS" exec "$POD" -- test -f "$CANDIDATE" 2>/dev/null; then
            REMOTE_FILE="$CANDIDATE"
            break
        fi
    done

    if [[ -z "$REMOTE_FILE" ]]; then
        echo "  Warning: no CIF found at task-reported or fallback paths. Listing available outputs..."
        kubectl_cmd -n "$K8S_NS" exec "$POD" -- ls "$OUTPUT_BASE/" 2>/dev/null | grep -i "$TASK_ID" || true
        exit 1
    fi

    LOCAL_FILE="${OUTPUT_DIR}/${TASK_ID}.cif"
    echo "  Remote file: $REMOTE_FILE"
    kubectl_cmd -n "$K8S_NS" cp "${POD}:${REMOTE_FILE}" "$LOCAL_FILE" 2>/dev/null

    FILE_SIZE=$(ls -lh "$LOCAL_FILE" 2>/dev/null | awk '{print $5}' || echo "?")
    echo "  Downloaded: $LOCAL_FILE ($FILE_SIZE)"

    # Show preview
    echo ""
    echo "=== Structure Preview ==="
    head -40 "$LOCAL_FILE"
    echo "  ... (use PyMOL/ChimeraX to view full structure)"
    echo ""
    echo "=== Summary ==="
    python3 - "$LOCAL_FILE" <<'PY'
import sys
with open(sys.argv[1]) as f:
    content = f.read()
atoms = content.count('ATOM')
hetatm = content.count('HETATM')
chains = set()
for line in content.split('\n'):
    if line.startswith('ATOM') or line.startswith('HETATM'):
        parts = line.split()
        if len(parts) > 6:
            chains.add(parts[6] if len(parts) > 10 else parts[5])
print(f'  Atoms: {atoms} (ATOM) + {hetatm} (HETATM)')
print(f'  Chains: {" ".join(sorted(chains)) if chains else "N/A"}')
print(f'  File: {len(content):,} bytes')
PY
fi

echo ""
echo "Done. Task ID: $TASK_ID"
