"""Generate Cinator app icons (Cinematic "C" emblem mark) as PNGs with no dependencies.

Usage: python3 tools/make_icons.py assets
"""
import os
import struct
import sys
import zlib

POLYS_DARK = [
    [(240, 680), (460, 570), (840, 780), (620, 960), (180, 760)],
    [(200, 240), (480, 420), (480, 600), (200, 780)],
]
POLYS_MAIN = [
    [(200, 240), (480, 100), (480, 924), (200, 780)],
    [(480, 600), (880, 820), (760, 980), (200, 780)],
]
POLYS_GLOW = [
    [(200, 240), (780, 60), (880, 220), (480, 420), (200, 240)],
]
POLYS_SHUTTER = [
    [(480, 410), (660, 512), (480, 614)],
]

LAYERS = [
    (POLYS_DARK, (0x7A, 0x01, 0x05)),
    (POLYS_MAIN, (0xE5, 0x09, 0x14)),
    (POLYS_GLOW, (0xFF, 0x33, 0x3E)),
    (POLYS_SHUTTER, (0xFF, 0xFF, 0xFF)),
]

def fill_polygon(mask, size, poly, scale, offset_x, offset_y):
    pts = [(x * scale + offset_x, y * scale + offset_y) for x, y in poly]
    ys = [p[1] for p in pts]
    for row in range(max(0, int(min(ys))), min(size, int(max(ys)) + 1)):
        y = row + 0.5
        xs = []
        for i in range(len(pts)):
            (x1, y1), (x2, y2) = pts[i], pts[(i + 1) % len(pts)]
            if (y1 <= y < y2) or (y2 <= y < y1):
                xs.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
        xs.sort()
        for a, b in zip(xs[0::2], xs[1::2]):
            start, end = max(0, int(a + 0.5)), min(size, int(b + 0.5))
            if end > start:
                mask[row * size + start : row * size + end] = b"\x01" * (end - start)

def render(size, mark_fraction, bg, mono=False):
    ss = 2
    big = size * ss
    scale = big * mark_fraction / 1024.0
    offset_x = (big - 1024 * scale) / 2.0
    offset_y = (big - 1024 * scale) / 2.0
    layers = []
    for polys, rgb in LAYERS:
        mask = bytearray(big * big)
        for poly in polys:
            fill_polygon(mask, big, poly, scale, offset_x, offset_y)
        layers.append((mask, (255, 255, 255) if mono else rgb))
    out = bytearray()
    for y in range(size):
        out.append(0)
        for x in range(size):
            r, g, b = bg[:3]
            a = bg[3] if len(bg) == 4 else 255
            for mask, rgb in layers:
                cov = 0
                for dy in range(ss):
                    base = (y * ss + dy) * big + x * ss
                    cov += mask[base] + mask[base + 1]
                if cov:
                    t = cov / (ss * ss)
                    r = round(r * (1 - t) + rgb[0] * t)
                    g = round(g * (1 - t) + rgb[1] * t)
                    b = round(b * (1 - t) + rgb[2] * t)
                    a = round(a * (1 - t) + 255 * t)
            out += bytes((r, g, b, a))
    return bytes(out)

def write_png(path, size, rgba):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(rgba, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)

def main(out_dir):
    jobs = [
        ("icon.png", 1024, 0.76, (0, 0, 0, 255), False),
        ("splash-icon.png", 512, 0.85, (0, 0, 0, 0), False),
        ("android-icon-foreground.png", 512, 0.52, (0, 0, 0, 0), False),
        ("android-icon-background.png", 512, 0.0, (0, 0, 0, 255), False),
        ("android-icon-monochrome.png", 432, 0.6, (0, 0, 0, 0), True),
        ("favicon.png", 48, 0.82, (0, 0, 0, 255), False),
    ]
    for name, size, frac, bg, mono in jobs:
        write_png(os.path.join(out_dir, name), size, render(size, frac, bg, mono))
        print(f"Generated {name}")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "assets")
