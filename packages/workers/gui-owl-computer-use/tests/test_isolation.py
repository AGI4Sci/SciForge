import pytest

from cua.isolation import (
    IsolationLevel,
    IsolationUnavailable,
    ApprovalRequired,
    RequestedIsolation,
    decide_isolation,
)


def test_explicit_isolation_cannot_silently_weaken():
    with pytest.raises(IsolationUnavailable):
        decide_isolation(
            RequestedIsolation.AGENT_ISOLATED,
            IsolationLevel.HOST_APP_SCOPED,
            allow_degraded=False,
        )


def test_approved_degradation_is_structured():
    decision = decide_isolation(
        RequestedIsolation.HOST_APP_SCOPED,
        IsolationLevel.HOST_GLOBAL,
        allow_degraded=True,
    )
    assert decision.degraded is True
    assert decision.effective is IsolationLevel.HOST_GLOBAL
    assert decision.degraded_reason == "REQUESTED_HOST_APP_SCOPED_UNAVAILABLE"


def test_auto_legacy_fallback_is_still_marked_degraded():
    decision = decide_isolation(
        RequestedIsolation.AUTO,
        IsolationLevel.HOST_APPROVED,
        allow_degraded=False,
        approval_context=True,
    )
    assert decision.degraded is True
    assert decision.degraded_reason == "AUTO_SELECTED_HOST_APPROVED"


def test_host_approved_requires_trusted_approval_context():
    with pytest.raises(ApprovalRequired):
        decide_isolation(
            RequestedIsolation.AUTO,
            IsolationLevel.HOST_APPROVED,
            allow_degraded=True,
        )


@pytest.mark.parametrize("requested", list(RequestedIsolation))
@pytest.mark.parametrize("effective", list(IsolationLevel))
def test_all_isolation_pairs_are_explicit(requested, effective):
    try:
        decision = decide_isolation(
            requested,
            effective,
            allow_degraded=True,
            approval_context=True,
        )
    except IsolationUnavailable:
        pytest.fail("allow_degraded=True must produce a structured decision")
    assert decision.requested is requested
    assert decision.effective is effective
