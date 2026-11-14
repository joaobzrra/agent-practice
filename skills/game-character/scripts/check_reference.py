"""Measurable checks on a reference image (headless Blender, uses bpy image loading + numpy).

  blender -b --python check_reference.py -- --image ref/front.png [--json ref/front.check.json]

Prints one line per rule: PASS / WARN / FAIL, and a summary line. Pose, accessories and
lighting direction need eyes; this script covers what a number can say:
  size        longest side >= 1024 px, portrait or square
  background  the 3 % border is uniform and light (plain backdrop, no gradient)
  fill        subject bounding box covers 70-95 % of the image height (not tiny, not cropped)
  centered    subject horizontally centred within 10 % of width
  edge_crop   subject does not touch the bottom edge (soles visible) or the top edge
"""
import json
import sys
from pathlib import Path

import bpy
import numpy as np


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--image", required=True)
    p.add_argument("--json")
    return p.parse_args(argv)


def load(path):
    img = bpy.data.images.load(str(path))
    w, h = img.size
    arr = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(arr)
    arr = arr.reshape(h, w, 4)[::-1]  # top-down
    bpy.data.images.remove(img)
    return arr


def main():
    a = parse_args()
    arr = load(a.image)
    h, w, _ = arr.shape
    rgb = arr[..., :3]; alpha = arr[..., 3]
    results = {}

    longest = max(w, h)
    results["size"] = ("PASS" if longest >= 1024 and h >= w else "WARN" if longest >= 1024 else "FAIL",
                       f"{w}x{h}px")

    b = max(2, int(0.03 * min(w, h)))
    border = np.concatenate([rgb[:b].reshape(-1, 3), rgb[-b:].reshape(-1, 3),
                             rgb[:, :b].reshape(-1, 3), rgb[:, -b:].reshape(-1, 3)])
    bg = border.mean(axis=0); bg_std = border.std(axis=0).mean()
    light = bg.mean() > 0.8
    flat = bg_std < 0.04
    results["background"] = ("PASS" if light and flat else "WARN" if flat else "FAIL",
                             f"mean {bg.mean():.2f} std {bg_std:.3f} (want light >0.8, flat <0.04)")

    # subject mask: alpha if present, else distance from background colour
    if alpha.min() < 0.5:
        mask = alpha > 0.5
    else:
        mask = np.abs(rgb - bg).sum(axis=2) > 0.15
    ys, xs = np.where(mask)
    if len(ys) == 0:
        results["fill"] = ("FAIL", "no subject detected")
        results["centered"] = ("FAIL", "no subject")
        results["edge_crop"] = ("FAIL", "no subject")
    else:
        top, bottom = ys.min(), ys.max(); left, right = xs.min(), xs.max()
        fill = (bottom - top + 1) / h
        results["fill"] = ("PASS" if 0.70 <= fill <= 0.95 else "WARN" if 0.5 <= fill <= 0.98 else "FAIL",
                           f"subject height {fill:.0%} of frame")
        cx = (left + right) / 2 / w
        results["centered"] = ("PASS" if abs(cx - 0.5) <= 0.10 else "WARN", f"centre at {cx:.0%} of width")
        touches = bottom >= h - 2 or top <= 1 or left <= 1 or right >= w - 2
        results["edge_crop"] = ("FAIL" if touches else "PASS",
                                f"bbox top {top} bottom {bottom} left {left} right {right}")

    worst = "PASS"
    for k, (st, msg) in results.items():
        print(f"{st:4} {k:10} {msg}")
        if st == "FAIL" or (st == "WARN" and worst != "FAIL"):
            worst = st
    print(f"SUMMARY {worst}")
    if a.json:
        Path(a.json).write_text(json.dumps({"image": a.image, "summary": worst,
                                            "checks": {k: {"status": s, "detail": m} for k, (s, m) in results.items()}},
                                           indent=2))


if __name__ == "__main__":
    main()
