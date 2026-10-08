"""
build_quarkus.py — build this deck's own diagrams (SVG + Excalidraw + PNG).

Scoped to the "OpenTelemetry 201: Quarkus" deck only: imports
diagrams_201_quarkus.py (NOT the shared diagrams.py) and renders only the
qk-*.svg sources it produces, to png/qk-*.png. Deliberately does NOT glob
diagrams/*.svg the way the shared build_diagrams.py does — other decks (101,
and the sibling 201 Spring/Python decks) build concurrently in this same
deck/ directory and write their own sources into the same diagrams/ and png/
folders; re-rendering everything here would race with them.

Usage:
    python3 build_quarkus.py
"""
import os
import subprocess
import sys
import glob

WORK = os.environ.get("DECK_WORK", ".")
DIAG = f"{WORK}/diagrams"
PNG = f"{WORK}/png"

sys.path.insert(0, WORK)
import diagrams_201_quarkus as _diagrams  # noqa: E402


def main():
    os.makedirs(DIAG, exist_ok=True)
    os.makedirs(PNG, exist_ok=True)

    # 1) Build only this deck's scenes (qk01..) via the scene functions.
    print("Building Quarkus 201 scenes...")
    for fn in _diagrams.SCENES:
        fn()
        print(f"  built {fn.__name__}")

    # 2) Render only this deck's qk-*.svg sources to PNG via soffice.
    svgs = sorted(glob.glob(f"{DIAG}/qk*.svg"))
    print(f"\nRendering {len(svgs)} qk-*.svg to PNG via soffice...")
    if svgs:
        subprocess.check_call([
            "soffice",
            "--headless", "--convert-to", "png",
            *svgs,
            "--outdir", PNG,
        ], stdout=subprocess.DEVNULL)

    # 3) Report
    rendered = sorted(glob.glob(f"{PNG}/qk*.png"))
    print(f"\nRendered {len(rendered)} PNGs:")
    for p in rendered:
        print(f"  {os.path.basename(p)}")


if __name__ == "__main__":
    main()
