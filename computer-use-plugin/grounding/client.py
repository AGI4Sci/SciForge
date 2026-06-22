"""Grounding clients: instruction + image -> pixel coordinates.

Two interchangeable backends behind one tiny interface so the rest of the
plugin never cares which model produced the point:

  * VLMGrounder      - a general VLM (qwen3.7-plus) prompted to emit coords.
                       Tests the leader's question: is the latest Qwen accurate
                       enough to skip a dedicated grounder?
  * KVGroundGrounder - the dedicated /predict/ grounding service (GUI-Owl based).
                       Drop-in for when the专业 model is deployed.

Both return a GroundResult in ABSOLUTE pixel coords of the *input image*.
Coordinate-space conversion (crop/window/DPR) is a separate concern -> coord_map.
"""
from __future__ import annotations
import base64
import io
import json
import re
from dataclasses import dataclass
from typing import Optional

import requests
from PIL import Image


@dataclass
class GroundResult:
    x: float  # absolute px in input image
    y: float
    raw: str
    backend: str
    ok: bool = True
    error: Optional[str] = None


def _img_to_data_url(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/png;base64,{b64}"


# --- coordinate parsing -------------------------------------------------------
# Qwen3-VL family natively emits coordinates in a 0-1000 NORMALIZED space, and
# tends to answer with a bbox even when asked for a point. We pin the prompt to
# 0-1000 + a point, but defensively accept the shapes it actually produces:
#   {"point":[x,y]} / {"point_2d":[x,y]} / [x,y]
#   {"x":[x1,x2],"y":[y1,y2]}            (bbox -> center)
#   [x1,y1,x2,y2] / [[..]]               (bbox -> center)
#   click(start_box='[x,y]'), "(x, y)"  (regex fallback)
# Everything is interpreted in `coord_space` then rescaled to input pixels.
_NUM = r"-?\d+(?:\.\d+)?"
_FENCE = re.compile(r"```(?:json)?|```")


def _first_json(s: str):
    s = _FENCE.sub("", s).strip()
    for opener, closer in (("[", "]"), ("{", "}")):
        i = s.find(opener)
        if i == -1:
            continue
        depth = 0
        for j in range(i, len(s)):
            if s[j] == opener:
                depth += 1
            elif s[j] == closer:
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(s[i:j + 1])
                    except Exception:
                        break
    return None


def _xy_from_obj(obj) -> Optional[tuple[float, float]]:
    if isinstance(obj, list):
        if obj and isinstance(obj[0], (dict, list)):
            return _xy_from_obj(obj[0])  # take first candidate
        nums = [float(v) for v in obj if isinstance(v, (int, float))]
        if len(nums) == 2:
            return nums[0], nums[1]
        if len(nums) == 4:  # bbox [x1,y1,x2,y2]
            return (nums[0] + nums[2]) / 2, (nums[1] + nums[3]) / 2
    if isinstance(obj, dict):
        for k in ("point", "point_2d", "coordinate", "coordinates", "click"):
            if k in obj:
                return _xy_from_obj(obj[k])
        if "x" in obj and "y" in obj:
            xv, yv = obj["x"], obj["y"]
            if isinstance(xv, list) and isinstance(yv, list):  # {"x":[x1,x2],"y":[y1,y2]}
                return (float(xv[0]) + float(xv[-1])) / 2, (float(yv[0]) + float(yv[-1])) / 2
            return float(xv), float(yv)
        if "bbox" in obj:
            return _xy_from_obj(obj["bbox"])
    return None


def parse_point(raw: str, width: int, height: int,
                coord_space: str = "norm1000") -> Optional[tuple[float, float]]:
    obj = _first_json(raw)
    xy = _xy_from_obj(obj) if obj is not None else None
    if xy is None:
        nums = re.findall(_NUM, _FENCE.sub("", raw))
        if len(nums) >= 2:
            xy = (float(nums[0]), float(nums[1]))
    if xy is None:
        return None
    return _rescale(xy[0], xy[1], width, height, coord_space)


def _rescale(x: float, y: float, width: int, height: int, coord_space: str) -> tuple[float, float]:
    if coord_space == "norm1000":
        return x / 1000.0 * width, y / 1000.0 * height
    if coord_space == "norm1":
        return x * width, y * height
    return x, y  # pixel


class VLMGrounder:
    def __init__(self, base_url: str, api_key: str, model: str = "qwen3.7-plus",
                 timeout: int = 120, coord_space: str = "norm1000", max_side: int = 0):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        self.coord_space = coord_space  # qwen3-vl family is trained on 0-1000
        self.max_side = max_side  # downscale long side before send (0=off); norm coords stay valid

    def ground(self, image: Image.Image, instruction: str) -> GroundResult:
        w, h = image.size  # ORIGINAL dims — normalized coords rescale against these
        send_img = image
        if self.max_side and max(w, h) > self.max_side:
            s = self.max_side / max(w, h)
            send_img = image.resize((max(1, int(w * s)), max(1, int(h * s))))
        prompt = (
            f"Locate the single UI element to click for this instruction: "
            f"\"{instruction}\".\n"
            f"Output ONLY the click point as JSON: {{\"point\": [x, y]}} where x and y "
            f"are integers in the normalized 0-1000 coordinate space "
            f"(top-left origin, x rightward, y downward). One point, no bounding box, "
            f"no extra text."
        )
        body = {
            "model": self.model,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": _img_to_data_url(send_img)}},
                    {"type": "text", "text": prompt},
                ],
            }],
            "temperature": 0,
            "max_tokens": 200,
        }
        try:
            r = requests.post(f"{self.base_url}/chat/completions",
                              headers={"Authorization": f"Bearer {self.api_key}"},
                              json=body, timeout=self.timeout)
            if r.status_code != 200:
                return GroundResult(0, 0, r.text[:300], "vlm", ok=False,
                                    error=f"http {r.status_code}")
            content = r.json()["choices"][0]["message"]["content"]
            pt = parse_point(content, w, h, self.coord_space)
            if pt is None:
                return GroundResult(0, 0, content, "vlm", ok=False, error="no-coords-parsed")
            return GroundResult(pt[0], pt[1], content, "vlm")
        except Exception as e:  # noqa: BLE001
            return GroundResult(0, 0, "", "vlm", ok=False, error=str(e))


class KVGroundGrounder:
    """Dedicated grounding service exposing POST /predict/ (GUI-Owl based)."""

    def __init__(self, endpoint: str, timeout: int = 120):
        self.endpoint = endpoint.rstrip("/")
        self.timeout = timeout

    def ground(self, image: Image.Image, instruction: str) -> GroundResult:
        buf = io.BytesIO()
        image.convert("RGB").save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode()
        try:
            r = requests.post(f"{self.endpoint}/predict/",
                              json={"image_base64": b64, "image_mime_type": "image/png",
                                    "text_prompt": instruction},
                              timeout=self.timeout)
            if r.status_code != 200:
                return GroundResult(0, 0, r.text[:300], "kvground", ok=False,
                                    error=f"http {r.status_code}")
            d = r.json()
            x, y = d["coordinates"]  # already absolute px in input image
            return GroundResult(float(x), float(y), d.get("raw_text", ""), "kvground")
        except Exception as e:  # noqa: BLE001
            return GroundResult(0, 0, "", "kvground", ok=False, error=str(e))
