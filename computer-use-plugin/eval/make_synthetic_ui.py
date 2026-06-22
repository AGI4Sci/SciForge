"""Generate a synthetic GUI screenshot with KNOWN element bounding boxes.

This is a fast, label-free sanity check for grounding: we control the truth
boxes exactly, so point-in-box accuracy needs no manual annotation. Synthetic
UIs are *easier* than real screenshots, so treat results as an upper bound /
smoke test, not a benchmark number. Real screenshots (ScreenSpot etc.) come next.
"""
from __future__ import annotations
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


def _font(size: int):
    for name in ("arial.ttf", "DejaVuSans.ttf", "segoeui.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()


def build(out_dir: Path) -> dict:
    W, H = 1280, 800
    img = Image.new("RGB", (W, H), (240, 241, 245))
    d = ImageDraw.Draw(img)
    f = _font(18)
    fsmall = _font(14)
    targets = []

    def button(x, y, w, h, label, fill, fg=(255, 255, 255), tid=None):
        d.rounded_rectangle([x, y, x + w, y + h], radius=6, fill=fill)
        tb = d.textbbox((0, 0), label, font=f)
        tw, th = tb[2] - tb[0], tb[3] - tb[1]
        d.text((x + (w - tw) / 2, y + (h - th) / 2 - 2), label, font=f, fill=fg)
        targets.append({"id": tid or label, "label": label, "bbox": [x, y, x + w, y + h]})

    # top menu bar
    d.rectangle([0, 0, W, 44], fill=(33, 37, 43))
    for i, m in enumerate(["File", "Edit", "View", "Help"]):
        mx = 16 + i * 70
        d.text((mx, 12), m, font=f, fill=(220, 220, 220))
        tb = d.textbbox((0, 0), m, font=f)
        targets.append({"id": f"menu_{m}", "label": f"{m} menu", "bbox": [mx - 6, 6, mx + (tb[2]-tb[0]) + 6, 38]})

    # toolbar buttons
    button(900, 56, 110, 36, "Save", (52, 120, 246), tid="save_btn")
    button(1020, 56, 110, 36, "Export", (40, 167, 99), tid="export_btn")
    button(1140, 56, 120, 36, "Delete", (220, 64, 64), tid="delete_btn")

    # left search field
    d.rectangle([16, 110, 360, 146], outline=(180, 180, 180), width=2, fill=(255, 255, 255))
    d.text((26, 120), "Search documents...", font=f, fill=(150, 150, 150))
    targets.append({"id": "search_field", "label": "search input box", "bbox": [16, 110, 360, 146]})

    # a checkbox
    d.rectangle([16, 170, 36, 190], outline=(120, 120, 120), width=2, fill=(255, 255, 255))
    d.text((44, 170), "Enable notifications", font=fsmall, fill=(40, 40, 40))
    targets.append({"id": "checkbox", "label": "Enable notifications checkbox", "bbox": [16, 170, 36, 190]})

    # primary CTA bottom-right
    button(1080, 730, 180, 50, "Submit", (124, 58, 237), tid="submit_btn")
    # cancel next to it
    button(900, 730, 160, 50, "Cancel", (110, 116, 128), tid="cancel_btn")

    # a content list with two similar "Download" links (disambiguation case)
    for i, y in enumerate((230, 290)):
        d.text((40, y), f"paper_{i+1}.pdf", font=f, fill=(30, 30, 30))
        button(300, y - 4, 120, 30, "Download", (52, 120, 246), tid=f"download_{i+1}")

    out_dir.mkdir(parents=True, exist_ok=True)
    img_path = out_dir / "synthetic_ui.png"
    img.save(img_path)
    truth = {"image": img_path.name, "width": W, "height": H, "targets": targets}
    (out_dir / "synthetic_ui_truth.json").write_text(json.dumps(truth, indent=2))
    return truth


if __name__ == "__main__":
    t = build(Path(__file__).parent / "_assets")
    print(f"wrote {t['width']}x{t['height']} with {len(t['targets'])} targets")
