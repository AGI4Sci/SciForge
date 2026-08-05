import pytest

from cua.capabilities import BackendCapabilities, BackendId, BackgroundInput
from cua.isolation import IsolationLevel
from cua.session_registry import LeaseScope
from cua.target import TargetKind


def test_backend_capabilities_report_security_relevant_truth():
    capability = BackendCapabilities(
        backend=BackendId.LEGACY_PYAUTOGUI,
        available=True,
        target_kinds=(TargetKind.HOST_DESKTOP,),
        actions=("observe", "click", "type-text"),
        effective_isolation=IsolationLevel.HOST_APPROVED,
        background_input=BackgroundInput.NONE,
        requires_host_focus=True,
        affects_user_input=True,
        uses_host_clipboard=True,
        supports_readback=(),
        lease_scope=LeaseScope.PROCESS_GLOBAL,
        max_concurrency=1,
    )
    view = capability.to_dict()
    assert view["effectiveIsolation"] == "host-approved"
    assert view["usesHostClipboard"] is True
    assert view["leaseScope"] == "process-global"


def test_unavailable_capability_requires_reason():
    with pytest.raises(ValueError, match="reason"):
        BackendCapabilities(
            backend=BackendId.WINDOWS_UIA,
            available=False,
            target_kinds=(TargetKind.WINDOWS_UIA,),
            actions=(),
            effective_isolation=IsolationLevel.HOST_APP_SCOPED,
            background_input=BackgroundInput.SEMANTIC,
            requires_host_focus=False,
            affects_user_input=False,
            uses_host_clipboard=False,
            supports_readback=(),
            lease_scope=LeaseScope.TARGET,
            max_concurrency=0,
        )
