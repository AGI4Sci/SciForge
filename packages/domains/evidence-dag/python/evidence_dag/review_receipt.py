"""Receipt metadata for the existing packet-level decision event.

Scope comes only from the server's matched packet. Actor labels are not
authenticated principals, and this API does not measure review time.
"""
from __future__ import annotations

from copy import deepcopy
from .model import ReviewPacket


def build_review_receipt(
    snapshot_digest: str, packet: ReviewPacket, previous_event_id: str | None,
) -> dict:
    return {
        "scope": {
            "kind": "review-packet",
            "snapshotDigest": snapshot_digest,
            "reviewPacketId": packet.review_packet_id,
            "targetIds": list(packet.target_ids),
            "assessmentIds": list(packet.assessment_ids),
        },
        "identity": {"status": "unverified", "source": "caller-label", "principal": None},
        "timing": {"status": "unknown", "elapsedMs": None, "activeMs": None},
        "previousDecisionEventId": previous_event_id,
    }


def project_review_receipt(payload: dict) -> dict:
    """Never infer missing historical metadata from today's packet."""
    if isinstance(payload.get("reviewReceipt"), dict):
        return deepcopy(payload["reviewReceipt"])
    return {
        "scope": {"kind": "unknown"},
        "identity": {"status": "unknown", "source": "not-recorded", "principal": None},
        "timing": {"status": "unknown", "elapsedMs": None, "activeMs": None},
        "previousDecisionEventId": None,
    }
