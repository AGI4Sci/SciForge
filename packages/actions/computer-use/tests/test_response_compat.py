import pytest

from sciforge_computer_use.response_compat import (
    chat_completion_to_response,
    chat_completions_to_responses,
    extract_provider_text,
    responses_to_chat_completions,
    text_from_content,
)


def test_responses_to_chat_completions_matches_backend_minimal_shape():
    request = responses_to_chat_completions({
        "model": "planner-model",
        "instructions": [{"type": "input_text", "text": "Be precise."}],
        "input": [
            {"role": "user", "content": [{"type": "input_text", "text": "Search TODOs"}]},
            {"type": "function_call", "call_id": "call_1", "name": "exec_command", "arguments": {"cmd": "pwd"}},
            {"type": "function_call_output", "call_id": "call_1", "output": "ok"},
        ],
        "max_output_tokens": 128,
        "temperature": 0,
        "tools": [{"type": "function", "name": "exec_command", "parameters": {"type": "object"}}],
    })

    assert request["model"] == "planner-model"
    assert request["messages"][0] == {"role": "system", "content": "Be precise."}
    assert request["messages"][1] == {"role": "user", "content": "Search TODOs"}
    assert request["messages"][2]["role"] == "assistant"
    assert request["messages"][2]["tool_calls"][0]["function"]["arguments"] == '{"cmd": "pwd"}'
    assert request["messages"][3] == {"role": "tool", "tool_call_id": "call_1", "content": "ok"}
    assert request["max_tokens"] == 128
    assert request["tools"][0]["function"]["name"] == "exec_command"


def test_responses_to_chat_completions_falls_back_to_max_tokens_when_max_output_tokens_is_null():
    request = responses_to_chat_completions({
        "model": "planner-model",
        "input": "respond briefly",
        "max_output_tokens": None,
        "max_tokens": 64,
        "tool_choice": "auto",
        "parallel_tool_calls": False,
        "metadata": {"traceRef": "trace:compat"},
    })

    assert request["max_tokens"] == 64
    assert request["tool_choice"] == "auto"
    assert request["parallel_tool_calls"] is False
    assert request["metadata"] == {"traceRef": "trace:compat"}


def test_chat_completion_to_response_exposes_output_text():
    response = chat_completion_to_response({
        "id": "chatcmpl_1",
        "model": "chat-model",
        "created": 123,
        "choices": [{"message": {"role": "assistant", "content": "SCIFORGE_BACKEND_OK"}}],
        "usage": {"total_tokens": 5},
    })

    assert response["id"] == "chatcmpl_1"
    assert response["status"] == "completed"
    assert response["output_text"] == "SCIFORGE_BACKEND_OK"
    assert response["output"][0]["content"][0]["type"] == "output_text"
    assert response["usage"] == {"total_tokens": 5}


def test_chat_completions_to_responses_preserves_fallback_fields():
    image_ref = "https://example.invalid/image.png"
    request = chat_completions_to_responses({
        "model": "vision-model",
        "temperature": 0,
        "top_p": 1,
        "max_tokens": 160,
        "parallel_tool_calls": False,
        "metadata": {"traceRef": "trace:compat"},
        "tool_choice": {"type": "function", "function": {"name": "exec_command"}},
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "exec_command",
                    "description": "run command",
                    "parameters": {"type": "object", "properties": {"cmd": {"type": "string"}}},
                },
            }
        ],
        "messages": [
            {"role": "system", "content": "Return compact JSON only."},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "inspect"},
                    {"type": "image_url", "image_url": {"url": image_ref}},
                ],
            },
        ],
    })

    assert request["model"] == "vision-model"
    assert request["instructions"] == "Return compact JSON only."
    assert request["max_output_tokens"] == 160
    assert request["parallel_tool_calls"] is False
    assert request["metadata"] == {"traceRef": "trace:compat"}
    assert request["tool_choice"] == {"type": "function", "name": "exec_command"}
    assert request["tools"] == [
        {
            "type": "function",
            "name": "exec_command",
            "description": "run command",
            "parameters": {"type": "object", "properties": {"cmd": {"type": "string"}}},
        }
    ]
    assert request["input"][0]["role"] == "user"
    assert request["input"][0]["content"][0] == {"type": "input_text", "text": "inspect"}
    assert request["input"][0]["content"][1] == {"type": "input_image", "image_url": image_ref}


def test_chat_completions_to_responses_converts_tool_turns():
    request = chat_completions_to_responses({
        "model": "planner-model",
        "messages": [
            {
                "role": "assistant",
                "content": "calling",
                "tool_calls": [
                    {
                        "id": "call_1",
                        "type": "function",
                        "function": {"name": "exec_command", "arguments": {"cmd": "pwd"}},
                    }
                ],
            },
            {"role": "tool", "tool_call_id": "call_1", "content": "ok"},
        ],
    })

    assert request["input"][0] == {
        "role": "assistant",
        "content": [{"type": "output_text", "text": "calling"}],
    }
    assert request["input"][1]["type"] == "function_call"
    assert request["input"][1]["call_id"] == "call_1"
    assert request["input"][1]["arguments"] == '{"cmd": "pwd"}'
    assert request["input"][2] == {"type": "function_call_output", "call_id": "call_1", "output": "ok"}


