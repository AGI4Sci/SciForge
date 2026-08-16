"""Environment-only configuration for the local CDP control service."""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


@dataclass
class Config:
    service_token: str = field(default_factory=lambda: _env("CUA_SERVICE_TOKEN", _env("SCIFORGE_CUA_SERVICE_TOKEN")))
    invocation_secret: str = field(default_factory=lambda: _env("SCIFORGE_CUA_INVOCATION_SECRET"))
    invocation_proof_mode: str = field(default_factory=lambda: "legacy" if _env("CUA_INVOCATION_PROOF_MODE") == "legacy" else "required")
    invocation_proof_ttl_ms: int = field(default_factory=lambda: int(_env("SCIFORGE_CUA_INVOCATION_PROOF_TTL_MS", "300000")))
    port: int = field(default_factory=lambda: int(_env("CUA_PORT", "3900")))


CONFIG = Config()
