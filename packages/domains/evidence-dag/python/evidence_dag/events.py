"""Durable, idempotent Evidence domain event stream.

The stream is an outbox/read model, not another graph writer.  Callers append an
event only after the domain object it describes has been durably stored, and an
event is returned to publishers/readers only after this store has been fsynced.
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Iterable, Optional


SCHEMA_VERSION = "evidence-domain-events.v1"
WRITABLE_EVENT_TYPES = frozenset({
    "EvidenceUpdateQueued",
    "EvidenceSnapshotCommitted",
    "AuditCompleted",
    "FindingOpened",
    "HumanReviewDecisionRecorded",
})
# Historical Evidence outboxes may contain the two lifecycle mirrors emitted
# before Artifact Versions became an independent owner.  They remain readable,
# but no new Evidence writer can append them.
EVENT_TYPES = WRITABLE_EVENT_TYPES | frozenset({"ArtifactMoved", "ArtifactContentChanged"})


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def normalize_timestamp(value: Optional[str]) -> str:
    if value is None:
        return utc_now_iso()
    raw = str(value).strip()
    if not raw:
        raise ValueError("event timestamp must not be empty")
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"invalid event timestamp: {value}") from exc
    if parsed.tzinfo is None:
        raise ValueError("event timestamp must include a timezone")
    return parsed.astimezone(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


class EventStore:
    """Durable append-only event store suitable for the local Evidence worker.

    Events live in memory and are fsynced to disk as one JSON line per event
    before they are surfaced to any caller, so appends and reads are O(1)/O(n)
    instead of a full-file rewrite per event.  Files written by earlier builds
    (one JSON document holding an ``events`` array) are read transparently and
    migrated to the line-oriented layout on the next append.

    Production workers configure ``storage_dir`` and therefore use a durable
    path.  A path-less Engine retains the same API for pure in-memory tests, but
    reports ``persistent=false`` on its events.
    """

    def __init__(self, path: Optional[str]) -> None:
        self.path = path
        self._lock = threading.RLock()
        self._events: list[dict[str, Any]] = []
        self._by_id: dict[str, dict[str, Any]] = {}
        self._legacy_file = False
        self._torn_tail = False
        if path and os.path.exists(path):
            self._load_file()

    @property
    def persistent(self) -> bool:
        return self.path is not None

    def append(
        self,
        event_type: str,
        *,
        aggregate_type: str,
        aggregate_id: str,
        idempotency_key: str,
        payload: dict[str, Any],
        occurred_at: Optional[str] = None,
        correlation_id: Optional[str] = None,
        causation_id: Optional[str] = None,
    ) -> dict[str, Any]:
        event_type = str(event_type)
        if event_type not in WRITABLE_EVENT_TYPES:
            raise ValueError(f"unsupported Evidence event type: {event_type}")
        aggregate_id = str(aggregate_id or "").strip()
        idempotency_key = str(idempotency_key or "").strip()
        if not aggregate_type or not aggregate_id or not idempotency_key:
            raise ValueError("aggregateType, aggregateId, and idempotencyKey are required")
        identity = _canonical({
            "type": event_type,
            "aggregateType": aggregate_type,
            "aggregateId": aggregate_id,
            "idempotencyKey": idempotency_key,
        })
        event_id = f"evidence-event:{hashlib.sha256(identity.encode('utf-8')).hexdigest()[:32]}"
        return self._append_event(
            event_id=event_id,
            event_type=event_type,
            aggregate_type=aggregate_type,
            aggregate_id=aggregate_id,
            idempotency_key=idempotency_key,
            payload=payload,
            occurred_at=occurred_at,
            correlation_id=correlation_id,
            causation_id=causation_id,
        )

    def _append_event(
        self,
        *,
        event_id: str,
        event_type: str,
        aggregate_type: str,
        aggregate_id: str,
        idempotency_key: str,
        payload: dict[str, Any],
        occurred_at: Optional[str],
        correlation_id: Optional[str],
        causation_id: Optional[str],
    ) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise ValueError("event payload must be an object")
        with self._lock:
            existing = self._by_id.get(event_id)
            if existing is not None:
                expected = {
                    "type": event_type,
                    "aggregateType": aggregate_type,
                    "aggregateId": aggregate_id,
                    "idempotencyKey": idempotency_key,
                }
                actual = {key: existing.get(key) for key in expected}
                if actual != expected:
                    raise RuntimeError(f"domain event identity collision: {event_id}")
                return dict(existing)
            created = {
                "schemaVersion": SCHEMA_VERSION,
                "eventId": event_id,
                "sequence": len(self._events) + 1,
                "type": event_type,
                "aggregateType": str(aggregate_type),
                "aggregateId": aggregate_id,
                "idempotencyKey": idempotency_key,
                "occurredAt": normalize_timestamp(occurred_at),
                "correlationId": str(correlation_id) if correlation_id else None,
                "causationId": str(causation_id) if causation_id else None,
                "persistent": self.persistent,
                "payload": json.loads(_canonical(payload)),
            }
            # Durable first: the event enters memory (and is returned) only
            # after the fsynced write succeeded.
            self._persist_append(created)
            self._events.append(created)
            self._by_id[event_id] = created
            return dict(created)

    def read(
        self,
        *,
        event_types: Iterable[str] = (),
        aggregate_id: Optional[str] = None,
        after_sequence: int = 0,
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        if after_sequence < 0:
            raise ValueError("afterSequence must be >= 0")
        if limit < 1 or limit > 5000:
            raise ValueError("limit must be between 1 and 5000")
        requested = {str(value) for value in event_types if value}
        unknown = requested - EVENT_TYPES
        if unknown:
            raise ValueError(f"unsupported Evidence event type(s): {', '.join(sorted(unknown))}")
        with self._lock:
            # Memory only ever contains fsynced events, so it is as durable a
            # read model as the file itself.
            selected = [
                dict(event) for event in self._events
                if int(event.get("sequence", 0)) > after_sequence
                and (not requested or event.get("type") in requested)
                and (aggregate_id is None or event.get("aggregateId") == aggregate_id)
            ]
            return selected[:limit]

    @staticmethod
    def _validate(events: list[Any]) -> None:
        for index, event in enumerate(events, start=1):
            if not isinstance(event, dict) or event.get("sequence") != index:
                raise ValueError("Evidence domain event stream sequence is corrupt")
            if event.get("type") not in EVENT_TYPES or not event.get("eventId"):
                raise ValueError("Evidence domain event stream contains an invalid event")

    def _load_file(self) -> None:
        assert self.path is not None
        with open(self.path, encoding="utf-8") as fh:
            text = fh.read()
        if not text.strip():
            return
        # A legacy file is one JSON document holding the full events array; a
        # line-oriented file holds one event object per line (so a whole-text
        # parse either fails on the second line or yields an event, not a
        # document with an "events" array).
        document = None
        try:
            document = json.loads(text)
        except json.JSONDecodeError:
            pass
        if isinstance(document, dict) and "events" in document:
            if document.get("schemaVersion") != SCHEMA_VERSION:
                raise ValueError("unsupported Evidence domain event stream schema")
            events = document.get("events")
            if not isinstance(events, list):
                raise ValueError("Evidence domain event stream events must be a list")
            self._legacy_file = True
        else:
            events = []
            lines = text.splitlines()
            for index, line in enumerate(lines):
                line = line.strip()
                if not line:
                    continue
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    if index == len(lines) - 1:
                        # A torn trailing line is a crash mid-append; the event
                        # was never surfaced to a caller, so drop it from the
                        # read model and rewrite the valid prefix before the
                        # next append. Appending directly after a partial JSON
                        # object would make the new durable event unreadable on
                        # the next restart.
                        self._torn_tail = True
                        break
                    raise ValueError("Evidence domain event stream contains a corrupt line")
        self._validate(events)
        self._events = events
        self._by_id = {event["eventId"]: event for event in events}

    def _persist_append(self, event: dict[str, Any]) -> None:
        if not self.path:
            return
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        if self._legacy_file or self._torn_tail:
            self._rewrite_all([*self._events, event])
            self._legacy_file = False
            self._torn_tail = False
            return
        creating = not os.path.exists(self.path)
        with open(self.path, "a", encoding="utf-8") as fh:
            fh.write(_canonical(event) + "\n")
            fh.flush()
            os.fsync(fh.fileno())
        if creating:
            self._fsync_directory()

    def _rewrite_all(self, events: list[dict[str, Any]]) -> None:
        assert self.path is not None
        content = "".join(_canonical(event) + "\n" for event in events)
        tmp = f"{self.path}.{uuid.uuid4().hex}.tmp"
        try:
            with open(tmp, "x", encoding="utf-8") as fh:
                fh.write(content)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, self.path)
            self._fsync_directory()
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    def _fsync_directory(self) -> None:
        assert self.path is not None
        try:
            directory_fd = os.open(os.path.dirname(self.path), os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except OSError:
            pass
