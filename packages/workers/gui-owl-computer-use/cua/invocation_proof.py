"""Short-lived, single-use authorization proof for Computer Use mutations."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import struct
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any


INVOCATION_HEADER = "X-Sciforge-CUA-Invocation"
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_FIELDS = (
    "version", "proofId", "requestId", "runtimeId", "threadId", "turnId",
    "callId", "invocationId", "tool", "argumentDigest", "issuedAtMs",
    "expiresAtMs", "nonce", "approval", "signature",
)


class InvocationProofError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class InvocationIdentity:
    proof_id: str
    request_id: str
    runtime_id: str
    thread_id: str
    turn_id: str
    call_id: str
    invocation_id: str
    tool: str


class InvocationProofVerifier:
    def __init__(
        self,
        secret: str,
        *,
        mode: str = "required",
        max_ttl_ms: int = 300_000,
        max_entries: int = 4096,
        not_before_ms: int | None = None,
    ) -> None:
        if mode not in {"required", "legacy"}:
            raise ValueError("invocation proof mode must be required or legacy")
        if max_ttl_ms <= 0 or max_entries <= 0:
            raise ValueError("invocation proof limits must be positive")
        self.secret = secret
        self.mode = mode
        self.max_ttl_ms = max_ttl_ms
        self.max_entries = max_entries
        self.not_before_ms = (
            int(time.time() * 1000) if not_before_ms is None else not_before_ms
        )
        self._lock = threading.RLock()
        self._used: "OrderedDict[str, int]" = OrderedDict()

    @property
    def status(self) -> str:
        return "invocation-proof-v1" if self.mode == "required" else "legacy-trust-boundary"

    def verify(
        self,
        encoded: str | None,
        *,
        tool: str,
        arguments: dict[str, Any],
        expected_request_id: str | None = None,
        now_ms: int | None = None,
    ) -> InvocationIdentity | None:
        if not encoded:
            if self.mode == "legacy":
                return None
            raise InvocationProofError(
                "APPROVAL_PROOF_REQUIRED",
                "a trusted Computer Use invocation proof is required",
            )
        if not self.secret:
            raise InvocationProofError(
                "APPROVAL_PROOF_REQUIRED",
                "the Computer Use invocation proof secret is unavailable",
            )
        proof = _decode(encoded)
        _validate_shape(proof)
        current = int(time.time() * 1000) if now_ms is None else now_ms
        issued = proof["issuedAtMs"]
        expires = proof["expiresAtMs"]
        if issued < self.not_before_ms:
            raise InvocationProofError(
                "APPROVAL_PROOF_EXPIRED",
                "invocation proof predates this service instance",
            )
        if expires <= issued or expires - issued > self.max_ttl_ms:
            raise InvocationProofError("APPROVAL_PROOF_INVALID", "invocation proof TTL is invalid")
        if current < issued - 5000 or current > expires:
            raise InvocationProofError("APPROVAL_PROOF_EXPIRED", "invocation proof has expired")
        if proof["tool"] != tool:
            raise InvocationProofError("INVOCATION_IDENTITY_MISMATCH", "invocation tool does not match")
        if expected_request_id is not None and proof["requestId"] != expected_request_id:
            raise InvocationProofError("INVOCATION_IDENTITY_MISMATCH", "invocation request ID does not match")
        if proof["argumentDigest"] != argument_digest(arguments):
            raise InvocationProofError("INVOCATION_IDENTITY_MISMATCH", "invocation arguments do not match")
        expected = hmac.new(
            self.secret.encode("utf-8"),
            proof_message(proof).encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected, proof["signature"]):
            raise InvocationProofError("APPROVAL_PROOF_INVALID", "invocation proof signature is invalid")
        replay_key = f'{proof["proofId"]}\0{proof["nonce"]}'
        with self._lock:
            self._prune(current)
            if replay_key in self._used:
                raise InvocationProofError("APPROVAL_PROOF_REPLAYED", "invocation proof was already used")
            if len(self._used) >= self.max_entries:
                raise InvocationProofError(
                    "APPROVAL_PROOF_CAPACITY",
                    "invocation proof replay protection is at capacity",
                )
            self._used[replay_key] = expires
        return InvocationIdentity(
            proof_id=proof["proofId"],
            request_id=proof["requestId"],
            runtime_id=proof["runtimeId"],
            thread_id=proof["threadId"],
            turn_id=proof["turnId"],
            call_id=proof["callId"],
            invocation_id=proof["invocationId"],
            tool=proof["tool"],
        )

    def _prune(self, now_ms: int) -> None:
        for key, expires in list(self._used.items()):
            if expires >= now_ms:
                continue
            self._used.pop(key, None)


def argument_digest(value: dict[str, Any]) -> str:
    canonical = _stable_json(value)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def proof_message(proof: dict[str, Any]) -> str:
    return "\n".join(str(proof[field]) for field in _FIELDS[:-1])


def _stable_json(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        number = float(value)
        if number != number or number in {float("inf"), float("-inf")}:
            raise ValueError("Computer Use proof arguments must contain finite numbers")
        return f"n{struct.pack('>d', number).hex()}"
    if isinstance(value, list):
        return f"[{','.join(_stable_json(item) for item in value)}]"
    if isinstance(value, dict):
        return "{" + ",".join(
            f"{json.dumps(str(key), ensure_ascii=False)}:{_stable_json(value[key])}"
            for key in sorted(value)
        ) + "}"
    raise ValueError("Computer Use proof arguments must be JSON values")


def _decode(encoded: str) -> dict[str, Any]:
    try:
        padding = "=" * (-len(encoded) % 4)
        raw = base64.urlsafe_b64decode((encoded + padding).encode("ascii"))
        value = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeError, json.JSONDecodeError) as error:
        raise InvocationProofError("APPROVAL_PROOF_INVALID", "invocation proof is malformed") from error
    if not isinstance(value, dict):
        raise InvocationProofError("APPROVAL_PROOF_INVALID", "invocation proof must be an object")
    return value


def _validate_shape(proof: dict[str, Any]) -> None:
    if set(proof) != set(_FIELDS) or proof.get("version") != 1:
        raise InvocationProofError("APPROVAL_PROOF_INVALID", "invocation proof shape is invalid")
    for field in (
        "proofId", "requestId", "runtimeId", "threadId", "invocationId", "tool", "nonce",
    ):
        value = proof.get(field)
        if not isinstance(value, str) or not _SAFE_ID.fullmatch(value):
            raise InvocationProofError("INVOCATION_IDENTITY_MISMATCH", f"invocation {field} is invalid")
    for field in ("turnId", "callId"):
        value = proof.get(field)
        if (
            not isinstance(value, str)
            or len(value) > 256
            or any(separator in value for separator in ("\r", "\n", "\0"))
        ):
            raise InvocationProofError("INVOCATION_IDENTITY_MISMATCH", f"invocation {field} is invalid")
    if proof.get("approval") != "confirmation":
        raise InvocationProofError("APPROVAL_PROOF_INVALID", "invocation confirmation is missing")
    if not isinstance(proof.get("argumentDigest"), str) or not re.fullmatch(
        r"[a-f0-9]{64}", proof["argumentDigest"],
    ):
        raise InvocationProofError("APPROVAL_PROOF_INVALID", "invocation argument digest is invalid")
    if not isinstance(proof.get("signature"), str) or not re.fullmatch(
        r"[a-f0-9]{64}", proof["signature"],
    ):
        raise InvocationProofError("APPROVAL_PROOF_INVALID", "invocation signature is invalid")
    if not isinstance(proof.get("issuedAtMs"), int) or not isinstance(proof.get("expiresAtMs"), int):
        raise InvocationProofError("APPROVAL_PROOF_INVALID", "invocation timing is invalid")
