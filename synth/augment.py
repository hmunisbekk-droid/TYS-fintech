"""Camera-style augmentation for rendered receipt images (perspective, blur, lighting, noise, JPEG)."""
from __future__ import annotations

import random
from pathlib import Path

import cv2
import numpy as np


def augment_photo(src: Path, dst: Path, rng: random.Random, strength: float = 1.0) -> dict:
    img = cv2.imread(str(src), cv2.IMREAD_COLOR)
    h, w = img.shape[:2]
    # pad with a desk-like background so perspective warp has room
    pad = int(0.12 * max(h, w))
    bg_color = [rng.randint(90, 160) for _ in range(3)]
    canvas = np.full((h + 2 * pad, w + 2 * pad, 3), bg_color, dtype=np.uint8)
    canvas[pad:pad + h, pad:pad + w] = img
    H, W = canvas.shape[:2]
    # perspective jitter
    j = 0.06 * strength
    src_pts = np.float32([[0, 0], [W, 0], [W, H], [0, H]])
    dst_pts = np.float32([[rng.uniform(0, j) * W, rng.uniform(0, j) * H],
                          [W - rng.uniform(0, j) * W, rng.uniform(0, j) * H],
                          [W - rng.uniform(0, j) * W, H - rng.uniform(0, j) * H],
                          [rng.uniform(0, j) * W, H - rng.uniform(0, j) * H]])
    M = cv2.getPerspectiveTransform(src_pts, dst_pts)
    out = cv2.warpPerspective(canvas, M, (W, H), borderValue=tuple(bg_color))
    # rotation
    ang = rng.uniform(-6, 6) * strength
    R = cv2.getRotationMatrix2D((W / 2, H / 2), ang, 1.0)
    out = cv2.warpAffine(out, R, (W, H), borderValue=tuple(bg_color))
    # lighting gradient (glare/shadow)
    yy, xx = np.mgrid[0:H, 0:W]
    grad = (xx / W) * rng.uniform(-0.25, 0.25) * strength + (yy / H) * rng.uniform(-0.25, 0.25) * strength
    out = np.clip(out.astype(np.float32) * (1 + grad[..., None]) + rng.uniform(-20, 20) * strength, 0, 255)
    # blur + noise
    k = rng.choice([1, 1, 3, 3, 5]) if strength >= 1 else 1
    if k > 1:
        out = cv2.GaussianBlur(out, (k, k), 0)
    noise = np.random.default_rng(rng.getrandbits(32)).normal(0, 4 * strength, out.shape)
    out = np.clip(out + noise, 0, 255).astype(np.uint8)
    q = rng.randint(55, 90)
    cv2.imwrite(str(dst), out, [cv2.IMWRITE_JPEG_QUALITY, q])
    return dict(rotation_deg=round(ang, 2), blur_kernel=k, jpeg_quality=q, perspective_jitter=j)
