"""
build_spring.py — build this deck's own diagrams (SVG + Excalidraw + PNG).

Mirrors build_diagrams.py but imports diagrams_201_spring.py and only
touches sp-*.svg files, so it stays parallel-safe alongside the shared
101 deck's build_diagrams.py and the other language 201 decks' own
build scripts running concurrently against the same diagrams/ and png/
directories.

Usage:
    python3 build_spring.py
"""
import os
import subprocess
import sys
import glob

WORK = os.environ.get("DECK_WORK", ".")
DIAG = f"{WORK}/diagrams"
PNG = f"{WORK}/png"

sys.path.insert(0, WORK)
import diagrams_201_spring as _diagrams  # noqa: E402


def main():
    os.makedirs(DIAG, exist_ok=True)
    os.makedirs(PNG, exist_ok=True)

    # 1) Build all SVG + Excalidraw via the scene functions.
    print("Building Spring 201 scenes...")
    for fn in _diagrams.SCENES:
        fn()
        print(f"  built {fn.__name__}")

    # 2) Render only this deck's new SVGs to PNG via soffice (batch).
    svgs = sorted(glob.glob(f"{DIAG}/sp0*.svg"))
    print(f"\nRendering {len(svgs)} sp0*.svg files to PNG via soffice...")
    if svgs:
        subprocess.check_call([
            "soffice",
            "--headless", "--convert-to", "png",
            *svgs,
            "--outdir", PNG,
        ], stdout=subprocess.DEVNULL)

    # 3) Report
    rendered = sorted(glob.glob(f"{PNG}/sp0*.png"))
    print(f"\nRendered {len(rendered)} PNGs:")
    for p in rendered:
        print(f"  {os.path.basename(p)}")


if __name__ == "__main__":
    main()
