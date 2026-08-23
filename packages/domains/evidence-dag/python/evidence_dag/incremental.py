"""Incremental trace staging isolated from immutable Evidence Snapshots.

Committed graphs carry only a small recent-anchor list and the digest of a
content-addressed history index. Full provisional batches and provisional graphs
live below ``staging/`` and are never returned by the committed graph readers.
"""
from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
import re
import uuid
from typing import Any, Optional

from . import provjson
from .graph import ThreadGraph


TRACE_INGESTION_VERSION = 1
RECENT_ANCHOR_LIMIT = 64


_BATCH_WATERMARK = re.compile(r":batch:(\d+)/(\d+)$")
_LEADING_WATERMARK = re.compile(r"^(\d+)(?::(.*))?$")
_TIMESTAMP_WATERMARK = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})"
    r"(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$"
)


def compare_watermarks(left: str, right: str) -> Optional[int]:
    """Compare only watermark orders whose Evidence coverage can be proven."""
    normalized_left = str(left).strip()
    normalized_right = str(right).strip()
    if not normalized_left or not normalized_right:
        return None
    if normalized_left == normalized_right:
        return 0
    parsed_left = _parse_watermark(normalized_left)
    parsed_right = _parse_watermark(normalized_right)
    if parsed_left is None or parsed_right is None or parsed_left[0] != parsed_right[0]:
        return None
    (
        _family, left_sequence, left_sub_num, left_sub_den,
        left_discriminator, left_num, left_den,
    ) = parsed_left
    (
        _, right_sequence, right_sub_num, right_sub_den,
        right_discriminator, right_num, right_den,
    ) = parsed_right
    if left_sequence != right_sequence:
        return -1 if left_sequence < right_sequence else 1
    left_subsecond = left_sub_num * right_sub_den
    right_subsecond = right_sub_num * left_sub_den
    if left_subsecond != right_subsecond:
        return -1 if left_subsecond < right_subsecond else 1
    if left_discriminator != right_discriminator:
        return None
    left_progress = left_num * right_den
    right_progress = right_num * left_den
    return -1 if left_progress < right_progress else 1 if left_progress > right_progress else 0


def watermark_regresses(current: str, target: str) -> bool:
    return compare_watermarks(str(target).strip(), str(current).strip()) == -1


def _parse_watermark(
    value: Any,
) -> Optional[tuple[str, int, int, int, str, int, int]]:
    text = str(value).strip()
    if not text:
        return None
    batch = _BATCH_WATERMARK.search(text)
    base = text[:batch.start()] if batch else text
    numerator = int(batch.group(1)) if batch else 1
    denominator = int(batch.group(2)) if batch else 1
    if numerator < 1 or denominator < 1 or numerator > denominator:
        return None
    if ":artifact-lifecycle" in base:
        return (
            f"artifact-lifecycle:{base}", 0, 0, 1, "", numerator, denominator,
        )
    leading = _LEADING_WATERMARK.fullmatch(base)
    if leading:
        return (
            "leading-sequence", int(leading.group(1)), 0, 1,
            leading.group(2) or "", numerator, denominator,
        )
    timestamp = _parse_timestamp(base)
    if timestamp:
        epoch_seconds, subsecond_numerator, subsecond_denominator = timestamp
        return (
            "timestamp", epoch_seconds, subsecond_numerator,
            subsecond_denominator, "", numerator, denominator,
        )
    return (f"opaque:{base}", 0, 0, 1, "", numerator, denominator)


