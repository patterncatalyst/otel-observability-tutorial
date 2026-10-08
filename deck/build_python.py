"""
build_python.py — build only the "OpenTelemetry 201: Python" deck's own
diagrams (SVG + Excalidraw + PNG), without touching the shared
diagrams.py/build_diagrams.py or any other language track's own build
script. Safe to run alongside other deck agents building concurrently in
the same deck/ directory, because it only ever globs and renders its own
`py0N-*` files.

Usage:
    python3 build_python.py
"""
import os
import subprocess
import sys
import glob

WORK = os.environ.get("DECK_WORK", ".")
DIAG = f"{WORK}/diagrams"
PNG = f"{WORK}/png"

sys.path.insert(0, WORK)
import diagrams_201_python as _diagrams  # noqa: E402


def main():
    os.makedirs(DIAG, exist_ok=True)
    os.makedirs(PNG, exist_ok=True)

    print("Building Python 201 scenes...")
    for fn in _diagrams.SCENES:
        fn()
        print(f"  built {fn.__name__}")

    svgs = sorted(glob.glob(f"{DIAG}/py0*.svg"))
    print(f"\nRendering {len(svgs)} py0N SVGs to PNG via soffice...")
    if svgs:
        subprocess.check_call([
            "soffice",
            "--headless", "--convert-to", "png",
            *svgs,
            "--outdir", PNG,
        ], stdout=subprocess.DEVNULL)

    rendered = sorted(glob.glob(f"{PNG}/py0*.png"))
    print(f"\nRendered {len(rendered)} PNGs:")
    for p in rendered:
        print(f"  {os.path.basename(p)}")


if __name__ == "__main__":
    main()
