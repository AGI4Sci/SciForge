from __future__ import annotations

import threading
import time

from cua.target import TargetDescriptor, TargetKind, TargetOwnership
from driver.backend import BackendOpenContext
from driver.backends.cdp_adapter import CdpAdapterBackend, CdpAdapterHandle


class _Response:
    status_code = 200

    def __init__(self, data: dict) -> None:
        self._data = data

    def json(self) -> dict:
        return {"ok": True, "data": self._data}


class _RecordingSession:
    def __init__(self, target: TargetDescriptor) -> None:
        self.target = target
        self.timeouts: list[float] = []

    def request(self, method, url, *, headers, json, timeout):
        self.timeouts.append(timeout)
        return _Response({
            "targetId": self.target.target_id,
            "generation": self.target.generation,
            "committed": True,
            "mayHaveTakenEffect": True,
            "verification": {
                "status": "verified", "revisionAfter": "cdp:2", "details": {},
            },
        })


def _target() -> TargetDescriptor:
    return TargetDescriptor(
        target_id="target-http-deadline",
        kind=TargetKind.BROWSER_PAGE,
        ownership=TargetOwnership.ATTACHED,
        locator={"cdpEndpoint": "http://127.0.0.1:9222", "cdpTargetId": "deadline"},
        generation="generation-http-deadline",
    )


def test_action_http_timeout_is_bounded_by_request_deadline() -> None:
    target = _target()
    session = _RecordingSession(target)
    context = BackendOpenContext(
        request_id="request-http-deadline",
        execute=True,
        settle_s=0,
        show_overlay=False,
        cancellation=threading.Event(),
        deadline=time.time() + 1.0,
    )
    handle = CdpAdapterHandle(
        target=target,
        context=context,
        adapter_handle_id="handle-http-deadline",
        generation=target.generation,
        adapter_url="http://127.0.0.1:8765",
        token="token-http-deadline",
    )
    backend = CdpAdapterBackend(
        adapter_url=handle.adapter_url,
        token=handle.token,
        action_timeout_s=30.0,
        session=session,
    )

    backend.perform(handle, {"action": "click"}, "cdp:1")

    assert len(session.timeouts) == 1
    assert 0 < session.timeouts[0] <= 1.0


def test_action_http_timeout_uses_configured_limit_without_deadline() -> None:
    target = _target()
    session = _RecordingSession(target)
    context = BackendOpenContext(
        request_id="request-http-no-deadline",
        execute=True,
        settle_s=0,
        show_overlay=False,
        cancellation=threading.Event(),
    )
    handle = CdpAdapterHandle(
        target=target,
        context=context,
        adapter_handle_id="handle-http-no-deadline",
        generation=target.generation,
        adapter_url="http://127.0.0.1:8765",
        token="token-http-no-deadline",
    )
    backend = CdpAdapterBackend(
        adapter_url=handle.adapter_url,
        token=handle.token,
        action_timeout_s=7.0,
        session=session,
    )

    backend.perform(handle, {"action": "click"}, "cdp:1")

    assert session.timeouts == [7.0]
