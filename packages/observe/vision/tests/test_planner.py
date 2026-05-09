import sys
from pathlib import Path

import pytest


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

from sciforge_vision_sense.planner import (  # noqa: E402
    PlannerValidationError,
    extract_json_object,
    parse_planner_action,
)


def test_extract_json_object_accepts_plain_json():
    assert extract_json_object('{"action_type":"done","reason":"complete"}') == {
        "action_type": "done",
        "reason": "complete",
    }


def test_extract_json_object_accepts_fenced_json():
    assert extract_json_object('```json\n{"done": true, "reason": "ok"}\n```') == {
        "done": True,
        "reason": "ok",
    }


def test_extract_json_object_accepts_json_surrounded_by_text():
    assert extract_json_object('I will do this:\n{"action_type":"wait","reason":"loading"}\nThanks.') == {
        "action_type": "wait",
        "reason": "loading",
    }


@pytest.mark.parametrize(
    "payload",
    [
        '{"action_type":"click","target_description":"button","x":10,"y":20}',
        '{"action_type":"click","target_description":"button","coordinates":[10,20]}',
        '{"action_type":"click","target_description":"button","bbox":[0,0,10,10]}',
        '{"action_type":"click","target_description":"button","row":2,"column":3}',
    ],
)
def test_planner_rejects_coordinate_fields(payload):
    with pytest.raises(PlannerValidationError):
        parse_planner_action(payload)


@pytest.mark.parametrize(
    "target_description",
    [
        "the button at x=120 y=50",
        "the link at (120, 50)",
        "the item in row 3 column 2",
        "the icon at 120px from the left",
        "the target coordinate near the button",
    ],
)
def test_planner_rejects_coordinate_like_target_description(target_description):
    with pytest.raises(PlannerValidationError):
        parse_planner_action(
            '{"action_type":"click","target_description":'
            + repr(target_description).replace("'", '"')
            + "}"
        )


def test_planner_accepts_visual_target_description():
    action = parse_planner_action(
        """
        Here is the action:
        ```json
        {
          "action_type": "click",
          "target_description": "the blue Search button immediately to the right of the query input",
          "reason": "Search is the next visible control to submit the query"
        }
        ```
        """
    )

    assert action.action_type == "click"
    assert action.target_description == "the blue Search button immediately to the right of the query input"
    assert action.reason == "Search is the next visible control to submit the query"