def _parse_timestamp(value: str) -> Optional[tuple[int, int, int]]:
    match = _TIMESTAMP_WATERMARK.fullmatch(value)
    if match is None or len(match.group(7) or "") > 512:
        return None
    year, month, day, hour, minute, second = (
        int(match.group(index)) for index in range(1, 7)
    )
    offset_hour = int(match.group(10) or 0)
    offset_minute = int(match.group(11) or 0)
    if year < 1 or offset_hour > 23 or offset_minute > 59:
        return None
    try:
        if match.group(8) == "Z":
            zone = timezone.utc
        else:
            direction = -1 if match.group(9) == "-" else 1
            zone = timezone(direction * timedelta(hours=offset_hour, minutes=offset_minute))
        instant = datetime(year, month, day, hour, minute, second, tzinfo=zone)
        utc = instant.astimezone(timezone.utc)
        epoch_seconds = calendar.timegm(utc.utctimetuple())
    except (ValueError, OverflowError):
        return None
    fraction = match.group(7) or ""
    return (
        epoch_seconds,
        int(fraction) if fraction else 0,
        10 ** len(fraction) if fraction else 1,
    )


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")


def _digest(value: Any) -> str:
    return "sha256:" + hashlib.sha256(_canonical_bytes(value)).hexdigest()


def _safe_key(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9._-]", "_", value)[:80] or "scope"
    suffix = hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]
    return f"{slug}-{suffix}"


def _trace_key(item: dict[str, Any], digest: str) -> str:
    for field in ("id", "step_id", "stepId", "source_item_id", "sourceItemId"):
        value = str(item.get(field) or "").strip()
        if value:
            return f"id:{value}"
    return f"content:{digest}"


@dataclass(frozen=True)
class StagedTrace:
    thread_id: str
    base_watermark: Optional[str]
    target_watermark: str
    trace: tuple[dict[str, Any], ...]
    item_entries: tuple[dict[str, str], ...]
    prior_history: tuple[dict[str, str], ...]
    prior_anchors: tuple[dict[str, str], ...]
    batch_digest: Optional[str]
    input_count: int
    skipped_count: int
    rebuild: bool

    @property
    def new_count(self) -> int:
        return len(self.trace)

    def summary(self) -> dict[str, Any]:
        return {
            "baseWatermark": self.base_watermark,
            "targetWatermark": self.target_watermark,
            "batchDigest": self.batch_digest,
            "inputTraceCount": self.input_count,
            "newTraceCount": self.new_count,
            "skippedTraceCount": self.skipped_count,
        }


