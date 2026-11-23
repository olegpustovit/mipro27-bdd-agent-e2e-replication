# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Shared helpers for the count scripts: package paths, JSONL reading and checked output."""
import json
import sys
from pathlib import Path

from compression import zstd

ROOT = Path(__file__).resolve().parents[2]


def read_jsonl(path):
    """Read a JSONL file, decompressing it first when it ends in .zst."""
    path = ROOT / path
    raw = path.read_bytes()
    if path.suffix == '.zst':
        raw = zstd.decompress(raw)
    return [json.loads(line) for line in raw.decode('utf-8').splitlines() if line.strip()]


class Checker:
    """Collects reproduced values and compares each with the value stated in the paper."""

    def __init__(self):
        self.rows = []

    def section(self, title):
        self.rows.append(('section', title))

    def check(self, label, got, expected=None):
        """Record one value. Floats are compared at the precision of the expected string."""
        if expected is None:
            shown, status = (f'{got:.3f}' if isinstance(got, float) else str(got)), 'info'
        else:
            expected = str(expected)
            if isinstance(got, float):
                places = len(expected.split('.')[1]) if '.' in expected else 0
                shown = f'{got:.{places}f}'
            else:
                shown = str(got)
            status = 'ok' if shown == expected else 'MISMATCH'
        self.rows.append(('row', label, shown, '' if expected is None else expected, status))

    def note(self, text):
        self.rows.append(('note', text))

    @property
    def mismatches(self):
        return [row for row in self.rows if row[0] == 'row' and row[4] == 'MISMATCH']

    def render(self):
        width = max([len(row[1]) for row in self.rows if row[0] == 'row'] + [20])
        out = []
        for row in self.rows:
            if row[0] == 'section':
                out.append('')
                out.append(f'## {row[1]}')
                out.append(f'{"quantity":<{width}}  {"reproduced":>14}  {"paper":>14}  status')
            elif row[0] == 'note':
                out.append(f'   note: {row[1]}')
            else:
                _, label, shown, expected, status = row
                out.append(f'{label:<{width}}  {shown:>14}  {expected:>14}  {status}')
        return '\n'.join(out)


def main(run):
    """Run one count module on its own, print its table and fail loudly on any mismatch."""
    checker = Checker()
    run(checker)
    print(checker.render())
    if checker.mismatches:
        print(f'\n{len(checker.mismatches)} value(s) differ from the paper:', file=sys.stderr)
        for _, label, shown, expected, _ in checker.mismatches:
            print(f'  {label}: reproduced {shown}, paper {expected}', file=sys.stderr)
        sys.exit(1)
