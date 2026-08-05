import pytest

from cua.target import TargetKind, host_desktop_target, parse_target_descriptor


def test_target_descriptor_is_immutable_and_serializable():
    target = parse_target_descriptor({
        "targetId": "target-uia-1",
        "kind": "windows-uia",
        "locator": {"processId": 42, "automationId": "editor"},
        "display": {"monitorId": "2", "viewport": [800, 600]},
    })
    assert target.kind is TargetKind.WINDOWS_UIA
    assert target.to_dict()["display"]["viewport"] == [800, 600]
    with pytest.raises(AttributeError):
        target.target_id = "changed"
    with pytest.raises(TypeError):
        target.locator["processId"] = 99


def test_target_rejects_kind_incompatible_locator():
    with pytest.raises(ValueError, match="unsupported"):
        parse_target_descriptor({
            "kind": "windows-uia",
            "locator": {"cdpTargetId": "page-1"},
        })


def test_host_desktop_is_explicit_not_an_implicit_default():
    target = host_desktop_target()
    assert target.target_id == "host-desktop:default"
    assert target.kind is TargetKind.HOST_DESKTOP


def test_sensitive_locator_and_metadata_are_redacted_from_views_and_repr():
    target = parse_target_descriptor({
        "targetId": "target-browser-1",
        "kind": "browser-page",
        "locator": {
            "cdpEndpoint": "http://token-secret@127.0.0.1:9222?key=secret",
            "cdpTargetId": "page-1",
        },
        "metadata": {"title": "secret title", "url": "https://secret.example"},
    })
    public = target.to_dict(include_sensitive=False)
    assert public["locator"]["cdpEndpoint"] == "<redacted>"
    assert public["metadata"]["title"] == "<redacted>"
    assert "token-secret" not in repr(target)


def test_window_handle_requires_pid_and_generation_to_reduce_reuse_risk():
    with pytest.raises(ValueError, match="processId"):
        parse_target_descriptor({
            "kind": "windows-uia",
            "locator": {"nativeWindowHandle": "0x1234"},
        })
    with pytest.raises(ValueError, match="generation"):
        parse_target_descriptor({
            "kind": "windows-uia",
            "locator": {"nativeWindowHandle": "0x1234", "processId": 42},
        })