class TraceStagingCache:
    """Content-addressed trace cache with explicit provisional lifecycle."""

    def __init__(self, storage_dir: Optional[str]) -> None:
        self.storage_dir = storage_dir
        self._memory_cache: dict[str, Any] = {}
        self._memory_states: dict[str, dict[str, Any]] = {}
        self._memory_graphs: dict[str, ThreadGraph] = {}

    def begin(
        self,
        *,
        thread_id: str,
        target_watermark: str,
        trace: Optional[list[dict]],
        committed_graph: Optional[ThreadGraph],
        rebuild: bool,
    ) -> StagedTrace:
        metadata = self._metadata(committed_graph)
        base_watermark = str(metadata.get("watermark") or "").strip() or None
        prior_history = [] if rebuild else self._load_history(metadata)
        prior_by_key = {
            entry["key"]: entry["digest"] for entry in prior_history
            if isinstance(entry.get("key"), str) and isinstance(entry.get("digest"), str)
        }

        ordered: list[tuple[str, dict[str, Any], str]] = []
        positions: dict[str, int] = {}
        for raw in trace or []:
            if not isinstance(raw, dict):
                raise ValueError("trace items must be objects")
            item = dict(raw)
            item_digest = _digest(item)
            key = _trace_key(item, item_digest)
            record = (key, item, item_digest)
            if key in positions:
                ordered[positions[key]] = record
            else:
                positions[key] = len(ordered)
                ordered.append(record)

        new_records = [
            record for record in ordered
            if rebuild or prior_by_key.get(record[0]) != record[2]
        ]
        new_trace = tuple(record[1] for record in new_records)
        item_entries = tuple(
            {"key": record[0], "digest": record[2]} for record in new_records
        )
        batch_digest = self._put_cache({
            "kind": "trace-batch",
            "version": TRACE_INGESTION_VERSION,
            "threadId": thread_id,
            "items": list(new_trace),
        }) if new_trace else None
        stage = StagedTrace(
            thread_id=thread_id,
            base_watermark=base_watermark,
            target_watermark=str(target_watermark),
            trace=new_trace,
            item_entries=item_entries,
            prior_history=tuple(prior_history),
            prior_anchors=tuple(metadata.get("recentAnchors") or ()),
            batch_digest=batch_digest,
            input_count=len(ordered),
            skipped_count=len(ordered) - len(new_records),
            rebuild=rebuild,
        )
        self._write_state(thread_id, {
            "version": TRACE_INGESTION_VERSION,
            "threadId": thread_id,
            "status": "staging",
            **stage.summary(),
        })
        return stage

    def committed_metadata(self, stage: StagedTrace) -> dict[str, Any]:
        history: dict[str, str] = {} if stage.rebuild else {
            entry["key"]: entry["digest"] for entry in stage.prior_history
        }
        for entry in stage.item_entries:
            history[entry["key"]] = entry["digest"]
        history_entries = [
            {"key": key, "digest": history[key]} for key in sorted(history)
        ]
        history_digest = self._put_cache({
            "kind": "trace-history",
            "version": TRACE_INGESTION_VERSION,
            "items": history_entries,
        })

        anchors = [] if stage.rebuild else [
            dict(anchor) for anchor in stage.prior_anchors
            if isinstance(anchor, dict) and anchor.get("key") and anchor.get("digest")
        ]
        anchor_by_key = {anchor["key"]: anchor for anchor in anchors}
        anchor_order = [anchor["key"] for anchor in anchors]
        for entry in stage.item_entries:
            key = entry["key"]
            if key in anchor_by_key:
                anchor_order.remove(key)
            anchor_by_key[key] = dict(entry)
            anchor_order.append(key)
        recent = [anchor_by_key[key] for key in anchor_order[-RECENT_ANCHOR_LIMIT:]]
        return {
            "version": TRACE_INGESTION_VERSION,
            "watermark": stage.target_watermark,
            "historyDigest": history_digest,
            "recentAnchors": recent,
            "processedTraceCount": len(history_entries),
            "lastBatchDigest": stage.batch_digest,
        }

    def persist_provisional_graph(
        self, stage: StagedTrace, graph: ThreadGraph, *, phase: str,
        temporary_edge_count: int = 0,
    ) -> None:
        provisional = ThreadGraph.from_dict(graph.to_dict())
        provisional.meta.pop("snapshot", None)
        provisional.meta["compileState"] = {
            "status": "provisional",
            "phase": phase,
            "provisionalNodeCount": len(graph.nodes),
            "provisionalEdgeCount": len(graph.edges),
            "temporaryEdgeCount": max(0, int(temporary_edge_count)),
            **stage.summary(),
        }
        if self.storage_dir:
            self._atomic_write(self._graph_path(stage.thread_id), provjson.dumps(provisional))
        else:
            self._memory_graphs[stage.thread_id] = provisional
        state = self.status(stage.thread_id) or {}
        self._write_state(stage.thread_id, {
            **state,
            "status": "provisional",
            "phase": phase,
            **stage.summary(),
        })

    def complete(self, stage: StagedTrace) -> None:
        self._memory_states.pop(stage.thread_id, None)
        self._memory_graphs.pop(stage.thread_id, None)
        for path in (self._state_path(stage.thread_id), self._graph_path(stage.thread_id)):
            if path and os.path.exists(path):
                try:
                    os.unlink(path)
                except FileNotFoundError:
                    pass

    def fail(self, stage: StagedTrace, error: BaseException) -> None:
        state = self.status(stage.thread_id) or {}
        self._write_state(stage.thread_id, {
            **state,
            "status": "failed",
            **stage.summary(),
            "error": {"type": type(error).__name__, "message": str(error)},
        })

    def interrupt(self, thread_id: str, message: str) -> None:
        state = self.status(thread_id)
        if state is None:
            return
        self._write_state(thread_id, {
            **state,
            "status": "failed",
            "error": {"type": "InterruptedUpdate", "message": message},
        })

    def status(self, thread_id: str) -> Optional[dict[str, Any]]:
        if thread_id in self._memory_states:
            return dict(self._memory_states[thread_id])
        path = self._state_path(thread_id)
        if not path or not os.path.exists(path):
            return None
        with open(path, encoding="utf-8") as handle:
            value = json.load(handle)
        return dict(value) if isinstance(value, dict) else None

    def provisional_graph(self, thread_id: str) -> Optional[ThreadGraph]:
        if thread_id in self._memory_graphs:
            return ThreadGraph.from_dict(self._memory_graphs[thread_id].to_dict())
        path = self._graph_path(thread_id)
        if not path or not os.path.exists(path):
            return None
        with open(path, encoding="utf-8") as handle:
            return provjson.loads(handle.read())

    @staticmethod
    def _metadata(graph: Optional[ThreadGraph]) -> dict[str, Any]:
        value = (graph.meta or {}).get("traceIngestion") if graph is not None else None
        return dict(value) if isinstance(value, dict) else {}

    def _load_history(self, metadata: dict[str, Any]) -> list[dict[str, str]]:
        history_digest = str(metadata.get("historyDigest") or "").strip()
        cached = self._get_cache(history_digest) if history_digest else None
        if isinstance(cached, dict) and cached.get("kind") == "trace-history":
            items = cached.get("items")
            if isinstance(items, list):
                return [
                    {"key": item["key"], "digest": item["digest"]}
                    for item in items if isinstance(item, dict)
                    and isinstance(item.get("key"), str)
                    and isinstance(item.get("digest"), str)
                ]
        # Missing cache is fail-open for ingestion: recent anchors still prevent
        # common duplicate work, while never dropping unseen scientific evidence.
        anchors = metadata.get("recentAnchors")
        if not isinstance(anchors, list):
            return []
        return [
            {"key": item["key"], "digest": item["digest"]}
            for item in anchors if isinstance(item, dict)
            and isinstance(item.get("key"), str)
            and isinstance(item.get("digest"), str)
        ]

    def _put_cache(self, payload: Any) -> str:
        digest = _digest(payload)
        if self.storage_dir:
            path = self._cache_path(digest)
            if os.path.exists(path):
                with open(path, encoding="utf-8") as handle:
                    existing = json.load(handle)
                if _digest(existing) != digest:
                    raise RuntimeError("content-addressed trace staging cache collision")
            else:
                self._atomic_write(path, json.dumps(
                    payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                ))
        else:
            self._memory_cache[digest] = payload
        return digest

    def _get_cache(self, digest: str) -> Any:
        if not digest.startswith("sha256:"):
            return None
        if digest in self._memory_cache:
            return self._memory_cache[digest]
        path = self._cache_path(digest)
        if not os.path.exists(path):
            return None
        try:
            with open(path, encoding="utf-8") as handle:
                value = json.load(handle)
            return value if _digest(value) == digest else None
        except (OSError, ValueError, TypeError):
            return None

    def _cache_path(self, digest: str) -> str:
        if not self.storage_dir:
            return ""
        return os.path.join(self.storage_dir, "staging", "cache", f"{digest.removeprefix('sha256:')}.json")

    def _state_path(self, thread_id: str) -> str:
        if not self.storage_dir:
            return ""
        return os.path.join(self.storage_dir, "staging", f"{_safe_key(thread_id)}.state.json")

    def _graph_path(self, thread_id: str) -> str:
        if not self.storage_dir:
            return ""
        return os.path.join(self.storage_dir, "staging", f"{_safe_key(thread_id)}.provisional.prov.json")

    def _write_state(self, thread_id: str, state: dict[str, Any]) -> None:
        if self.storage_dir:
            self._atomic_write(
                self._state_path(thread_id),
                json.dumps(state, ensure_ascii=False, sort_keys=True, indent=2),
            )
        else:
            self._memory_states[thread_id] = dict(state)

    @staticmethod
    def _atomic_write(path: str, content: str) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        temporary = f"{path}.{uuid.uuid4().hex}.tmp"
        try:
            with open(temporary, "x", encoding="utf-8") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
