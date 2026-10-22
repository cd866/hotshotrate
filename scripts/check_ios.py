#!/usr/bin/env python3
"""Validate the Black Ram iOS project on a machine that does not have Xcode.

Checks the asset catalog, plists, storyboard, signing file, Xcode project
wiring, the web-copy script, and that the public site defaults are intact.
"""

import json
import plistlib
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IOS = ROOT / "ios"
BG = (0x0E, 0x0E, 0x10)
BUNDLE_ID = "com.blackramtowing.hotshotrate"
LIVE_FEED = "https://cd866.github.io/hotshotrate/data/feed.json"

errors = []


def fail(message):
    errors.append(message)


def paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def read_png(path):
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a png")
    pos = 8
    width = height = color = bit = inter = None
    idat = []
    while pos + 8 <= len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if kind == b"IHDR":
            width, height, bit, color, comp, filt, inter = struct.unpack(">IIBBBBB", chunk)
            if comp != 0 or filt != 0:
                raise ValueError("unexpected compression")
        elif kind == b"tRNS":
            raise ValueError("tRNS alpha")
        elif kind == b"IDAT":
            idat.append(chunk)
        elif kind == b"IEND":
            break
    if inter:
        raise ValueError("interlaced png")
    if color != 2 or bit != 8:
        raise ValueError("color type %s bit %s" % (color, bit))
    raw = zlib.decompress(b"".join(idat))
    stride = width * 3
    rows = []
    i = 0
    prev = bytearray(stride)
    for _y in range(height):
        filter_type = raw[i]
        i += 1
        row = bytearray(raw[i:i + stride])
        i += stride
        if filter_type == 1:
            for x in range(stride):
                left = row[x - 3] if x >= 3 else 0
                row[x] = (row[x] + left) & 255
        elif filter_type == 2:
            for x in range(stride):
                row[x] = (row[x] + prev[x]) & 255
        elif filter_type == 3:
            for x in range(stride):
                left = row[x - 3] if x >= 3 else 0
                row[x] = (row[x] + ((left + prev[x]) // 2)) & 255
        elif filter_type == 4:
            for x in range(stride):
                a = row[x - 3] if x >= 3 else 0
                b = prev[x]
                c = prev[x - 3] if x >= 3 else 0
                row[x] = (row[x] + paeth(a, b, c)) & 255
        elif filter_type != 0:
            raise ValueError("filter %s" % filter_type)
        prev = row
        rows.append(row)
    if i != len(raw):
        raise ValueError("trailing png data")
    return width, height, rows


def pixel(rows, x, y):
    i = x * 3
    row = rows[y]
    return (row[i], row[i + 1], row[i + 2])


def near(color, expected, tol=3):
    return all(abs(a - b) <= tol for a, b in zip(color, expected))


def check_icons():
    catalog = json.loads((IOS / "BlackRam/Assets.xcassets/AppIcon.appiconset/Contents.json").read_text())
    seen = set()
    if len(catalog["images"]) < 18:
        fail("app icon set has %d slots, expected the full iPhone and iPad set" % len(catalog["images"]))
    for entry in catalog["images"]:
        filename = entry["filename"]
        points = float(entry["size"].split("x")[0])
        scale = int(entry["scale"].replace("x", ""))
        edge = int(round(points * scale))
        path = IOS / "BlackRam/Assets.xcassets/AppIcon.appiconset" / filename
        if not path.is_file():
            fail("missing icon " + filename)
            continue
        if filename in seen:
            continue
        seen.add(filename)
        try:
            width, height, rows = read_png(path)
        except ValueError as err:
            fail("%s: %s" % (filename, err))
            continue
        if (width, height) != (edge, edge):
            fail("%s is %sx%s, expected %s" % (filename, width, height, edge))
            continue
        corners = [pixel(rows, 0, 0), pixel(rows, width - 1, 0), pixel(rows, 0, height - 1), pixel(rows, width - 1, height - 1)]
        for corner in corners:
            if not near(corner, BG):
                fail("%s corner %s is not opaque #0E0E10" % (filename, corner))
                break
        center = pixel(rows, width // 2, height // 2)
        if center == BG:
            fail("%s center is blank background" % filename)
    splash = json.loads((IOS / "BlackRam/Assets.xcassets/SplashLogo.imageset/Contents.json").read_text())
    for entry in splash["images"]:
        factor = int(entry["scale"].replace("x", ""))
        edge = 200 * factor
        path = IOS / "BlackRam/Assets.xcassets/SplashLogo.imageset" / entry["filename"]
        try:
            width, height, rows = read_png(path)
        except ValueError as err:
            fail("%s: %s" % (entry["filename"], err))
            continue
        if (width, height) != (edge, edge):
            fail("%s is %sx%s, expected %s" % (entry["filename"], width, height, edge))
            continue
        if not near(pixel(rows, 0, 0), BG):
            fail("splash %s has a fringe" % entry["filename"])


def check_plist(path, label):
    try:
        return plistlib.loads(path.read_bytes())
    except Exception as err:
        fail("%s is not a valid plist: %s" % (label, err))
        return None


def check_plists():
    info = check_plist(IOS / "BlackRam/Info.plist", "Info.plist")
    if info:
        if info.get("CFBundleDisplayName") != "Black Ram":
            fail("display name is %r" % info.get("CFBundleDisplayName"))
        if info.get("CFBundleName") != "Black Ram":
            fail("bundle name is %r" % info.get("CFBundleName"))
        if info.get("CFBundleIdentifier") != "$(PRODUCT_BUNDLE_IDENTIFIER)":
            fail("bundle id should come from the signing config")
        if info.get("UIStatusBarStyle") != "UIStatusBarStyleLightContent":
            fail("status bar style is not light content")
        if info.get("UIViewControllerBasedStatusBarAppearance") is not False:
            fail("status bar appearance should be global")
        if info.get("UILaunchStoryboardName") != "LaunchScreen":
            fail("launch storyboard name missing")
        if info.get("ITSAppUsesNonExemptEncryption") is not False:
            fail("export compliance flag missing")
        if info.get("UIUserInterfaceStyle") != "Dark":
            fail("app is not locked to dark mode")
        blob = (IOS / "BlackRam/Info.plist").read_text(encoding="utf-8")
        for banned in ("NSCamera", "NSLocation", "NSMicrophone", "NSPhoto", "NSContacts"):
            if banned in blob:
                fail("unused permission string " + banned)
    privacy = check_plist(IOS / "BlackRam/PrivacyInfo.xcprivacy", "PrivacyInfo")
    if privacy is not None and privacy.get("NSPrivacyTracking") is not False:
        fail("privacy manifest should not track")


def check_storyboard():
    path = IOS / "BlackRam/LaunchScreen.storyboard"
    try:
        tree = ET.parse(path)
    except ET.ParseError as err:
        fail("LaunchScreen.storyboard: %s" % err)
        return
    colors = [el for el in tree.iter("color") if el.get("key") == "backgroundColor"]
    if not colors:
        fail("launch screen has no background color")
        return
    color = colors[0]
    try:
        red = float(color.get("red"))
        green = float(color.get("green"))
        blue = float(color.get("blue"))
        alpha = float(color.get("alpha"))
    except (TypeError, ValueError):
        fail("launch screen color is not numeric")
        return
    if abs(red - 14 / 255) > 0.001 or abs(green - 14 / 255) > 0.001 or abs(blue - 16 / 255) > 0.001 or alpha != 1:
        fail("launch screen background is not #0E0E10")
    xml = path.read_text(encoding="utf-8")
    if 'image="SplashLogo"' not in xml:
        fail("launch screen does not show the ram mark")


def check_signing():
    text = (IOS / "Config/Signing.xcconfig").read_text(encoding="utf-8")
    if not re.search(r"(?m)^DEVELOPMENT_TEAM\s*=\s*$", text):
        fail("DEVELOPMENT_TEAM should stay blank in git so the team is chosen locally")
    if "CODE_SIGN_STYLE = Automatic" not in text:
        fail("signing style should be Automatic")
    if "PRODUCT_BUNDLE_IDENTIFIER = %s" % BUNDLE_ID not in text:
        fail("bundle id is not %s" % BUNDLE_ID)
    project = (IOS / "BlackRam.xcodeproj/project.pbxproj").read_text(encoding="utf-8")
    if re.search(r"DEVELOPMENT_TEAM\s*=\s*[A-Za-z0-9]", project):
        fail("project.pbxproj hardcodes a signing team")
    if "baseConfigurationReference = E10000000000000000000009" not in project:
        fail("target is not using Signing.xcconfig")


def check_project():
    project_path = IOS / "BlackRam.xcodeproj/project.pbxproj"
    text = project_path.read_text(encoding="utf-8")
    if text.count("{") != text.count("}"):
        fail("project.pbxproj braces do not balance")
    if text.count("(") != text.count(")"):
        fail("project.pbxproj parentheses do not balance")
    required = [
        "BlackRamApp.swift",
        "WebHostController.swift",
        "LocalSchemeHandler.swift",
        "FeedBridge.swift",
        "LaunchScreen.storyboard",
        "Assets.xcassets",
        "PrivacyInfo.xcprivacy",
        "PRODUCT_NAME = BlackRam",
        "MARKETING_VERSION = 1.0.0",
        "IPHONEOS_DEPLOYMENT_TARGET = 16.0",
        "ENABLE_USER_SCRIPT_SANDBOXING = NO",
        "GENERATE_INFOPLIST_FILE = NO",
        'shellScript = "set -eu\\n\\"${SRCROOT}/scripts/copy-web.sh\\"\\n"',
        "com.apple.product-type.application",
    ]
    for item in required:
        if item not in text:
            fail("project.pbxproj missing " + item)
    scheme = (IOS / "BlackRam.xcodeproj/xcshareddata/xcschemes/BlackRam.xcscheme").read_text(encoding="utf-8")
    ET.fromstring(scheme)
    if 'BlueprintIdentifier = "T10000000000000000000001"' not in scheme:
        fail("shared scheme does not point at the BlackRam target")
    if 'BuildableName = "BlackRam.app"' not in scheme:
        fail("shared scheme product name mismatch")
    for rel in [
        "BlackRam/BlackRamApp.swift",
        "BlackRam/WebHostController.swift",
        "BlackRam/LocalSchemeHandler.swift",
        "BlackRam/FeedBridge.swift",
        "BlackRam/Info.plist",
        "BlackRam/LaunchScreen.storyboard",
        "scripts/copy-web.sh",
        "Config/Signing.xcconfig",
    ]:
        if not (IOS / rel).is_file():
            fail("missing " + rel)


def check_copy_and_site():
    script = IOS / "scripts/copy-web.sh"
    subprocess.check_call(["sh", "-n", str(script)])
    with tempfile.TemporaryDirectory() as tmp:
        env = {
            "SRCROOT": str(IOS),
            "TARGET_BUILD_DIR": tmp,
            "WRAPPER_NAME": "BlackRam.app",
            "PATH": "/usr/bin:/bin",
        }
        subprocess.check_call(["sh", str(script)], env=env)
        dest = Path(tmp) / "BlackRam.app" / "www"
        for rel in ["index.html", "app.js", "styles.css", "sw.js", "data/feed.json", "brand/icon.svg", "fonts/oswald-700.woff2"]:
            if not (dest / rel).is_file():
                fail("copy-web.sh did not bundle " + rel)
        if (dest / "ios").exists():
            fail("copy-web.sh bundled the Xcode project")

    subprocess.check_call(["node", "--check", str(ROOT / "app.js")])
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    for value in ('value="13"', 'value="434.84"', 'value="3.00"'):
        if value not in html:
            fail("business default missing from index.html: " + value)
    if "Add to Home Screen" not in html or 'class="pwa-only"' not in html:
        fail("home-screen install steps are missing")
    if 'class="native-only"' not in html:
        fail("native install note is missing")
    css = (ROOT / "styles.css").read_text(encoding="utf-8")
    if ".native-only { display: none; }" not in css:
        fail("native-only note is visible on the website")
    if "html.native-app .pwa-only { display: none; }" not in css:
        fail("install steps would still show inside the iPhone app")
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    if "if (isNativeApp()) return refreshFeedNative();" not in app:
        fail("native feed path is not gated")
    if "fetch('data/feed.json', { cache: 'no-cache' })" not in app:
        fail("website feed fetch was removed")
    if "var CACHE = 'blackram-v5';" not in (ROOT / "sw.js").read_text(encoding="utf-8"):
        fail("service worker cache was not bumped with the shell")
    swift = (IOS / "BlackRam/FeedBridge.swift").read_text(encoding="utf-8")
    if LIVE_FEED not in swift:
        fail("native live feed URL is not the public GitHub Pages feed")
    host = (IOS / "BlackRam/WebHostController.swift").read_text(encoding="utf-8")
    if "blackram://localhost/index.html" not in host:
        fail("web view does not load the bundled site")
    if "BLACKRAM_CAPTURE" not in app:
        fail("simulator capture hook is missing from app.js")
    if "BLACKRAM_CAPTURE" not in host:
        fail("native shell does not read BLACKRAM_CAPTURE")
    subprocess.check_call(["bash", "-n", str(IOS / "scripts/capture-simulator.sh")])

    if shutil.which("rsync"):
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.check_call(
                [
                    "rsync", "-a",
                    "--exclude", ".git/",
                    "--exclude", ".github/",
                    "--exclude", "ios/",
                    "--exclude", "_site/",
                    str(ROOT) + "/",
                    tmp + "/",
                ]
            )
            staged = Path(tmp)
            if not (staged / "index.html").is_file() or (staged / "ios").exists():
                fail("pages staging would drop the site or publish the Xcode project")
            if not (staged / ".nojekyll").is_file():
                fail("pages staging dropped .nojekyll")


def main():
    check_icons()
    check_plists()
    check_storyboard()
    check_signing()
    check_project()
    check_copy_and_site()
    if errors:
        for message in errors:
            print("FAIL " + message)
        sys.exit(1)
    print("ios project ok")


if __name__ == "__main__":
    main()
