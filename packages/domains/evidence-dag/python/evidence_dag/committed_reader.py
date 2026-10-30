"""Finite descriptor-only committed reader. No Engine, writer, migration or reasoner."""
from __future__ import annotations

import json
import os
import re
import stat
from contextlib import contextmanager
from typing import Any, cast

from . import provjson
from .access import require_unrestricted
from .snapshot import EvidenceSnapshot, compute_snapshot_digest, snapshot_artifact_digests, snapshot_storage_key
from .snapshot_storage import _decode_snapshot

_LIMIT = 64 * 1024 * 1024


def _parent_binding(request):
    """Windows does not expose the Node parent PID through Python reliably.

    The child is already admitted by the host using an absolute interpreter and
    hash-pinned wheel. Keep the request binding in the response on Windows;
    retain the OS parent check for descriptor-based POSIX reads.
    """
    expected = request['parent']
    if os.name != 'nt' and expected != os.getppid():
        raise PermissionError('parent mismatch')
    return expected


class DescriptorReader:
    # A virtual prefix used only by the chunk decoder; never reopened by pathname.
    root = '/descriptor'

    @contextmanager
    def directory(self, relative):
        fd = os.dup(3)
        try:
            for part in relative.split('/'):
                if part in ('', '.'):
                    continue
                if part == '..':
                    raise ValueError('invalid relative storage path')
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd)
                fd = child
                info = os.fstat(fd)
                if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
                    raise PermissionError('untrusted storage directory')
            yield fd
        finally:
            os.close(fd)

    @contextmanager
    def open(self, path, mode):
        if mode != 'rb' or not path.startswith(self.root + '/'):
            raise PermissionError('readonly descriptor path required')
        relative = path[len(self.root) + 1:]
        parent, name = relative.rsplit('/', 1)
        with self.directory(parent) as directory:
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
            try:
                info = os.fstat(fd)
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid() or info.st_size > _LIMIT:
                    raise PermissionError('untrusted snapshot storage file')
                with os.fdopen(fd, 'rb', closefd=False) as handle:
                    yield handle
            finally:
                os.close(fd)


def _windows_storage(root):
    if not isinstance(root, str) or not os.path.isabs(root):
        raise PermissionError('untrusted Windows storage root')
    # Validate every ancestor by a no-follow handle. Committed reads must not
    # initialize storage or alter existing permissions.
    from .windows_secure_storage import WindowsEvidenceStorage
    return WindowsEvidenceStorage(root, readonly=True)


def _read_windows_snapshot(request):
    storage = _windows_storage(request.get('storageRoot'))
    digest = request['digest']
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', digest):
        raise ValueError('invalid snapshot digest')
    thread = request['threadId']
    directory = os.path.join(storage.root, 'snapshots', snapshot_storage_key(thread))
    try:
        names = storage.listdir(directory)
    except FileNotFoundError:
        raise ValueError('immutable snapshot not found or ambiguous')
    matches = [name for name in names if re.fullmatch(r'[0-9]+-' + digest[7:] + r'\.prov\.json', name)]
    if len(matches) != 1:
        raise ValueError('immutable snapshot not found or ambiguous')
    path = os.path.join(directory, matches[0])
    with storage.open(path, 'rb') as handle:
        raw = handle.read(_LIMIT + 1)
    if len(raw) > _LIMIT:
        raise ValueError('snapshot exceeds reader limit')
    manifest = json.loads(raw)
    if manifest.get('format') == 'sciforge.evidence-snapshot.chunked.v1' and (not isinstance(manifest.get('size'), int) or not 0 <= manifest['size'] <= _LIMIT):
        raise ValueError('snapshot manifest exceeds reader limit')
    content = _decode_snapshot(raw, storage=storage)
    graph = provjson.loads(content.decode('utf-8'))
    snapshot = EvidenceSnapshot.from_dict((graph.meta or {}).get('snapshot') or {})
    if snapshot.thread_id != thread or snapshot.digest != digest:
        raise ValueError('snapshot identity mismatch')
    actual = compute_snapshot_digest(graph, input_watermark=snapshot.input_watermark, schema_version=snapshot.schema_version,
                                     extractor_version=snapshot.extractor_version, verifier_version=snapshot.verifier_version)
    if actual != digest or tuple(snapshot_artifact_digests(graph)) != snapshot.artifact_digests:
        raise ValueError('snapshot digest or artifact metadata mismatch')
    require_unrestricted(graph, 'committed snapshot')
    return {'requestId': request['requestId'], 'parent': request['parent'], 'pid': os.getpid(), 'snapshot': snapshot.to_dict(), 'graph': graph.to_dict()}


def read_chain():
    request = json.load(__import__('sys').stdin)
    parent = _parent_binding(request)
    try:
        storage = _windows_storage(request.get('storageRoot'))
        path = os.path.join(storage.root, 'deltas.json')
        with storage.open(path, 'rb') as handle:
            raw = handle.read(_LIMIT + 1)
    except FileNotFoundError:
        raw = None
    if raw is not None and len(raw) > _LIMIT:
        raise ValueError('Evidence delta chain exceeds reader limit')
    text = None if raw is None else raw.decode('utf-8')
    json.dump({'id': request['id'], 'parent': parent, 'pid': os.getpid(), 'text': text}, __import__('sys').stdout, ensure_ascii=True)


def main():
    request = json.load(__import__('sys').stdin)
    parent = _parent_binding(request)
    if os.name == 'nt':
        json.dump(_read_windows_snapshot(request), __import__('sys').stdout)
        return
    info = os.fstat(3)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
        raise PermissionError('untrusted storage descriptor')
    digest = request['digest']
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', digest):
        raise ValueError('invalid snapshot digest')
    thread = request['threadId']
    directory = 'snapshots/' + snapshot_storage_key(thread)
    reader = DescriptorReader()
    with reader.directory(directory) as fd:
        matches = [name for name in os.listdir(fd) if re.fullmatch(r'[0-9]+-' + digest[7:] + r'\.prov\.json', name)]
    if len(matches) != 1:
        raise ValueError('immutable snapshot not found or ambiguous')
    path = reader.root + '/' + directory + '/' + matches[0]
    with reader.open(path, 'rb') as handle:
        raw = handle.read(_LIMIT + 1)
        if len(raw) > _LIMIT:
            raise ValueError('snapshot exceeds reader limit')
        manifest = json.loads(raw)
        if manifest.get('format') == 'sciforge.evidence-snapshot.chunked.v1' and (not isinstance(manifest.get('size'), int) or not 0 <= manifest['size'] <= _LIMIT):
            raise ValueError('snapshot manifest exceeds reader limit')
        content = _decode_snapshot(raw, storage=cast(Any, reader))
    graph = provjson.loads(content.decode('utf-8'))
    snapshot = EvidenceSnapshot.from_dict((graph.meta or {}).get('snapshot') or {})
    if snapshot.thread_id != thread or snapshot.digest != digest:
        raise ValueError('snapshot identity mismatch')
    actual = compute_snapshot_digest(graph, input_watermark=snapshot.input_watermark, schema_version=snapshot.schema_version,
                                     extractor_version=snapshot.extractor_version, verifier_version=snapshot.verifier_version)
    if actual != digest or tuple(snapshot_artifact_digests(graph)) != snapshot.artifact_digests:
        raise ValueError('snapshot digest or artifact metadata mismatch')
    require_unrestricted(graph, 'committed snapshot')
    json.dump({'requestId': request['requestId'], 'parent': parent, 'pid': os.getpid(), 'snapshot': snapshot.to_dict(), 'graph': graph.to_dict()}, __import__('sys').stdout, ensure_ascii=True)
