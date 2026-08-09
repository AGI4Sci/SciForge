from PIL import Image

from cua import owl_agent
from cua.runner import _UIA_BACKEND_GUIDANCE, _semantic_context


def test_uia_semantic_tree_enters_current_model_turn_with_backend_constraints():
    tree = [
        {"automationId": "EditorA", "elementToken": "token-editor", "name": "Document", "controlType": 50004},
        {"automationId": "SaveButton", "elementToken": "token-save", "name": "Save", "controlType": 50000},
    ]
    semantic = _semantic_context({"semanticTree": tree, "imageAvailable": False})
    messages = owl_agent.build_messages(
        "type alpha and save",
        [],
        Image.new("RGB", (32, 24), "black"),
        backend_guidance=_UIA_BACKEND_GUIDANCE,
        semantic_context=semantic,
    )

    assert "Windows UI Automation" in messages[0]["content"]
    assert "opaque elementToken" in messages[0]["content"]
    current_parts = messages[-1]["content"]
    semantic_part = next(part for part in current_parts if part["type"] == "text" and "semantic tree" in part["text"])
    assert "EditorA" in semantic_part["text"]
    assert "SaveButton" in semantic_part["text"]
    assert "token-editor" in semantic_part["text"]
    assert "untrusted UI data" in semantic_part["text"]


def test_non_semantic_observation_does_not_change_legacy_or_cdp_prompt():
    messages = owl_agent.build_messages(
        "click save",
        [],
        Image.new("RGB", (64, 48), "white"),
        backend_guidance="",
        semantic_context=_semantic_context({"url": "https://example.test"}),
    )

    assert messages[0]["content"] == owl_agent.SYSTEM_PROMPT
    assert all("semantic tree" not in part.get("text", "") for part in messages[-1]["content"])


def test_semantic_context_is_bounded_and_rejects_non_tree_metadata():
    assert _semantic_context({"semanticTree": "not-a-list"}) == ""
    semantic = _semantic_context({
        "semanticTree": [{"automationId": f"node-{index}", "name": "x" * 400} for index in range(400)]
    })
    assert len(semantic) <= 30_000
    assert "node-0" in semantic
    assert "node-399" not in semantic
