import sys
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

from sciforge_vision_sense.prompts import (  # noqa: E402
    build_completion_check_prompt,
    build_crosshair_verification_prompt,
    build_planner_prompt,
    build_screen_summary_prompt,
    build_visible_texts_prompt,
)
from sciforge_vision_sense.vlm import (  # noqa: E402
    VisionVlmClient,
    VisionVlmConfig,
    VisionVlmError,
    build_user_message_with_image,
    parse_completion_check_response,
    parse_crosshair_verification_response,
    parse_visible_texts_response,
)


def test_vlm_config_defaults_to_qwen_plus_model():
    config = VisionVlmConfig(base_url="https://example.test/v1", api_key="secret")

    assert config.model == "qwen3.6-plus"


def test_vlm_client_uses_configured_chat_completions_endpoint_and_model():
    client = VisionVlmClient(VisionVlmConfig(base_url="https://example.test/v1", api_key="secret", model="custom-model"))

    assert client.config.model == "custom-model"
    assert client._chat_completions_url() == "https://example.test/v1/chat/completions"


def test_image_message_uses_openai_compatible_base64_content_shape():
    message = build_user_message_with_image("look", image_base64="YWJj", mime_type="image/jpeg")

    assert message == {
        "role": "user",
        "content": [
            {"type": "text", "text": "look"},
            {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,YWJj"}},
        ],
    }


def test_prompt_builders_define_json_contracts_and_coordinate_ban():
    completion = build_completion_check_prompt(task="finish checkout", step_history=[])
    planner = build_planner_prompt(task="search paper", screen_summary="A browser page", visible_texts=["Search"], recent_actions=[])
    crosshair = build_crosshair_verification_prompt(target_description="the Search button")
    summary = build_screen_summary_prompt(task="search paper")
    visible_texts = build_visible_texts_prompt(task="search paper")

    assert '"done": boolean' in completion
    assert "target_description" in planner
    assert "Never include coordinates" in planner
    assert '"hit": boolean' in crosshair
    assert "one concise sentence" in summary
    assert '"visible_texts"' in visible_texts
    assert "Do not include DOM" in visible_texts


def test_completion_check_response_parser_accepts_strict_json_contract():
    parsed = parse_completion_check_response(
        '{"done": false, "reason": "Need another click", "confidence": 0.82}'
    )

    assert parsed.done is False
    assert parsed.reason == "Need another click"
    assert parsed.confidence == 0.82


def test_completion_check_response_parser_rejects_invalid_confidence():
    try:
        parse_completion_check_response(
            '{"done": true, "reason": "done", "confidence": 2}'
        )
    except VisionVlmError as exc:
        assert "between 0 and 1" in str(exc)
    else:
        raise AssertionError("expected VisionVlmError")


def test_crosshair_response_parser_accepts_revised_target_without_coordinates():
    parsed = parse_crosshair_verification_response(
        '{"hit": false, "reason": "on the wrong label", "confidence": 0.64, "revised_target_description": "the empty input field below the Search label"}'
    )

    assert parsed.hit is False
    assert parsed.revised_target_description == "the empty input field below the Search label"


def test_crosshair_response_parser_rejects_revised_target_coordinates():
    try:
        parse_crosshair_verification_response(
            '{"hit": false, "reason": "wrong", "confidence": 0.64, "revised_target_description": "click x=10 y=20"}'
        )
    except VisionVlmError as exc:
        assert "must not contain coordinates" in str(exc)
    else:
        raise AssertionError("expected VisionVlmError")


def test_visible_texts_response_parser_accepts_approximate_regions():
    parsed = parse_visible_texts_response(
        '{"visible_texts": [{"text": "Search", "approximateRegion": "top center"}]}'
    )

    assert parsed[0].text == "Search"
    assert parsed[0].approximate_region == "top center"


def test_visible_texts_response_parser_rejects_coordinate_regions():
    try:
        parse_visible_texts_response(
            '{"visible_texts": [{"text": "Search", "approximateRegion": "(10, 20)"}]}'
        )
    except VisionVlmError as exc:
        assert "must not contain coordinates" in str(exc)
    else:
        raise AssertionError("expected VisionVlmError")
