"""Package-owned serial stdio adapter for an approved, wheel-only executor.
Only JSON requests/results and text-reasoning requests cross the boundary.
No environment credentials, HTTP model client, or adjacent source imports.
"""
from __future__ import annotations
import json
import os
import sys
from threading import Lock
from .service import Engine
from . import provjson
from .access import require_unrestricted

MAX_LINE = 64 * 1024 * 1024

def emit(value):
    # Escape non-ASCII protocol payloads so the Windows console code page
    # cannot corrupt or reject a response containing model/user text.
    sys.stdout.write(json.dumps(value, ensure_ascii=True, separators=(',', ':')) + '\n')
    sys.stdout.flush()

def read_bounded_line(stream):
    """Read one protocol line, draining an oversized frame to its newline.

    Returns None for an oversized frame: exactly one error is emitted per
    frame and the discarded remainder can never be parsed as a new request,
    so request/response pairing stays one-to-one. Returns '' at EOF.
    """
    line = stream.readline(MAX_LINE + 1)
    if len(line) <= MAX_LINE:
        return line
    while line and not line.endswith('\n'):
        line = stream.readline(MAX_LINE + 1)
    return None

class PortLLM:
    def __init__(self):
        self.sequence = 0
        self._exchange_lock = Lock()

    def chat(self, messages, *, temperature=0.0, max_tokens=2048):
        # Verifier/reviewer pools share this serial stdio transport. Own the
        # whole exchange, not just emit/read separately: another thread must
        # never consume a response belonging to this request. Correlation is
        # transport-owned; model text remains an opaque, untrusted value.
        with self._exchange_lock:
            self.sequence += 1
            request_id = 'reason-' + str(self.sequence)
            emit({'type': 'reason', 'id': request_id, 'input': {'messages': messages, 'temperature': temperature, 'maxTokens': max_tokens}})
            line = read_bounded_line(sys.stdin)
            if line is None:
                raise ValueError('Reasoner response exceeds the protocol limit')
            response = json.loads(line)
            if response.get('type') != 'reason-result' or response.get('id') != request_id:
                raise ValueError('Reasoner response identity mismatch')
            if response.get('ok') is not True or not isinstance(response.get('value'), str):
                raise RuntimeError(response.get('error', {}).get('message', 'Approved reasoning port failed'))
            return response['value']

def main():
    engine = Engine(PortLLM(), storage_dir=sys.argv[2])
    for line in iter(lambda: read_bounded_line(sys.stdin), ''):
        request = None
        try:
            if line is None:
                raise ValueError('Request exceeds the protocol limit')
            request = json.loads(line)
            if request.get('type') != 'request':
                raise ValueError('Expected request')
            operation, value = request['operation'], request['input']
            if operation in ('extract', 'commitSnapshot'):
                result = engine.update(thread_id=value['threadId'], target_watermark=value['targetWatermark'], reason='manual' if operation == 'extract' else 'seal_closure', priority='immediate', trace=value['trace'], workspace_root=value['workspaceRoot'], idempotency_key=value['idempotencyKey'])
                if result.get('snapshot') is None:
                    raise RuntimeError('Evidence update did not commit: ' + json.dumps(result, ensure_ascii=False))
                graph, _snapshot = engine.snapshot_graph(value['threadId'], result['snapshot']['digest'])
                require_unrestricted(graph, 'Canonical Evidence graph')
                result = engine.update_result_view(value['threadId'], result)
                # Exact canonical graph for the immutable Host delta. Never
                # reconstruct IDs from the rendered document or model tmp_ids.
                result['graph'] = graph.to_dict()
            elif operation in ('readSnapshot', 'snapshotProducts'):
                graph, snapshot = engine.snapshot_graph(value['threadId'], value['snapshotDigest'])
                workspace = graph.meta.get('scope', {}).get('workspaceRoot')
                if not workspace or os.path.realpath(workspace) != os.path.realpath(value['workspaceRoot']):
                    raise ValueError('Committed Evidence workspace mismatch')
                # These consumers require the complete canonical graph and its
                # original digest: a partial projection cannot represent it.
                require_unrestricted(graph, 'Canonical Evidence Snapshot')
                result = engine.export_snapshot_products(value['threadId'], snapshot_digest=value['snapshotDigest'], datacite_metadata=value['datacite']) \
                    if operation == 'snapshotProducts' else {'snapshot': snapshot.to_dict(), 'document': provjson.dumps(graph), 'graph': graph.to_dict()}
            else:
                raise ValueError('Unsupported Evidence worker operation: ' + str(operation))
            emit({'type': 'response', 'id': request['id'], 'ok': True, 'value': result})
        except Exception as error:
            emit({'type': 'response', 'id': request.get('id') if isinstance(request, dict) else None, 'ok': False, 'error': {'code': type(error).__name__, 'message': str(error)}})

if __name__ == '__main__':
    main()
