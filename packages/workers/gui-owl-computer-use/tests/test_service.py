from cua.service import ComputerUseService


def uia_target(target_id="target-uia-1"):
    return {
        "targetId": target_id,
        "kind": "windows-uia",
        "locator": {"processId": 1234, "automationId": "Editor"},
        "metadata": {"title": "secret document", "processName": "app.exe"},
    }


def test_service_preserves_v1_and_fails_v2_closed():
    service = ComputerUseService()
    calls = []
    result = service.run({"instruction": "legacy"}, lambda request: calls.append(request) or {"ok": True})
    assert result == {"ok": True}
    assert calls[0]["protocolVersion"] == 1
    blocked = service.run(
        {"instruction": "targeted", "sessionId": "session-1"},
        lambda _request: (_ for _ in ()).throw(AssertionError("must not execute")),
    )
    assert blocked["error"]["code"] == "BACKEND_UNAVAILABLE"


def test_bind_status_duplicate_and_release_lifecycle():
    service = ComputerUseService()
    value = {
        "sessionId": "session-1",
        "owner": {"runtimeId": "runtime-1", "threadId": "thread-1"},
        "target": uia_target(),
    }
    bound = service.bind_session(value)
    assert bound["ok"] is True
    assert bound["data"]["target"]["metadata"]["title"] == "<redacted>"
    duplicate = service.bind_session(value)
    assert duplicate["error"]["code"] == "SESSION_ID_CONFLICT"
    status = service.status()
    assert status["approvalProof"] == "legacy-trust-boundary"
    assert status["registry"]["counts"]["sessions"] == 1
    released = service.release_session({"sessionId": "session-1"})
    assert released["ok"] is True
    assert service.status()["registry"]["counts"]["sessions"] == 0


def test_service_rejects_request_id_path_attack_before_legacy_executor():
    service = ComputerUseService()
    result = service.run(
        {"instruction": "x", "requestId": "../escape"},
        lambda _request: (_ for _ in ()).throw(AssertionError("must not execute")),
    )
    assert result["error"]["code"] == "INVALID_ARGUMENT"
