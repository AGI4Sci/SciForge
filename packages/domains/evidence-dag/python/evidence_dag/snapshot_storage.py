"""Content-addressed persistence for exact immutable Evidence Snapshots.

Snapshot payloads are large, append-heavy PROV documents.  Persisting every
version as another complete JSON file makes a one-node update cost the size of
the whole graph.  This module stores content-defined chunks once and commits a
small immutable manifest for each snapshot.  Chunk boundaries recover after a
local edit, so unchanged suffixes keep their existing content addresses.

Legacy full-PROV files remain readable.  This is required for existing user
data; new writes use only the chunked format.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import zlib
from .secure_storage import EvidenceStorage
from typing import Any, Iterator


FORMAT = "sciforge.evidence-snapshot.chunked.v1"
_BLOB_DIRECTORY = os.path.join("snapshot-blobs", "v1", "sha256")
_DIGEST_RE = re.compile(r"^[0-9a-f]{64}$")
_MIN_CHUNK_BYTES = 256 * 1024
_MAX_CHUNK_BYTES = 2 * 1024 * 1024


def _atomic_write_bytes(path: str, content: bytes, *, storage: EvidenceStorage) -> None:
    storage.atomic_write(path, content)


def _content_defined_chunks(content: str) -> Iterator[bytes]:
    """Yield locally stable chunks at JSON line boundaries.

    CRC32 is implemented in C and keeps this linear scan inexpensive even for
    graphs hundreds of megabytes large.  A local insertion can perturb only
    the current chunk: a later content-derived line boundary resynchronises the
    unchanged suffix.  Very large individual JSON lines are split at the hard
    limit so hostile input cannot create unbounded blobs.
    """
    buffered = bytearray()
    start = 0
    while start < len(content):
        newline = content.find("\n", start)
        end = len(content) if newline < 0 else newline + 1
        line = content[start:end].encode("utf-8")
        start = end
        offset = 0
        while offset < len(line):
            capacity = _MAX_CHUNK_BYTES - len(buffered)
            taken = line[offset:offset + capacity]
            buffered.extend(taken)
            offset += len(taken)
            if len(buffered) >= _MAX_CHUNK_BYTES:
                yield bytes(buffered)
                buffered.clear()
        if (
            len(buffered) >= _MIN_CHUNK_BYTES
            and (zlib.crc32(line) & 0x0F) == 0
        ):
            yield bytes(buffered)
            buffered.clear()
    if buffered:
        yield bytes(buffered)
    elif not content:
        yield b""


def _blob_path(storage_dir: str, digest: str) -> str:
    if not _DIGEST_RE.fullmatch(digest):
        raise ValueError("invalid Evidence Snapshot chunk digest")
    return os.path.join(storage_dir, _BLOB_DIRECTORY, digest[:2], digest)


def _manifest(size: int, payload_digest: str, chunks: list[dict[str, Any]]) -> bytes:
    document = {
        "format": FORMAT,
        "encoding": "utf-8",
        "size": size,
        "sha256": payload_digest,
        "chunks": chunks,
    }
    return (json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def write_snapshot(path: str, content: str, *, storage_dir: str, storage: EvidenceStorage | None = None) -> None:
    """Atomically commit an immutable chunk manifest at ``path``."""
    storage = storage or EvidenceStorage(storage_dir)
    records: list[dict[str, Any]] = []
    payload_hash = hashlib.sha256()
    payload_size = 0
    for chunk in _content_defined_chunks(content):
        payload_hash.update(chunk)
        payload_size += len(chunk)
        digest = hashlib.sha256(chunk).hexdigest()
        blob_path = _blob_path(storage_dir, digest)
        if os.path.exists(blob_path):
            with storage.open(blob_path, "rb") as handle:
                stored = handle.read()
            if stored != chunk:
                raise RuntimeError("Evidence Snapshot chunk collision")
        else:
            _atomic_write_bytes(blob_path, chunk, storage=storage)
        records.append({"sha256": digest, "size": len(chunk)})
    _atomic_write_bytes(path, _manifest(payload_size, payload_hash.hexdigest(), records), storage=storage)


def _parse_manifest(raw: bytes) -> dict[str, Any] | None:
    # Full legacy PROV documents are JSON too.  Only the explicit format marker
    # activates indirection; all other content is returned verbatim.
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(value, dict) or value.get("format") != FORMAT:
        return None
    return value


def read_snapshot_bytes(path: str, *, storage_dir: str) -> bytes:
    storage = EvidenceStorage(storage_dir)
    _migrate_legacy_aliases(path, storage=storage)
    with storage.open(path, "rb") as handle:
        raw = handle.read()
    return _decode_snapshot(raw, storage=storage)


def _decode_snapshot(raw: bytes, *, storage: EvidenceStorage) -> bytes:
    storage_dir = storage.root
    manifest = _parse_manifest(raw)
    if manifest is None:
        return raw
    if manifest.get("encoding") != "utf-8":
        raise ValueError("unsupported Evidence Snapshot manifest encoding")
    chunks = manifest.get("chunks")
    expected_size = manifest.get("size")
    expected_digest = manifest.get("sha256")
    if (
        not isinstance(chunks, list)
        or not isinstance(expected_size, int)
        or expected_size < 0
        or not isinstance(expected_digest, str)
        or not _DIGEST_RE.fullmatch(expected_digest)
    ):
        raise ValueError("invalid Evidence Snapshot manifest")
    output = bytearray()
    for record in chunks:
        if not isinstance(record, dict):
            raise ValueError("invalid Evidence Snapshot chunk record")
        digest = record.get("sha256")
        size = record.get("size")
        if (
            not isinstance(digest, str)
            or not _DIGEST_RE.fullmatch(digest)
            or not isinstance(size, int)
            or size < 0
            or size > _MAX_CHUNK_BYTES
        ):
            raise ValueError("invalid Evidence Snapshot chunk record")
        with storage.open(_blob_path(storage_dir, digest), "rb") as handle:
            chunk = handle.read()
        if len(chunk) != size or hashlib.sha256(chunk).hexdigest() != digest:
            raise ValueError("Evidence Snapshot chunk integrity mismatch")
        output.extend(chunk)
        if len(output) > expected_size:
            raise ValueError("Evidence Snapshot manifest size mismatch")
    result = bytes(output)
    if len(result) != expected_size or hashlib.sha256(result).hexdigest() != expected_digest:
        raise ValueError("Evidence Snapshot payload integrity mismatch")
    return result


def _migrate_legacy_aliases(path: str, *, storage: EvidenceStorage) -> None:
    """Split only the exact verified latest/history pair emitted before v1.

    This is not a relaxed storage.open: all other hardlinks remain forbidden.
    Link count two plus the two canonical names proves the complete alias set.
    Never chmod the shared inode before proving that set (it may be external).
    """
    import stat
    import uuid
    from contextlib import ExitStack
    from . import provjson
    from .snapshot import EvidenceSnapshot, snapshot_filename, snapshot_storage_key
    from .service import Engine

    path = os.path.abspath(path)
    if storage.stat(path).st_nlink == 1:
        return  # strict open below validates owner, type and file identity
    with storage.directory(os.path.dirname(path)) as parent:
        info = storage.stat_at(parent, os.path.basename(path))
        if info.st_nlink == 1:
            return  # normal strict open still checks owner/type/no-follow
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 2:
            raise PermissionError('unrecognized Evidence Snapshot hardlink')
        fd = storage.open_alias_at(parent, os.path.basename(path))
        with os.fdopen(fd, 'rb') as handle:
            opened = os.fstat(handle.fileno())
            if opened != info:
                raise PermissionError('Evidence Snapshot alias changed')
            raw = handle.read()
        graph = provjson.loads(_decode_snapshot(raw, storage=storage).decode('utf-8'))
        envelope = EvidenceSnapshot.from_dict((graph.meta or {}).get('snapshot') or {})
        snapshot = Engine._verified_snapshot(graph, thread_id=envelope.thread_id)
        latest = os.path.join(storage.root, snapshot_filename(snapshot.thread_id))
        immutable = os.path.join(storage.root, 'snapshots', snapshot_storage_key(snapshot.thread_id),
                                 f'{snapshot.version:08d}-{snapshot.digest[7:]}.prov.json')
        if path not in (latest, immutable):
            raise PermissionError('noncanonical Evidence Snapshot alias')
        with ExitStack() as stack:
            parents = [stack.enter_context(storage.directory(os.path.dirname(p))) for p in (latest, immutable)]
            names = [os.path.basename(p) for p in (latest, immutable)]

            def verify_pair():
                for directory, name in zip(parents, names):
                    current = storage.stat_at(directory, name)
                    if (not stat.S_ISREG(current.st_mode)
                            or current.st_nlink != 2 or (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino)
                            or current.st_size != info.st_size or current.st_mtime_ns != info.st_mtime_ns):
                        raise PermissionError('incomplete or changed Evidence Snapshot alias pair')

            def cleanup_torn_publish_residue():
                """Remove only a crashed pre-v1 publish residue: a canonical-named
                ``.<32 hex>.tmp`` hardlink of THIS verified inode. Anything else
                (foreign content, noncanonical links, changed pairs) still raises.
                """
                removed = False
                for directory, canonical in zip(parents, names):
                    prefix = canonical + '.'
                    for entry in storage.list_at(directory):
                        middle = entry[len(prefix):-4] if entry.startswith(prefix) and entry.endswith('.tmp') else ''
                        if len(middle) != 32 or any(char not in '0123456789abcdef' for char in middle):
                            continue
                        try:
                            current = storage.stat_at(directory, entry)
                        except FileNotFoundError:
                            continue
                        if (not stat.S_ISREG(current.st_mode)
                                or (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino)):
                            continue
                        storage.unlink_at(directory, entry)
                        storage.sync_at(directory)
                        removed = True
                return removed

            try:
                verify_pair()
            except PermissionError:
                # A pre-v1 publish killed between os.link and os.replace left the
                # new immutable hardlinked to an orphan tmp while latest still
                # aliases the previous version. Only that exact residue of the
                # verified inode is collected; every other shape stays fail-closed.
                if not cleanup_torn_publish_residue():
                    raise
                recovered = storage.stat_at(parent, os.path.basename(path))
                if recovered.st_nlink != 1:
                    raise
                return  # torn residue removed; the normal strict open proceeds

            # Stage an independent private file; replace only after all identity,
            # payload/chunk and canonical-envelope checks have completed.
            temporary = names[0] + '.' + uuid.uuid4().hex + '.tmp'
            try:
                fd = storage.create_at(parents[0], temporary)
                with os.fdopen(fd, 'wb') as handle:
                    handle.write(raw)
                    handle.flush()
                    os.fsync(handle.fileno())
                verify_pair()
                storage.replace_at(parents[0], temporary, parents[0], names[0])
                storage.sync_at(parents[0])
            finally:
                try:
                    storage.unlink_at(parents[0], temporary)
                except FileNotFoundError:
                    pass
            # The sole remaining alias is now subject to the normal nlink==1
            # writer. Interrupted migration is safe and readable on retry.
            storage.atomic_write(immutable, raw)


def read_snapshot_text(path: str, *, storage_dir: str) -> str:
    return read_snapshot_bytes(path, storage_dir=storage_dir).decode("utf-8")


def read_snapshot_json(path: str, *, storage_dir: str) -> dict[str, Any]:
    value = json.loads(read_snapshot_text(path, storage_dir=storage_dir))
    if not isinstance(value, dict):
        raise ValueError("Evidence Snapshot document must be an object")
    return value


def atomic_publish_latest(immutable_path: str, latest_path: str) -> None:
    """Publish an independent 0600 manifest, never a hardlink alias."""
    storage = EvidenceStorage(os.path.dirname(latest_path))
    with storage.open(immutable_path, "rb") as handle:
        storage.atomic_write(latest_path, handle.read())
