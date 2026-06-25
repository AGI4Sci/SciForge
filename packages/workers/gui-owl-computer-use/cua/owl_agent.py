"""Native GUI-Owl-1.5 driver — no Agent-S, no planner/grounder split.

GUI-Owl 1.5 (Qwen3-VL based) is a full end-to-end GUI agent: given the system
prompt (which defines the `computer_use` action space), the task, the previous
actions, and the current screenshot, it returns one step as:

    Action: <short imperative>
    <tool_call>
    {"name": "computer_use", "arguments": {"action": "...", ...}}
    </tool_call>

Coordinates are in a 1000x1000 normalized space (the system prompt tells the
model "the screen's resolution is 1000x1000"); we map them to real screen pixels.

This module only talks to the model and parses its output. Execution (mapping a
parsed action to mouse/keyboard) lives in the runner via DesktopExecutor.

Prompt + action space + parsing are reproduced from the official PC inference
script (X-PLUG/MobileAgent, Mobile-Agent-v3.5/computer_use).
"""
from __future__ import annotations

import ast
import base64
import io
import json
import re
from typing import Any, Dict, List, Optional, Tuple

import requests
from PIL import Image

# --- system prompt (verbatim from the official computer_use action space) -----
SYSTEM_PROMPT = (
    "# Tools\n\n"
    "You may call one or more functions to assist with the user query.\n\n"
    "You are provided with function signatures within <tools></tools> XML tags:\n"
    "<tools>\n"
    '{"type": "function", "function": {"name": "computer_use", '
    '"description": "Use a mouse and keyboard to interact with a computer, '
    "and take screenshots.\\n"
    "* This is an interface to a desktop GUI. You do not have access to a "
    "terminal or applications menu. You must click on desktop icons to start "
    "applications.\\n"
    "* Some applications may take time to start or process actions, so you "
    "may need to wait and take successive screenshots to see the results of "
    "your actions. E.g. if you click on Firefox and a window doesn't open, "
    "try wait and taking another screenshot.\\n"
    "* The screen's resolution is 1000x1000.\\n"
    "* Make sure to click any buttons, links, icons, etc with the cursor tip "
    "in the center of the element. Don't click boxes on their edges unless "
    'asked.", '
    '"parameters": {"properties": {"action": {"description": '
    '"The action to perform. The available actions are:\\n'
    "* `key`: Performs key down presses on the arguments passed in order, "
    "then performs key releases in reverse order.\\n"
    "* `type`: Type a string of text on the keyboard.\\n"
    "* `mouse_move`: Move the cursor to a specified (x, y) pixel coordinate "
    "on the screen.\\n"
    "* `left_click`: Click the left mouse button at a specified (x, y) pixel "
    "coordinate on the screen.\\n"
    "* `left_click_drag`: Click and drag the cursor to a specified (x, y) "
    "pixel coordinate on the screen.\\n"
    "* `right_click`: Click the right mouse button at a specified (x, y) "
    "pixel coordinate on the screen.\\n"
    "* `middle_click`: Click the middle mouse button at a specified (x, y) "
    "pixel coordinate on the screen.\\n"
    "* `double_click`: Double-click the left mouse button at a specified "
    "(x, y) pixel coordinate on the screen.\\n"
    "* `triple_click`: Triple-click the left mouse button at a specified "
    "(x, y) pixel coordinate on the screen.\\n"
    "* `scroll`: Performs a scroll of the mouse scroll wheel.\\n"
    "* `hscroll`: Performs a horizontal scroll.\\n"
    "* `wait`: Wait specified seconds for the change to happen.\\n"
    "* `terminate`: Terminate the current task and report its completion "
    "status.\\n"
    "* `answer`: Answer a question.\\n"
    '* `interact`: Resolve the blocking window by interacting with the user.", '
    '"enum": ["key", "type", "mouse_move", "left_click", "left_click_drag", '
    '"right_click", "middle_click", "double_click", "triple_click", "scroll", '
    '"hscroll", "wait", "terminate", "answer", "interact"], "type": "string"}, '
    '"keys": {"description": "Required only by `action=key`.", '
    '"type": "array"}, '
    '"text": {"description": "Required only by `action=type`, `action=answer` '
    'and `action=interact`.", "type": "string"}, '
    '"coordinate": {"description": "(x, y): The x (pixels from the left edge) '
    "and y (pixels from the top edge) coordinates to move the mouse to. "
    'Required only by `action=mouse_move` and `action=left_click_drag`.", '
    '"type": "array"}, '
    '"pixels": {"description": "The amount of scrolling to perform. Positive '
    "values scroll up, negative values scroll down. Required only by "
    '`action=scroll` and `action=hscroll`.", "type": "number"}, '
    '"time": {"description": "The seconds to wait. Required only by '
    '`action=wait`.", "type": "number"}, '
    '"status": {"description": "The status of the task. Required only by '
    '`action=terminate`.", "type": "string", "enum": ["success", "failure"]}}, '
    '"required": ["action"], "type": "object"}}}\n'
    "</tools>\n\n"
    "For each function call, return a json object with function name and "
    "arguments within <tool_call></tool_call> XML tags:\n"
    "<tool_call>\n"
    '{"name": <function-name>, "arguments": <args-json-object>}\n'
    "</tool_call>\n\n"
    "# Response format\n\n"
    "Response format for every step:\n"
    "1) Action: a short imperative describing what to do in the UI.\n"
    "2) A single <tool_call>...</tool_call> block containing only the JSON: "
    '{"name": <function-name>, "arguments": <args-json-object>}.\n\n'
    "Rules:\n"
    "- Output exactly in the order: Action, <tool_call>.\n"
    "- Be brief: one for Action.\n"
    "- Do not output anything else outside those two parts.\n"
    "- If finishing, use action=terminate in the tool call."
)