def test_chat_completion_to_response_accepts_chat_content_part_list():
    response = chat_completion_to_response({
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": [
                        {"type": "text", "text": "SCIFORGE"},
                        {"type": "output_text", "text": "BACKEND_OK"},
                    ],
                },
            }
        ],
        "raw_provider_body": {"choices": [{"message": {"content": "raw body decoy"}}]},
    })

    assert response["output_text"] == "SCIFORGE\nBACKEND_OK"
    assert response["output"][0]["content"][0]["text"] == "SCIFORGE\nBACKEND_OK"


def test_chat_completion_to_response_converts_tool_calls_with_unique_ids():
    response = chat_completion_to_response({
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "type": "function",
                            "function": {"name": "exec_command", "arguments": "{\"cmd\":\"pwd\"}"},
                        },
                        {
                            "id": "call_2",
                            "type": "function",
                            "function": {"name": "read_file", "arguments": {"path": "README.md"}},
                        },
                    ],
                },
            }
        ],
    })

    assert response["output_text"] == ""
    assert [item["type"] for item in response["output"]] == ["function_call", "function_call"]
    assert response["output"][0]["call_id"] == "call_1"
    assert response["output"][0]["arguments"] == "{\"cmd\":\"pwd\"}"
    assert response["output"][1]["call_id"] == "call_2"
    assert response["output"][1]["arguments"] == '{"path": "README.md"}'
    assert response["output"][0]["id"] != response["output"][1]["id"]


def test_responses_to_chat_completions_accepts_string_and_nested_text_content():
    request = responses_to_chat_completions({
        "model": "planner-model",
        "input": [
            {"role": "user", "content": "plain user content"},
            {
                "role": "assistant",
                "content": [
                    {"type": "text", "text": "nested text part"},
                    {"type": "output_text", "text": "nested output part"},
                ],
            },
        ],
    })

    assert request["messages"] == [
        {"role": "user", "content": "plain user content"},
        {"role": "assistant", "content": "nested text part\nnested output part"},
    ]


def test_extract_provider_text_accepts_responses_and_chat_shapes():
    assert extract_provider_text({"output_text": "from output_text"}) == "from output_text"
    assert extract_provider_text({
        "output": [
            {"content": [{"type": "output_text", "text": "from"}, {"type": "output_text", "text": "parts"}]},
        ]
    }) == "from parts"
    assert extract_provider_text({
        "choices": [{"message": {"content": [{"type": "text", "text": "from chat parts"}]}}],
    }) == "from chat parts"


def test_extract_provider_text_accepts_responses_output_content_string():
    assert extract_provider_text({
        "output": [
            {"type": "message", "role": "assistant", "content": "from response content string"},
        ],
        "raw_provider_body": {"output_text": "raw body decoy"},
    }) == "from response content string"


@pytest.mark.parametrize(
    ("content", "expected"),
    [
        ("from chat string", "from chat string"),
        (
            [
                {"type": "text", "text": "from chat"},
                {"type": "output_text", "text": "parts"},
            ],
            "from chat\nparts",
        ),
    ],
)
def test_extract_provider_text_accepts_chat_message_content_shapes(content, expected):
    assert extract_provider_text({
        "choices": [{"message": {"role": "assistant", "content": content}}],
        "raw_provider_body": {"choices": [{"message": {"content": "raw body decoy"}}]},
    }) == expected


def test_extract_provider_text_does_not_fall_back_to_raw_provider_body():
    with pytest.raises(ValueError, match="Provider response"):
        extract_provider_text({
            "raw_provider_body": {
                "output_text": "raw body text",
                "choices": [{"message": {"content": "raw body chat text"}}],
            }
        })


def test_extract_provider_text_rejects_inline_image_text_payloads():
    inline_payload = "data:" + "image/png;" + "base" + "64,payload"
    with pytest.raises(ValueError, match="Provider response"):
        extract_provider_text({
            "output": [{"content": [{"type": "input_image", "text": inline_payload}]}],
            "choices": [{"message": {"content": inline_payload}}],
        })


def test_extract_provider_text_rejects_unknown_shape():
    with pytest.raises(ValueError, match="Provider response"):
        extract_provider_text({"object": "response"})


def test_text_from_content_keeps_image_parts_as_textless_json_diagnostics():
    text = text_from_content([
        {"type": "input_text", "text": "inspect"},
        {"type": "input_image", "image_url": "data:image/png;base64,SECRET"},
    ])

    assert "inspect" in text
    assert "redacted-image" in text
    assert "data:image" not in text
    assert "base64" not in text.lower()
    assert "SECRET" not in text
