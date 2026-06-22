"""ScreenSpot-Pro grounding benchmark — point-in-box, bucketed by type & size.

Backend-agnostic: scores any grounder exposing .ground(image, instruction)->GroundResult.
Runs on the GPU box (data local, GUI-Owl on localhost, qwen3.7-plus via gateway).

Usage:
  python eval/screenspot_bench.py --data <dir> --backend guiowl --limit 200
  python eval/screenspot_bench.py --data <dir> --backend qwen   --limit 200

ScreenSpot-Pro samples carry an absolute-pixel target bbox + data_type (text|icon).
We report overall point-in-box plus per-type and per-size-bucket breakdowns — the
buckets are where general VLMs fall apart (tiny icons) vs dedicated grounders.
"""
from __future__ import annotations
import argparse
import json
import os
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from grounding.client import VLMGrounder, GroundResult  # noqa: E402

GATEWAY = "http://35.220.164.252:3888/v1"
GATEWAY_KEY = os.environ.get("QWEN_API_KEY", "")  # set QWEN_API_KEY; never hardcode secrets


def make_grounder(backend: str):
    # downscale long side before send (SS-Pro images are ~4K; remote gateway times
    # out on multi-MB payloads). norm-1000 coords stay valid against original dims.
    max_side = int(os.environ.get("GROUND_MAX_SIDE", "0"))
    if backend == "qwen":
        return VLMGrounder(os.environ.get("QWEN_BASE_URL", GATEWAY),
                           os.environ.get("QWEN_API_KEY", GATEWAY_KEY),
                           os.environ.get("QWEN_MODEL", "qwen3.7-plus"),
                           coord_space="norm1000", max_side=max_side)
    if backend == "guiowl":
        # local vLLM, OpenAI-compatible. GUI-Owl-1.5 (Qwen3-VL) -> 0-1000 coords.
        return VLMGrounder(os.environ.get("GUIOWL_BASE_URL", "http://127.0.0.1:18901/v1"),
                           os.environ.get("GUIOWL_API_KEY", "EMPTY"),
                           os.environ.get("GUIOWL_MODEL", "gui-owl-1.5-8b"),
                           coord_space="norm1000", max_side=max_side)
    raise SystemExit(f"unknown backend {backend}")


def size_bucket(bbox) -> str:
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    area = max(w, 0) * max(h, 0)
    if area < 32 * 32:
        return "tiny(<32px)"
    if area < 96 * 96:
        return "small"
    return "large"


def load_samples(data_dir: Path):
    """Robust loader for the common ScreenSpot-Pro layouts.

    Supports: (0) HF parquet with inline image bytes (via pyarrow, preferred);
              (1) annotation JSON(s) + images dir referencing img_filename;
              (2) HF/parquet with inline image bytes (via `datasets`).
    Yields dicts: {image: PIL.Image, instruction, bbox:[x1,y1,x2,y2], data_type}.
    """
    import io
    parquets = sorted(data_dir.rglob("*.parquet"))
    if parquets:
        import pyarrow.parquet as pq
        for pf in parquets:
            tbl = pq.read_table(pf)
            cols = {c: tbl.column(c).to_pylist() for c in tbl.schema.names
                    if c in ("image", "bbox", "instruction", "ui_type", "data_type")}
            n = len(cols.get("bbox", []))
            for i in range(n):
                img = cols["image"][i]
                if isinstance(img, dict):
                    img = img.get("bytes") or img.get("path")
                if isinstance(img, (bytes, bytearray)):
                    pim = Image.open(io.BytesIO(img)).convert("RGB")
                else:
                    pim = Image.open(img).convert("RGB")
                yield {"image": pim, "instruction": cols["instruction"][i],
                       "bbox": list(cols["bbox"][i]),
                       "data_type": (cols.get("ui_type") or cols.get("data_type"))[i]}
        return
    jsons = list(data_dir.rglob("*.json"))
    ann_files = [j for j in jsons if j.name not in ("dataset_infos.json",)]
    # layout (1): annotation lists
    for jf in ann_files:
        try:
            data = json.loads(jf.read_text())
        except Exception:
            continue
        if not isinstance(data, list) or not data or "bbox" not in data[0]:
            continue
        img_root = jf.parent
        for r in data:
            fn = r.get("img_filename") or r.get("image")
            ip = None
            for cand in (img_root / fn, data_dir / fn, *(data_dir.rglob(Path(fn).name))):
                if Path(cand).exists():
                    ip = cand
                    break
            if ip is None:
                continue
            yield {"image": Image.open(ip).convert("RGB"),
                   "instruction": r.get("instruction") or r.get("prompt"),
                   "bbox": r["bbox"],
                   "data_type": r.get("data_type") or r.get("ui_type") or "unknown"}
        return
    # layout (2): parquet via datasets
    try:
        from datasets import load_dataset
        ds = load_dataset(str(data_dir), split="test")
        for r in ds:
            img = r["image"]
            yield {"image": img.convert("RGB") if hasattr(img, "convert") else Image.open(img).convert("RGB"),
                   "instruction": r.get("instruction"),
                   "bbox": r["bbox"], "data_type": r.get("data_type", "unknown")}
    except Exception as e:  # noqa: BLE001
        raise SystemExit(f"could not load ScreenSpot-Pro from {data_dir}: {e}")


def in_box(x, y, b):
    return b[0] <= x <= b[2] and b[1] <= y <= b[3]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--backend", required=True, choices=["qwen", "guiowl"])
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    grounder = make_grounder(args.backend)
    n = hit = parsed = 0
    by_type, by_size = {}, {}
    rows = []
    for i, s in enumerate(load_samples(Path(args.data))):
        if args.limit and i >= args.limit:
            break
        res: GroundResult = grounder.ground(s["image"], s["instruction"])
        ok = res.ok and in_box(res.x, res.y, s["bbox"])
        n += 1
        parsed += int(res.ok)
        hit += int(ok)
        for d, k in ((by_type, s["data_type"]), (by_size, size_bucket(s["bbox"]))):
            d.setdefault(k, [0, 0])
            d[k][0] += int(ok)
            d[k][1] += 1
        rows.append({"instruction": s["instruction"], "type": s["data_type"],
                     "bbox": s["bbox"], "pred": [round(res.x, 1), round(res.y, 1)] if res.ok else None,
                     "hit": ok, "error": res.error})
        if (i + 1) % 25 == 0:
            print(f"  {i+1}: running acc {hit}/{n} = {hit/n:.1%}")

    def fmt(d):
        return {k: f"{v[0]}/{v[1]}={v[0]/v[1]:.1%}" for k, v in sorted(d.items())}

    report = {"backend": args.backend, "n": n, "parsed": parsed,
              "point_in_box": round(hit / n, 4) if n else 0,
              "by_type": fmt(by_type), "by_size": fmt(by_size)}
    out = Path(args.out or (Path(args.data).parent / f"ssbench_{args.backend}.json"))
    out.write_text(json.dumps({**report, "rows": rows}, indent=2))
    print(f"\n=== {args.backend} | n={n} parsed={parsed} | "
          f"point-in-box {hit}/{n} = {report['point_in_box']:.1%} ===")
    print("by type:", report["by_type"])
    print("by size:", report["by_size"])
    print("report ->", out)


if __name__ == "__main__":
    main()
