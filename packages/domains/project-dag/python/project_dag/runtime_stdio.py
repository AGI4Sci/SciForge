"""Restricted Project-owned stdio adapter over the canonical Engine.

Not a DSH runner. The caller supplies an approved Python environment, one Project
DB and a read-only shared Evidence directory. No raw trace/model/network access.
"""
from __future__ import annotations

import argparse
import json
import os
import select
import sys
import time
from urllib.parse import parse_qs, urlsplit

from .service import Engine


class NoModel:
    def __call__(self, *_args, **_kwargs):
        raise RuntimeError('Model operations are not granted to the Project sidecar')

    def warm_many(self, *_args, **_kwargs):
        raise RuntimeError('Model operations are not granted to the Project sidecar')


def dispatch(engine: Engine, request: dict, workspace: str):
    if not isinstance(request, dict) or set(request) - {'id', 'route', 'method', 'body'}:
        raise ValueError('Invalid Project request envelope')
    if 'id' not in request or 'route' not in request or 'method' not in request:
        # Refuse before any side effect: a write must never be executed and
        # only then reported as failed with an unattributable id=null error.
        raise ValueError('Invalid Project request envelope')
    route = urlsplit(request['route'])
    if route.scheme or route.netloc or route.fragment:
        raise ValueError('Only relative Project routes are supported')
    method = request['method']
    body = request.get('body') or {}
    if not isinstance(body, dict):
        raise ValueError('Project body must be an object')
    query = {key: values[0] for key, values in parse_qs(route.query).items()}
    routing = body if method == 'POST' else query
    requested = routing.get('workspaceRoot') or routing.get('projectRoot')
    if not isinstance(requested, str) or os.path.abspath(requested) != workspace:
        raise PermissionError('Project workspace is not the Host-bound workspace')
    if routing.get('projectRoot') and os.path.abspath(routing['projectRoot']) != workspace:
        raise PermissionError('Project root is outside the Host-bound workspace')
    key = engine.project_key(workspace, routing.get('projectRoot'), routing.get('project'))
    if (method, route.path) == ('POST', '/updates'):
        allowed = {'workspaceRoot', 'projectRoot', 'project', 'reason', 'priority',
                   'autonomyMode', 'evidenceVector', 'capturedScope'}
        if set(body) - allowed:
            raise ValueError('Unknown Project update fields')
        return engine.enqueue_update({
            'projectKey': key,
            **{field: value for field, value in body.items() if field in engine.UPDATE_FIELDS},
        })
    if (method, route.path) == ('GET', '/updates/status'):
        return engine.update_status(key)
    if (method, route.path) == ('POST', '/updates/open'):
        return engine.derive_on_open(key)
    if (method, route.path) == ('POST', '/goals/draft'):
        return engine.save_goal_draft(body)
    if (method, route.path) == ('GET', '/goals/draft'):
        return engine.goal_draft(key)
    if (method, route.path) == ('POST', '/goals/apply'):
        return engine.apply_goal_draft(body)
    if (method, route.path) == ('GET', '/goals'):
        return engine.goal_tree(key)
    if (method, route.path) == ('POST', '/invalidation'):
        # Ignore any plugin-supplied projectKey; authority comes from routing.
        return engine.mark_invalidation({**body, 'projectKey': key})
    raise ValueError('Unsupported Project operation')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', required=True)
    parser.add_argument('--evidence', required=True)
    parser.add_argument('--workspace', required=True)
    args = parser.parse_args()
    workspace = os.path.abspath(args.workspace)
    engine = Engine(args.db, args.evidence, judge=NoModel())
    try:
        # One actor owns both commands and the canonical pump. Raw buffered
        # reads avoid TextIO prefetch hiding commands from select(), and no
        # background reader can steal input from a compiler/reasoning exchange.
        pending = b''
        eof = False
        while not eof or pending:
            pump_updates(engine)
            if b'\n' in pending or (eof and pending):
                line, separator, pending = pending.partition(b'\n')
                respond(engine, line, workspace)
                continue
            if select.select([sys.stdin], [], [], 0.2)[0]:
                chunk = os.read(sys.stdin.fileno(), 65536)
                if chunk:
                    pending += chunk
                else:
                    eof = True
        # Finish all accepted queue work, including already scheduled retries.
        # The owning process adapter bounds this drain and reports forced exit;
        # retry/terminal failures remain in the canonical durable job/receipt.
        while engine.store.q1("SELECT id FROM project_update_job"
                              " WHERE status IN ('queued','running','retry_scheduled') LIMIT 1"):
            if not pump_updates(engine):
                time.sleep(0.2)
    finally:
        engine.store.conn.close()


def pump_updates(engine: Engine) -> bool:
    try:
        return engine.process_updates() is not None
    except Exception as error:
        print('Project compile failed: '+str(error), file=sys.stderr, flush=True)
        return False


def respond(engine: Engine, line: bytes, workspace: str) -> None:
    request = None
    try:
        request = json.loads(line)
        value = dispatch(engine, request, workspace)
        response = {'id': request['id'], 'ok': True, 'data': value}
    except Exception as error:
        response = {'id': request.get('id') if isinstance(request, dict) else None,
                    'ok': False, 'error': {'name': type(error).__name__, 'message': str(error)}}
    # Durable acknowledgement is written before the next compilation attempt.
    print(json.dumps(response, allow_nan=False), flush=True)


if __name__ == '__main__':
    main()
