"""Render Cinetor's original open-frame mark using Python's standard library.

Run only in cloud CI: python3 -I tools/make_cinetor_icons.py assets
The legacy icon assets remain untouched for recovery.
"""
import math
from pathlib import Path
import struct
import sys
import zlib

ACCENT = (255, 150, 126)
BACKGROUND = (11, 16, 23)
SURFACE = (28, 39, 53)


def rounded_rect(x, y, left, top, right, bottom, radius):
    dx = max(left + radius - x, 0, x - (right - radius))
    dy = max(top + radius - y, 0, y - (bottom - radius))
    return left <= x <= right and top <= y <= bottom and dx * dx + dy * dy <= radius * radius


def distance_segment(x, y, x1, y1, x2, y2):
    length = (x2 - x1) ** 2 + (y2 - y1) ** 2
    t = max(0, min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / length))
    return math.hypot(x - x1 - t * (x2 - x1), y - y1 - t * (y2 - y1))


def pixel(x, y, monochrome):
    # Match src/components/Logo.tsx: a rounded C and one projection window.
    arc = x <= 31 and abs(math.hypot(x - 31, y - 32) - 13) <= 3.5
    bars = min(distance_segment(x, y, 31, 19, 44, 19), distance_segment(x, y, 31, 45, 44, 45)) <= 3.5
    projection = rounded_rect(x, y, 40, 27, 50, 37, 3)
    if arc or bars or projection:
        return (*((255, 255, 255) if monochrome else ACCENT), 255)
    if not monochrome and rounded_rect(x, y, 0, 0, 64, 64, 19):
        return (*SURFACE, 255)
    return None


def render(size, fraction, transparent=False, monochrome=False):
    background = (0, 0, 0, 0) if transparent else (*BACKGROUND, 255)
    extent = size * fraction
    offset = (size - extent) / 2
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            samples = []
            for dy in (0.25, 0.75):
                for dx in (0.25, 0.75):
                    samples.append(pixel((x + dx - offset) * 64 / extent, (y + dy - offset) * 64 / extent, monochrome) or background)
            alpha = sum(value[3] for value in samples) / 4
            rgb = [round(sum(value[channel] * value[3] for value in samples) / (4 * alpha)) if alpha else 0 for channel in range(3)]
            raw.extend((*rgb, round(alpha)))
    return raw


def write_png(destination, size, raw):
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    destination.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def main():
    output = Path(sys.argv[1])
    output.mkdir(parents=True, exist_ok=True)
    for name, size, fraction, transparent, monochrome in [
        ('cinetor-icon.png', 1024, 0.80, False, False),
        ('cinetor-splash.png', 512, 0.82, True, False),
        ('cinetor-foreground.png', 512, 0.60, True, False),
        ('cinetor-monochrome.png', 432, 0.60, True, True),
    ]:
        write_png(output / name, size, render(size, fraction, transparent, monochrome))
        print(f'Generated {name}')


if __name__ == '__main__':
    main()