GROUNDING_DIM = 1000  # the model's normalized coordinate space


def _png_data_url(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _preamble(instruction: str) -> str:
    """Official first-turn user text (X-PLUG/MobileAgent gui_owl.py)."""
    return (
        "Please generate the next move according to the UI screenshot, "
        "instruction and previous actions.\n\n"
        f"Instruction: {instruction}\n\n"
        "Previous actions:\nNo previous action."
    )


def _image_part(src: Any) -> Dict[str, Any]:
    img = src if isinstance(src, Image.Image) else Image.open(src)
    return {"type": "image_url", "image_url": {"url": _png_data_url(img)}}


def build_messages(instruction: str, history: List[Dict[str, str]],
                   cur_img: Image.Image, image_window: int = 2,
                   progress_status: str = "", replan_hint: bool = False
                   ) -> List[Dict[str, Any]]:
    """Build the official GUI-Owl multi-turn conversation for the current step.

    A real growing chat (one task = one run = one conversation):

        system : action space
        user   : [task text, screenshot_0]   assistant: action_0
        user   : [screenshot_1]              assistant: action_1
        ...
        user   : [screenshot_i]              <- current; the model answers this

    Sliding window (official `cut_current_messages(last_image=N)`): only the most
    recent `image_window` user turns keep their screenshot; older user turns drop
    the image (the assistant action outputs carry that history forward as text),
    which also keeps the request within the vLLM image-per-prompt cap.

    `history[k]` = {"output": raw model output for step k, "image": screenshot path}.
    The task text always stays in user turn 0 even after its image is windowed out.
    When the Reflector is on, its running `progress_status` / `replan_hint` are
    attached to the current turn.
    """
    msgs: List[Dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    n_user = len(history) + 1                       # prior observations + current
    keep_from = max(0, n_user - max(1, image_window))

    for k, item in enumerate(history):
        parts: List[Dict[str, Any]] = []
        if k == 0:
            parts.append({"type": "text", "text": _preamble(instruction)})
        if k >= keep_from:
            parts.append(_image_part(item.get("image")))
        elif k != 0:
            parts.append({"type": "text", "text": "(screenshot from this step omitted)"})
        msgs.append({"role": "user", "content": parts})
        msgs.append({"role": "assistant",
                     "content": [{"type": "text", "text": item.get("output", "")}]})

    cur_parts: List[Dict[str, Any]] = []
    if not history:
        cur_parts.append({"type": "text", "text": _preamble(instruction)})
    if progress_status:
        cur_parts.append({"type": "text", "text": f"Progress so far: {progress_status}"})
    if replan_hint:
        cur_parts.append({"type": "text", "text":
                          "Note: your recent actions did not make progress. Step back "
                          "and rethink your overall approach before choosing the next action."})
    cur_parts.append(_image_part(cur_img))
    msgs.append({"role": "user", "content": cur_parts})
    return msgs


def call_owl(base_url: str, model: str, api_key: str,
             messages: List[Dict[str, Any]], timeout: float = 120.0,
             max_tokens: int = 1024) -> str:
    """POST to an OpenAI-compatible /chat/completions and return the text."""
    url = base_url.rstrip("/") + "/chat/completions"
    headers = {"Content-Type": "application/json"}
    if api_key and api_key != "EMPTY":
        headers["Authorization"] = f"Bearer {api_key}"
    body = {"model": model, "messages": messages,
            "max_tokens": max_tokens, "temperature": 0.0, "stream": False}
    r = requests.post(url, headers=headers, json=body, timeout=timeout)
    r.raise_for_status()
    msg = r.json()["choices"][0]["message"]
    text = msg.get("content") or ""
    if isinstance(text, list):  # some servers return content as parts
        text = "".join(p.get("text", "") for p in text if isinstance(p, dict))
    reasoning = msg.get("reasoning_content")
    if reasoning:
        text = f"<thinking>\n{reasoning}\n</thinking>{text}"
    return text


def extract_action(text: str) -> Optional[Dict[str, Any]]:
    """Parse the first computer_use tool call from the model output.

    Returns the `arguments` dict (with raw 0-1000 coords), or None if no
    parseable tool call is present.
    """
    for blk in re.findall(r"<tool_call>(.*?)</tool_call>", text, re.DOTALL | re.IGNORECASE):
        blk = blk.strip()
        obj = None
        for parse in (json.loads, ast.literal_eval):
            try:
                obj = parse(blk)
                break
            except Exception:  # noqa: BLE001
                continue
        if isinstance(obj, dict):
            args = obj.get("arguments", obj)
            if isinstance(args, dict) and args.get("action"):
                return args
    return None


def to_screen(coord, w: int, h: int) -> Tuple[int, int]:
    """Map a model 0-1000 normalized (x, y) to pixel coords of a w x h screen."""
    x = max(0, min(GROUNDING_DIM, float(coord[0])))
    y = max(0, min(GROUNDING_DIM, float(coord[1])))
    return int(round(x / GROUNDING_DIM * w)), int(round(y / GROUNDING_DIM * h))
