import json
from pathlib import Path

from sciforge_computer_use.contracts import (
    ACTION_ADAPTER_READINESS_SCHEMA,
    VIRTUAL_APP_SCREEN_USER_ACCEPTANCE_MANIFEST_SCHEMA,
)


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
REGISTRY_MANIFEST = PACKAGE_ROOT / "adapter-registry.manifest.json"

REQUIRED_DIAGNOSTIC_CATEGORIES = {
    "no-session",
    "adapter-unavailable",
    "background-rendering-unavailable",
    "permission-missing",
    "target-ambiguous",
    "verification-failed",
    "artifact-missing",
    "isolation-failed",
    "needs-confirmation",
    "user-handoff-required",
}
FORBIDDEN_USER_LEVEL_PASS_SOURCES = {
    "dom",
    "playwright",
    "accessibility",
    "shell-only",
    "shell-direct-artifact-write",
}
GENERIC_ACTIONS = {"click", "type_text", "drag", "scroll", "hotkey", "menu_command"}
REQUIRED_READINESS_FIELDS = {
    "adapterKind",
    "targetScope",
    "supportedActions",
    "captureSupported",
    "backgroundRenderable",
    "affectsPhysicalDisplay",
    "requiresFocusSteal",
    "sharedSystemInputUsed",
    "blockedReason",
    "schemaRefs",
}


def _load_registry():
    return json.loads(REGISTRY_MANIFEST.read_text(encoding="utf8"))


def _profiles_by_id(registry):
    return {profile["profileId"]: profile for profile in registry["profiles"]}


def _fail_closed(registry, policy_key, requested):
    policy = registry["lookupPolicy"][policy_key]
    return {
        "ok": False,
        "status": policy["status"],
        "diagnosticCategory": policy["diagnosticCategory"],
        "blockedReason": policy["blockedReason"],
        "requested": requested,
        "userAcceptanceEligible": policy["userAcceptanceEligible"],
        "diagnosticOnly": policy["diagnosticOnly"],
    }


def _describe_registry(registry):
    return {
        "schemaVersion": registry["schemaVersion"],
        "activeProductGate": registry["activeProductGate"],
        "profileRefs": [profile["profileRef"] for profile in registry["profiles"]],
        "capabilityRefs": [capability["capabilityRef"] for capability in registry["capabilities"]],
        "diagnosticTaxonomyRef": registry["diagnosticTaxonomyRef"],
        "lookupPolicy": registry["lookupPolicy"],
    }


def _read_profile(registry, profile_id):
    profile = _profiles_by_id(registry).get(profile_id)
    if not profile:
        return _fail_closed(registry, "undeclaredAdapter", {"profileId": profile_id})
    return {"ok": True, "profile": profile, "profileRef": profile["profileRef"]}


def _query_profiles(registry, **filters):
    declared_capabilities = {capability["capabilityId"] for capability in registry["capabilities"]}
    capability_id = filters.get("capabilityId")
    if capability_id and capability_id not in declared_capabilities:
        return _fail_closed(registry, "undeclaredCapability", {"capabilityId": capability_id})

    matches = list(registry["profiles"])
    if capability_id:
        matches = [profile for profile in matches if capability_id in profile["capabilityIds"]]
    if adapter_kind := filters.get("adapterKind"):
        matches = [profile for profile in matches if profile["adapterKind"] == adapter_kind]
    if target_scope := filters.get("targetScope"):
        matches = [profile for profile in matches if profile["targetScope"] == target_scope]
    if target_app_kind := filters.get("targetAppKind"):
        matches = [profile for profile in matches if target_app_kind in profile["targetAppKinds"]]
    if supported_action := filters.get("supportedAction"):
        matches = [profile for profile in matches if supported_action in profile["supportedActions"]]

    if not matches:
        return _fail_closed(registry, "undeclaredAdapter", filters)
    return {
        "ok": True,
        "profileRefs": [profile["profileRef"] for profile in matches],
        "profiles": matches,
    }


def _walk_strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for key, item in value.items():
            yield str(key)
            yield from _walk_strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _walk_strings(item)


