"""Grounding accuracy probe: instruction + image -> coords -> point-in-box.

Usage:
  python eval/grounding_probe.py --backend qwen      # qwen3.7-plus via gateway
  python eval/grounding_probe.py --backend guiowl    # GUI-Owl-1.5 via local/tunnel vLLM
Env (override defaults):
  QWEN_BASE_URL/QWEN_API_KEY/QWEN_MODEL, GUIOWL_BASE_URL/GUIOWL_MODEL
"""
from __future__ import annotations
import argparse
import os
import sys
import json
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from grounding.client import VLMGrounder, GroundResult  # noqa: E402
from eval.make_synthetic_ui import build  # noqa: E402

GATEWAY = "http://35.220.164.252:3888/v1"
GATEWAY_KEY = os.environ.get("QWEN_API_KEY", "")  # set QWEN_API_KEY; never hardcode secrets


def make_grounder(backend: str) -> VLMGrounder:
    if backend == "qwen":
        return VLMGrounder(os.environ.get("QWEN_BASE_URL", GATEWAY),
                           os.environ.get("QWEN_API_KEY", GATEWAY_KEY),
                           os.environ.get("QWEN_MODEL", "qwen3.7-plus"), coord_space="norm1000")
    if backend == "guiowl":
        return VLMGrounder(os.environ.get("GUIOWL_BASE_URL", "http://127.0.0.1:18901/v1"),
                           os.environ.get("GUIOWL_API_KEY", "EMPTY"),
                           os.environ.get("GUIOWL_MODEL", "gui-owl-1.5-8b"), coord_space="norm1000")
    raise SystemExit(f"unknown backend {backend}")


def in_box(x, y, box) -> bool:
    return box[0] <= x <= box[2] and box[1] <= y <= box[3]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", default="qwen", choices=["qwen", "guiowl"])
    args = ap.parse_args()
    MODEL = args.backend
    assets = Path(__file__).parent / "_assets"
    truth = build(assets)
    img = Image.open(assets / truth["image"]).convert("RGB")
    grounder = make_grounder(args.backend)

    overlay = img.copy()
    draw = ImageDraw.Draw(overlay)
    rows, n_ok, n_hit = [], 0, 0
    for t in truth["targets"]:
        res: GroundResult = grounder.ground(img, t["label"])
        hit = res.ok and in_box(res.x, res.y, t["bbox"])
        n_ok += int(res.ok)
        n_hit += int(hit)
        rows.append({"id": t["id"], "label": t["label"], "bbox": t["bbox"],
                     "pred": [round(res.x, 1), round(res.y, 1)] if res.ok else None,
                     "ok": res.ok, "hit": hit, "raw": res.raw[:80], "error": res.error})
        # draw truth box (green) + predicted point (red)
        draw.rectangle(t["bbox"], outline=(0, 200, 0), width=2)
        if res.ok:
            c = (0, 180, 0) if hit else (230, 0, 0)
            draw.line([res.x - 9, res.y, res.x + 9, res.y], fill=c, width=2)
            draw.line([res.x, res.y - 9, res.x, res.y + 9], fill=c, width=2)
        print(f"[{'HIT' if hit else 'MISS' if res.ok else 'ERR'}] {t['label']:38} "
              f"pred={rows[-1]['pred']} truth={t['bbox']} {res.error or ''}")

    overlay_path = assets / f"synthetic_overlay_{MODEL}.png"
    overlay.save(overlay_path)
    n = len(truth["targets"])
    report = {"model": MODEL, "n": n, "parsed_ok": n_ok, "in_box_hits": n_hit,
              "point_in_box_acc": round(n_hit / n, 3), "rows": rows}
    (assets / f"grounding_report_{MODEL}.json").write_text(json.dumps(report, indent=2))
    print(f"\n=== {MODEL} | parsed {n_ok}/{n} | point-in-box {n_hit}/{n} "
          f"= {report['point_in_box_acc']:.1%} ===")
    print(f"overlay -> {overlay_path}")


if __name__ == "__main__":
    main()
