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
EVENT_TYPES = frozenset({
    "EvidenceUpdateQueued",
    "EvidenceSnapshotCommitted",
    "ArtifactMoved",
    "ArtifactContentChanged",
    "AuditCompleted",
    "FindingOpened",
    "HumanReviewDecisionRecorded",
})


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
    """Small atomic JSON event store suitable for the local Evidence worker.

    Production workers configure ``storage_dir`` and therefore use a durable
    path.  A path-less Engine retains the same API for pure in-memory tests, but
    reports ``persistent=false`` on its events.
    """

    def __init__(self, path: Optional[str]) -> None:
        self.path = path
        self._lock = threading.RLock()
        self._memory: list[dict[str, Any]] = []
        if path and os.path.exists(path):
            self._read_document()

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
        if event_type not in EVENT_TYPES:
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

    def append_lifecycle(
        self,
        event: dict[str, Any],
        *,
        project_key: str,
        correlation_id: Optional[str] = None,
    ) -> dict[str, Any]:
        """Mirror an already-persisted Artifact Registry lifecycle event.

        The Registry event ID is retained so acknowledgement can happen only
        after the same durable semantic event exists in this stream.
        """
        event_type = str(event.get("type") or "")
        if event_type not in {"ArtifactMoved", "ArtifactContentChanged"}:
            raise ValueError(f"unsupported Artifact lifecycle event: {event_type}")
        event_id = str(event.get("eventId") or "").strip()
        artifact_id = str(event.get("artifactId") or "").strip()
        if not event_id or not artifact_id:
            raise ValueError("Artifact lifecycle eventId and artifactId are required")
        return self._append_event(
            event_id=event_id,
            event_type=event_type,
            aggregate_type="Artifact",
            aggregate_id=artifact_id,
            idempotency_key=event_id,
            payload={**event, "projectKey": project_key},
            occurred_at=event.get("occurredAt"),
            correlation_id=correlation_id,
            causation_id=None,
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
            events = self._load_events()
            existing = next((item for item in events if item.get("eventId") == event_id), None)
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
                "sequence": len(events) + 1,
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
            events.append(created)
            self._persist(events)
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
            # Always re-read the durable file.  No event is surfaced from a
            # speculative in-memory append.
            events = self._load_events()
            selected = [
                dict(event) for event in events
                if int(event.get("sequence", 0)) > after_sequence
                and (not requested or event.get("type") in requested)
                and (aggregate_id is None or event.get("aggregateId") == aggregate_id)
            ]
            return selected[:limit]

    def _load_events(self) -> list[dict[str, Any]]:
        if self.path:
            if not os.path.exists(self.path):
                return []
            return self._read_document()
        return [dict(item) for item in self._memory]

    def _read_document(self) -> list[dict[str, Any]]:
        assert self.path is not None
        with open(self.path, encoding="utf-8") as fh:
            document = json.load(fh)
        if document.get("schemaVersion") != SCHEMA_VERSION:
            raise ValueError("unsupported Evidence domain event stream schema")
        events = document.get("events")
        if not isinstance(events, list):
            raise ValueError("Evidence domain event stream events must be a list")
        for index, event in enumerate(events, start=1):
            if not isinstance(event, dict) or event.get("sequence") != index:
                raise ValueError("Evidence domain event stream sequence is corrupt")
            if event.get("type") not in EVENT_TYPES or not event.get("eventId"):
                raise ValueError("Evidence domain event stream contains an invalid event")
        return events

    def _persist(self, events: list[dict[str, Any]]) -> None:
        if not self.path:
            self._memory = [dict(item) for item in events]
            return
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        document = _canonical({"schemaVersion": SCHEMA_VERSION, "events": events})
        tmp = f"{self.path}.{uuid.uuid4().hex}.tmp"
        try:
            with open(tmp, "x", encoding="utf-8") as fh:
                fh.write(document)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, self.path)
            try:
                directory_fd = os.open(os.path.dirname(self.path), os.O_RDONLY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
            except OSError:
                pass
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