def test_adapter_registry_manifest_describes_queries_and_reads_profiles_fail_closed():
    registry = _load_registry()

    assert registry["schemaVersion"] == "sciforge.computer-use.adapter-registry-manifest.v1"
    assert registry["activeProductGate"] == "virtual-app-screen-user-acceptance"
    assert registry["refsFirst"] is True
    assert registry["failClosed"] is True
    assert registry["readinessSchemaRef"] == ACTION_ADAPTER_READINESS_SCHEMA
    assert registry["userAcceptanceManifestSchemaRef"] == VIRTUAL_APP_SCREEN_USER_ACCEPTANCE_MANIFEST_SCHEMA
    assert set(registry["operations"]) == {"describe", "query", "read"}
    assert registry["lookupPolicy"]["declaredAdapterRequired"] is True
    assert registry["lookupPolicy"]["declaredCapabilityRequired"] is True

    description = _describe_registry(registry)
    assert "profiles" not in description
    assert len(description["profileRefs"]) == len(registry["profiles"])
    assert description["diagnosticTaxonomyRef"] == registry["diagnosticTaxonomy"]["taxonomyRef"]

    read_result = _read_profile(registry, "browser-research-native-window")
    assert read_result["ok"] is True
    assert read_result["profile"]["profileRef"] == "adapter-profile:virtual-app-screen/browser-research-native-window"
    assert read_result["profile"]["captureSupported"] is True
    assert read_result["profile"]["backgroundRenderable"] is True

    query_result = _query_profiles(
        registry,
        capabilityId="capture.background-frame",
        targetAppKind="browser",
        supportedAction="scroll",
    )
    assert query_result["ok"] is True
    assert query_result["profileRefs"] == ["adapter-profile:virtual-app-screen/browser-research-native-window"]

    missing_adapter = _read_profile(registry, "dom-playwright-shortcut")
    assert missing_adapter["ok"] is False
    assert missing_adapter["status"] == "blocked"
    assert missing_adapter["diagnosticCategory"] == "adapter-unavailable"
    assert missing_adapter["userAcceptanceEligible"] is False

    missing_capability = _query_profiles(registry, capabilityId="shell-direct-artifact-write")
    assert missing_capability["ok"] is False
    assert missing_capability["status"] == "blocked"
    assert missing_capability["diagnosticCategory"] == "adapter-unavailable"
    assert missing_capability["userAcceptanceEligible"] is False


def test_adapter_registry_profiles_declare_required_capabilities_without_shortcut_passes():
    registry = _load_registry()
    declared_capabilities = {capability["capabilityId"] for capability in registry["capabilities"]}
    profile_ids = set()

    for profile in registry["profiles"]:
        assert profile["profileId"] not in profile_ids
        profile_ids.add(profile["profileId"])
        assert set(registry["requiredProfileFields"]) <= set(profile)
        assert REQUIRED_READINESS_FIELDS <= set(profile)
        assert profile["profileRef"].startswith("adapter-profile:virtual-app-screen/")
        assert profile["readinessTemplateRef"].startswith("adapter-readiness-template:virtual-app-screen/")
        assert profile["schemaRefs"][0] == ACTION_ADAPTER_READINESS_SCHEMA
        assert VIRTUAL_APP_SCREEN_USER_ACCEPTANCE_MANIFEST_SCHEMA in profile["schemaRefs"]
        assert set(profile["capabilityIds"]) <= declared_capabilities
        assert set(profile["supportedActions"]) <= GENERIC_ACTIONS
        assert profile["captureSupported"] is True
        assert profile["backgroundRenderable"] is True
        assert profile["affectsPhysicalDisplay"] is False
        assert profile["requiresFocusSteal"] is False
        assert profile["sharedSystemInputUsed"] is False
        assert profile["blockedReason"] is None
        assert "artifact.current-run" in profile["capabilityIds"]
        assert "gui.present" in registry["sourceBoundaryPolicy"]["requiredComputerUseChain"]

    assert {"browser", "terminal", "jupyter", "editor", "pdf-viewer", "csv-viewer"} <= {
        app_kind for profile in registry["profiles"] for app_kind in profile["targetAppKinds"]
    }
    assert FORBIDDEN_USER_LEVEL_PASS_SOURCES <= set(registry["sourceBoundaryPolicy"]["forbiddenAsUserLevelPass"])
    assert {"dom", "playwright", "accessibility"} <= set(registry["sourceBoundaryPolicy"]["forbiddenAsUserLevelPass"])


def test_adapter_registry_diagnostics_cover_virtual_app_screen_failure_taxonomy():
    registry = _load_registry()
    categories = registry["diagnosticTaxonomy"]["categories"]

    assert {category["category"] for category in categories} == REQUIRED_DIAGNOSTIC_CATEGORIES
    for category in categories:
        assert category["status"] in {"blocked", "needs-confirmation", "requires-handoff"}
        assert category["blockedReasonTemplate"]
        assert category["requiredRefs"]
        assert category["userAcceptanceEligible"] is False

    by_category = {category["category"]: category for category in categories}
    assert by_category["needs-confirmation"]["status"] == "needs-confirmation"
    assert by_category["user-handoff-required"]["status"] == "requires-handoff"
    assert by_category["isolation-failed"]["status"] == "requires-handoff"
    assert by_category["background-rendering-unavailable"]["requiredRefs"] == ["adapterReadinessRef", "blockedRef"]

    serialized = "\n".join(_walk_strings(registry))
    assert "rawScreenshot" not in serialized
    assert "base64" not in serialized
    assert "data:image" not in serialized
