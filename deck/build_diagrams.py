"""
build_diagrams.py — build all registered diagrams (SVG + Excalidraw + PNG).

Shared across every deck in this tutorial's deck/ scaffold. Reads
diagrams.py's SCENES list, builds each scene, then renders every SVG to PNG
via soffice.

Usage:
    python3 build_diagrams.py
"""
import os
import subprocess
import sys
import glob

WORK = os.environ.get("DECK_WORK", ".")
DIAG = f"{WORK}/diagrams"
PNG = f"{WORK}/png"

sys.path.insert(0, WORK)
import diagrams as _diagrams  # noqa: E402


def main():
    os.makedirs(DIAG, exist_ok=True)
    os.makedirs(PNG, exist_ok=True)

    # 1) Build all SVG + Excalidraw via the scene functions.
    print("Building scenes...")
    for fn in _diagrams.SCENES:
        fn()
        print(f"  built {fn.__name__}")

    # 2) Render each new SVG to PNG via soffice (batch).
    svgs = sorted(glob.glob(f"{DIAG}/*.svg"))
    print(f"\nRendering {len(svgs)} new SVGs to PNG via soffice...")
    if svgs:
        subprocess.check_call([
            "soffice",
            "--headless", "--convert-to", "png",
            *svgs,
            "--outdir", PNG,
        ], stdout=subprocess.DEVNULL)

    # 3) Report
    rendered = sorted(glob.glob(f"{PNG}/r*.png"))
    print(f"\nRendered {len(rendered)} PNGs:")
    for p in rendered:
        print(f"  {os.path.basename(p)}")


if __name__ == "__main__":
    main()
