from __future__ import annotations

import base64
import hashlib
import hmac
import json

import pytest

from cua.invocation_proof import (
    InvocationProofError,
    InvocationProofVerifier,
    argument_digest,
    proof_message,
)


def encoded_proof(arguments: dict, *, secret: str = "test-secret", proof_id: str = "proof-1") -> str:
    proof = {
        "version": 1,
        "proofId": proof_id,
        "requestId": "request-1",
        "runtimeId": "codex",
        "threadId": "thread-1",
        "turnId": "turn-1",
        "callId": "call-1",
        "invocationId": "invocation-1",
        "tool": "computer_use",
        "argumentDigest": argument_digest(arguments),
        "issuedAtMs": 1_000,
        "expiresAtMs": 2_000,
        "nonce": "nonce-1",
        "approval": "confirmation",
        "signature": "",
    }
    proof["signature"] = hmac.new(
        secret.encode(), proof_message(proof).encode(), hashlib.sha256
    ).hexdigest()
    return base64.urlsafe_b64encode(json.dumps(proof).encode()).decode().rstrip("=")


def test_proof_is_bound_to_arguments_and_single_use():
    arguments = {"sessionId": "session-1", "semanticAction": {"kind": "observe"}}
    verifier = InvocationProofVerifier("test-secret", not_before_ms=0)
    proof = encoded_proof(arguments)
    identity = verifier.verify(proof, tool="computer_use", arguments=arguments, now_ms=1_500)
    assert identity and identity.turn_id == "turn-1"
    with pytest.raises(InvocationProofError) as replay:
        verifier.verify(proof, tool="computer_use", arguments=arguments, now_ms=1_500)
    assert replay.value.code == "APPROVAL_PROOF_REPLAYED"


def test_forged_arguments_and_signature_fail_closed():
    arguments = {"sessionId": "session-1", "semanticAction": {"kind": "observe"}}
    proof = encoded_proof(arguments)
    with pytest.raises(InvocationProofError) as changed:
        InvocationProofVerifier("test-secret", not_before_ms=0).verify(
            proof,
            tool="computer_use",
            arguments={"sessionId": "session-2", "semanticAction": {"kind": "observe"}},
            now_ms=1_500,
        )
    assert changed.value.code == "INVOCATION_IDENTITY_MISMATCH"
    with pytest.raises(InvocationProofError) as forged:
        InvocationProofVerifier("different-secret", not_before_ms=0).verify(
            proof, tool="computer_use", arguments=arguments, now_ms=1_500
        )
    assert forged.value.code == "APPROVAL_PROOF_INVALID"
