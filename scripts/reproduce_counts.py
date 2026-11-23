# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Reproduce every count reported in the paper from the data in this package and print them.

Usage (from the package root): uv run scripts/reproduce_counts.py
Each value is compared with the number stated in the paper. A difference is printed as
MISMATCH, listed on stderr, and makes the script exit with status 1. Rows marked "info" have
no stated value. Python 3.14 standard library only (compression.zstd reads the .zst files).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / 'counts'))

import cost  # noqa: E402
import matched  # noqa: E402
import moodle  # noqa: E402
import opus_reparse  # noqa: E402
import payment  # noqa: E402
from common import main  # noqa: E402


def run(ck):
    for module in (payment, matched, opus_reparse, moodle, cost):
        module.run(ck)


if __name__ == '__main__':
    main(run)
