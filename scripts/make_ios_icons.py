#!/usr/bin/env python3
"""Rasterize brand/icon.svg into the iOS app icon set and splash logo.

The mark is flattened onto #0E0E10 and saved as RGB PNG (no alpha channel),
so iOS does not show a white fringe around the ram. Requires rsvg-convert
and Pillow. Re-run from the repo root after the logo changes:

    python3 scripts/make_ios_icons.py
"""

import json
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SVG = ROOT / "brand" / "icon.svg"
APPICON = ROOT / "ios" / "BlackRam" / "Assets.xcassets" / "AppIcon.appiconset"
SPLASH = ROOT / "ios" / "BlackRam" / "Assets.xcassets" / "SplashLogo.imageset"
BG = (0x0E, 0x0E, 0x10)

# size is points. scale is the asset-catalog scale. Pixels are round(size * scale).
ICONS = [
    ("iphone", "20x20", "2x", "iphone-20@2x.png"),
    ("iphone", "20x20", "3x", "iphone-20@3x.png"),
    ("iphone", "29x29", "2x", "iphone-29@2x.png"),
    ("iphone", "29x29", "3x", "iphone-29@3x.png"),
    ("iphone", "40x40", "2x", "iphone-40@2x.png"),
    ("iphone", "40x40", "3x", "iphone-40@3x.png"),
    ("iphone", "60x60", "2x", "iphone-60@2x.png"),
    ("iphone", "60x60", "3x", "iphone-60@3x.png"),
    ("ipad", "20x20", "1x", "ipad-20@1x.png"),
    ("ipad", "20x20", "2x", "ipad-20@2x.png"),
    ("ipad", "29x29", "1x", "ipad-29@1x.png"),
    ("ipad", "29x29", "2x", "ipad-29@2x.png"),
    ("ipad", "40x40", "1x", "ipad-40@1x.png"),
    ("ipad", "40x40", "2x", "ipad-40@2x.png"),
    ("ipad", "76x76", "1x", "ipad-76@1x.png"),
    ("ipad", "76x76", "2x", "ipad-76@2x.png"),
    ("ipad", "83.5x83.5", "2x", "ipad-83.5@2x.png"),
    ("ios-marketing", "1024x1024", "1x", "ios-marketing-1024.png"),
]


def pixels(size, scale):
    points = float(size.split("x")[0])
    factor = int(scale.replace("x", ""))
    return int(round(points * factor))


def render_master():
    if not SVG.is_file():
        sys.exit("missing " + str(SVG))
    raw = Path("/tmp/blackram-icon-raw.png")
    subprocess.check_call(
        [
            "rsvg-convert",
            "--background-color=#0E0E10",
            "-w",
            "4096",
            "-h",
            "4096",
            "-o",
            str(raw),
            str(SVG),
        ]
    )
    rgba = Image.open(raw).convert("RGBA")
    if rgba.size != (4096, 4096):
        sys.exit("renderer produced %s" % (rgba.size,))
    flat = Image.new("RGB", rgba.size, BG)
    flat.paste(rgba, mask=rgba.getchannel("A"))
    return flat


def save_rgb(image, path):
    if image.mode != "RGB":
        image = image.convert("RGB")
    image.save(path, format="PNG", optimize=True)
    check = Image.open(path)
    if check.mode != "RGB" or check.size != image.size:
        sys.exit("saved icon is not opaque RGB: %s %s" % (path, check.mode))


def main():
    master = render_master()
    APPICON.mkdir(parents=True, exist_ok=True)
    SPLASH.mkdir(parents=True, exist_ok=True)
    images = []
    for idiom, size, scale, filename in ICONS:
        edge = pixels(size, scale)
        save_rgb(master.resize((edge, edge), Image.Resampling.LANCZOS), APPICON / filename)
        entry = {
            "filename": filename,
            "idiom": idiom,
            "scale": scale,
            "size": size,
        }
        images.append(entry)
    contents = {"images": images, "info": {"author": "xcode", "version": 1}}
    (APPICON / "Contents.json").write_text(json.dumps(contents, indent=2) + "\n", encoding="utf-8")

    splash_images = []
    for scale, factor in (("1x", 1), ("2x", 2), ("3x", 3)):
        edge = 200 * factor
        filename = "splash-logo.png" if factor == 1 else "splash-logo@%dx.png" % factor
        save_rgb(master.resize((edge, edge), Image.Resampling.LANCZOS), SPLASH / filename)
        splash_images.append({"filename": filename, "idiom": "universal", "scale": scale})
    splash = {"images": splash_images, "info": {"author": "xcode", "version": 1}}
    (SPLASH / "Contents.json").write_text(json.dumps(splash, indent=2) + "\n", encoding="utf-8")
    print("wrote %d app icons and 3 splash images" % len(ICONS))


if __name__ == "__main__":
    main()
