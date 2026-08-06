from __future__ import annotations

import base64
import json

import pytest

from cua.invocation_proof import InvocationProofError, InvocationProofVerifier, argument_digest


ARGS = {"execute": True, "instruction": "type alpha", "nested": {"z": 1, "a": False}}
PROOF = {
    "version": 1,
    "proofId": "cua-proof-1",
    "requestId": "mcp-cua-request-1",
    "runtimeId": "codex",
    "threadId": "thread-1",
    "turnId": "turn-1",
    "callId": "call-1",
    "invocationId": "invocation-1",
    "tool": "computer_use",
    "argumentDigest": "22dc2bacbc3487a0cad9a42d23aae241e0657122eba0d26f3ad50e3949edbd2e",
    "issuedAtMs": 1_800_000_000_000,
    "expiresAtMs": 1_800_000_030_000,
    "nonce": "nonce-1",
    "approval": "confirmation",
    "signature": "77f2117ed0dfad6c82c26af687c0f238487ddbc49b5b2281607229ce3f07476f",
}


def _encoded(proof=PROOF):
    return base64.urlsafe_b64encode(
        json.dumps(proof, ensure_ascii=False, separators=(",", ":")).encode()
    ).decode().rstrip("=")


def test_typescript_fixed_vector_verifies_and_is_single_use():
    verifier = InvocationProofVerifier("test-secret")
    identity = verifier.verify(
        _encoded(), tool="computer_use", arguments=ARGS,
        expected_request_id="mcp-cua-request-1", now_ms=1_800_000_010_000,
    )
    assert identity is not None
    assert identity.runtime_id == "codex"
    with pytest.raises(InvocationProofError, match="already used") as caught:
        verifier.verify(
            _encoded(), tool="computer_use", arguments=ARGS,
            expected_request_id="mcp-cua-request-1", now_ms=1_800_000_010_001,
        )
    assert caught.value.code == "APPROVAL_PROOF_REPLAYED"


@pytest.mark.parametrize(
    ("change", "code"),
    [
        ({"tool": "computer_use_cancel"}, "INVOCATION_IDENTITY_MISMATCH"),
        ({"signature": "0" * 64}, "APPROVAL_PROOF_INVALID"),
        ({"expiresAtMs": 1_800_000_300_001}, "APPROVAL_PROOF_INVALID"),
    ],
)
def test_invalid_proofs_fail_closed(change, code):
    proof = {**PROOF, **change}
    with pytest.raises(InvocationProofError) as caught:
        InvocationProofVerifier("test-secret").verify(
            _encoded(proof), tool="computer_use", arguments=ARGS,
            expected_request_id="mcp-cua-request-1", now_ms=1_800_000_010_000,
        )
    assert caught.value.code == code


def test_expired_missing_and_argument_mismatch_are_distinct():
    verifier = InvocationProofVerifier("test-secret")
    with pytest.raises(InvocationProofError) as expired:
        verifier.verify(
            _encoded(), tool="computer_use", arguments=ARGS,
            expected_request_id="mcp-cua-request-1", now_ms=1_800_000_040_000,
        )
    assert expired.value.code == "APPROVAL_PROOF_EXPIRED"
    with pytest.raises(InvocationProofError) as missing:
        verifier.verify(None, tool="computer_use", arguments=ARGS)
    assert missing.value.code == "APPROVAL_PROOF_REQUIRED"
    with pytest.raises(InvocationProofError) as mismatch:
        InvocationProofVerifier("test-secret").verify(
            _encoded(), tool="computer_use", arguments={"execute": True},
            expected_request_id="mcp-cua-request-1", now_ms=1_800_000_010_000,
        )
    assert mismatch.value.code == "INVOCATION_IDENTITY_MISMATCH"


def test_argument_digest_sorts_nested_keys():
    assert argument_digest({"b": 2, "a": {"y": True, "x": ["z"]}}) == argument_digest(
        {"a": {"x": ["z"], "y": True}, "b": 2}
    )


def test_legacy_mode_allows_missing_proof_but_reports_legacy_boundary():
    verifier = InvocationProofVerifier("", mode="legacy")
    assert verifier.verify(None, tool="computer_use", arguments={}) is None
    assert verifier.status == "legacy-trust-boundary"
