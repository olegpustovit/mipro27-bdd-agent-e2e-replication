# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Release check for the single set: run scripts/counts/single_set.py and compare with the stated numbers.

Usage (from the package root): uv run scripts/reproduce_single_set.py [--stated PATH]
Sibling of scripts/reproduce_counts.py (which checks the 1 Nov campaigns and is unchanged).

Reads results/paper-numbers-single-set.txt: one stated value per line, `quantity | value`, where quantity is
exactly a quantity printed in results/counts-single-set.txt (first column) and value is the number as the
paper states it, compared as an exact string. Lines starting with # and blank lines are ignored.
Exit status 1 when:
- single_set.py itself reports a mismatch with a stream script or a version check fails;
- a stated quantity is not produced by single_set.py (MISSING);
- a stated quantity is still PENDING or NOT FOUND;
- a computed value differs from the stated value (MISMATCH).
Values are never adjusted to match.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / 'counts'))

import single_set  # noqa: E402
from common import ROOT  # noqa: E402

STATED = 'results/paper-numbers-single-set.txt'


def stated_path():
    """results/paper-numbers-single-set.txt, or another list given as --stated PATH (e.g. a draft's list)."""
    return sys.argv[sys.argv.index('--stated') + 1] if '--stated' in sys.argv else STATED


def stated_values():
    out = []
    path = Path(stated_path())
    path = path if path.is_absolute() else ROOT / path
    for n, line in enumerate(path.read_text('utf-8').splitlines(), 1):
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        if '|' not in line:
            sys.exit(f'{stated_path()}:{n}: expected "quantity | value", got: {line}')
        quantity, value = (part.strip() for part in line.rsplit('|', 1))
        out.append((n, quantity, value))
    return out


def main():
    out = single_set.build([])
    rows = {r['quantity']: r for r in out.rows if r['type'] == 'row'}
    problems = [f'single_set: {r["quantity"]}: {r["value"]} ({r["status"]})' for r in out.failures]
    stated = stated_values()
    width = max([len(q) for _, q, _ in stated] + [20])
    print(f'{"quantity":<{width}}  {"computed":>16}  {"paper":>16}  status')
    for n, quantity, value in stated:
        row = rows.get(quantity)
        section_pending = any(quantity.startswith(prefix) and placeholder in rows
                              for prefix, placeholder in (('moodle ', 'moodle [ledger]'), ('cost moodle', 'cost moodle'),
                                                          ('replay ', 'replay [ledger]')))
        if row is None:
            status, got = ('PENDING' if section_pending else 'MISSING'), '-'
        elif row['status'] in ('PENDING', 'NOT FOUND'):
            status, got = row['status'], row['value']
        else:
            got = row['value']
            status = 'ok' if got == value else 'MISMATCH'
        print(f'{quantity:<{width}}  {got:>16}  {value:>16}  {status}')
        if status != 'ok':
            problems.append(f'{stated_path()}:{n}: {quantity}: computed {got}, paper {value} ({status})')
    if not stated:
        print(f'(no stated values in {stated_path()} yet)')
    print(f'\n{len(stated)} stated value(s) checked; {len(problems)} problem(s)')
    if problems:
        print('\n'.join(problems), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
