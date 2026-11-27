# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Replace the author's home directory, host name and user name with placeholders before a release.

Usage (from the package root):
  uv run scripts/redact_paths.py --check [PATH ...]            report remaining strings, change nothing
  uv run scripts/redact_paths.py --apply --manifest FILE [PATH ...]

PATH defaults to followups-2026-11. Only files that git would commit are processed
(`git ls-files --cached --others --exclude-standard`); outside a git work tree every file under PATH is.
--exclude PREFIX (repeatable) skips files under a path prefix (for example folders still being written).

Rules, applied in this order to every file, also inside `.zst` files (decompress, replace, recompress at
level 19), as in release v1.1.0 (REPRODUCE.md section 6):
  1. the home directory (taken from the running user, e.g. /home/<name>)    -> <home>
  2. the same prefix in munged directory names (-home-<name>-)              -> -<home>-
  3. the host name (socket.gethostname(), or --host)                        -> <host>
  4. any remaining user name (getpass.getuser(), or --user)                 -> <user>
  5. only with --account-ids: the values of the provider account identifiers in Codex session headers
     ("creator_user_id", "creator_account_id")                             -> <redacted>
     (as done for the adjudicator sessions in provenance/adjudication/, REPRODUCE.md section 3)
The strings are read at run time so that this script itself names no person or host.
Files that contain a NUL byte (after decompression) are reported and never changed.

After --apply, every `*SHA256SUMS*` file in the processed set is updated: an entry whose file changed is
rewritten with the new hash. An entry naming `x.jsonl` when only `x.jsonl.zst` exists holds the hash of the
decompressed file (the package's convention) and gets the new decompressed hash. An entry is only rewritten
if it held the pre-redaction hash; any other mismatch is reported and left alone.
The manifest (TSV; appended to when it exists) records, per changed file: the stored-bytes SHA-256 before and after, the decompressed
SHA-256 before and after for .zst files, and the number of replacements per rule. It names no home path.
Finally every processed text file is searched for the pre-redaction hashes of changed files, so that any
other record that pins a changed file is listed (exit status 2 if any are found outside SHA256SUMS files).
Exit status 1 with --check when any string remains.
"""
import argparse
import getpass
import hashlib
import os
import re
import socket
import subprocess
import sys
from pathlib import Path

from compression import zstd

ZSTD_LEVEL = 19


def sha(data):
    return hashlib.sha256(data).hexdigest()


def rules(home, host, user):
    munged = home.replace('/', '-')  # /home/u -> -home-u
    return [
        ('home', home.encode(), b'<home>'),
        ('munged-home', (munged + '-').encode(), b'-<home>-'),
        ('host', host.encode(), b'<host>'),
        ('user', user.encode(), b'<user>'),
    ]


ACCOUNT_ID = re.compile(rb'("creator_(?:user|account)_id"\s*:\s*")(?!<redacted>")[^"]*(")')


def redact(data, rule_list, account_ids=False):
    counts = {}
    for name, old, new in rule_list:
        n = data.count(old)
        if n:
            data = data.replace(old, new)
            counts[name] = n
    if account_ids:
        data, n = ACCOUNT_ID.subn(rb'\1<redacted>\2', data)
        if n:
            counts['account-id'] = n
    return data, counts


def list_files(root, paths, excludes):
    inside_git = subprocess.run(['git', '-C', str(root), 'rev-parse', '--is-inside-work-tree'],
                                capture_output=True, text=True).stdout.strip() == 'true'
    if inside_git:
        out = subprocess.run(['git', '-C', str(root), 'ls-files', '-z', '--cached', '--others',
                              '--exclude-standard', '--', *paths], capture_output=True, check=True).stdout
        files = [f for f in out.decode().split('\0') if f]
    else:
        files = []
        for p in paths:
            base = root / p
            if base.is_file():
                files.append(p)
                continue
            for dirpath, dirnames, filenames in os.walk(base):
                dirnames[:] = [d for d in dirnames if d not in ('.git', 'node_modules', '__pycache__')]
                files += [str((Path(dirpath) / f).relative_to(root)) for f in filenames]
    excludes = [e.rstrip('/') + '/' for e in excludes]
    return sorted(f for f in files
                  if (root / f).is_file() and not (root / f).is_symlink()
                  and not any(f.startswith(e) for e in excludes))


def load(path):
    stored = path.read_bytes()
    if path.suffix == '.zst':
        return stored, zstd.decompress(stored)
    return stored, stored


def update_sums(root, files, changed, log):
    """Rewrite SHA256SUMS entries of changed files. Returns {sums file: [lines changed]}."""
    by_path = {root / f: c for f, c in changed.items()}
    done = {}
    for f in files:
        if 'SHA256SUMS' not in Path(f).name:
            continue
        sums = root / f
        lines = sums.read_text('utf-8').splitlines(keepends=True)
        new_lines, touched = [], []
        for line in lines:
            m = re.fullmatch(r'([0-9a-f]{64})( [ *])(.+?)(\r?\n)?', line)
            if not m:
                new_lines.append(line)
                continue
            digest, sep, name, eol = m.group(1), m.group(2), m.group(3), m.group(4) or ''
            target = (sums.parent / name).resolve()
            entry = None
            if target in by_path:
                c = by_path[target]
                entry = (c['stored_before'], c['stored_after'])
            elif target.with_name(target.name + '.zst') in by_path and not target.exists():
                c = by_path[target.with_name(target.name + '.zst')]
                entry = (c['plain_before'], c['plain_after'])
            if entry is None:
                new_lines.append(line)
                continue
            before, after = entry
            if digest == before:
                new_lines.append(f'{after}{sep}{name}{eol}')
                touched.append(name)
            elif digest == after:
                new_lines.append(line)
            else:
                log(f'WARNING {f}: entry {name} holds {digest[:12]}, neither the pre- nor the post-redaction hash; left alone')
                new_lines.append(line)
        if touched:
            sums.write_text(''.join(new_lines), 'utf-8')
            done[f] = touched
    return done


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--apply', action='store_true')
    ap.add_argument('paths', nargs='*', default=['followups-2026-11'])
    ap.add_argument('--root', default='.')
    ap.add_argument('--exclude', action='append', default=[])
    ap.add_argument('--manifest')
    ap.add_argument('--home', default=str(Path.home()))
    ap.add_argument('--host', default=socket.gethostname())
    ap.add_argument('--user', default=getpass.getuser())
    ap.add_argument('--account-ids', action='store_true', help='also replace Codex session-header account identifiers')
    args = ap.parse_args()
    if args.apply and not args.manifest:
        ap.error('--apply needs --manifest')
    root = Path(args.root).resolve()
    rule_list = rules(args.home.rstrip('/'), args.host, args.user)
    log = lambda msg: print(msg, file=sys.stderr)  # noqa: E731

    files = list_files(root, args.paths, args.exclude)
    changed, binary_hits, totals, plain_cache = {}, [], {}, {}
    for f in files:
        path = root / f
        stored, plain = load(path)
        new_plain, counts = redact(plain, rule_list, args.account_ids)
        if b'\0' in plain:
            if counts:
                binary_hits.append((f, counts))
            continue
        plain_cache[f] = new_plain if args.apply else plain
        if not counts:
            continue
        for k, n in counts.items():
            totals[k] = totals.get(k, 0) + n
        if args.check:
            changed[f] = {'counts': counts}
            continue
        new_stored = zstd.compress(new_plain, level=ZSTD_LEVEL) if path.suffix == '.zst' else new_plain
        if path.suffix == '.zst':
            assert zstd.decompress(new_stored) == new_plain
        path.write_bytes(new_stored)
        changed[f] = {'counts': counts, 'stored_before': sha(stored), 'stored_after': sha(new_stored),
                      'plain_before': sha(plain), 'plain_after': sha(new_plain), 'zst': path.suffix == '.zst'}

    print(f'files scanned: {len(files)}; with replacements: {len(changed)}; '
          f'replacements: ' + (', '.join(f'{k} {v}' for k, v in sorted(totals.items())) or 'none'))
    for f, c in changed.items():
        print(f'  {f}: ' + ', '.join(f'{k} {v}' for k, v in c['counts'].items()))
    for f, counts in binary_hits:
        print(f'  BINARY, not changed: {f}: {counts}')

    if args.check:
        return 1 if changed or binary_hits else 0

    sums = update_sums(root, files, changed, log)
    for f, names in sums.items():
        print(f'  updated {f}: {len(names)} entries')
    new_manifest = not Path(args.manifest).exists()
    with open(args.manifest, 'a', encoding='utf-8') as out:  # a later pass appends its rows
        if new_manifest:
            out.write('# redact_paths.py manifest: path, stored sha256 before, after, decompressed sha256 before, '
                      'after (.zst only), replacements per rule\n')
            out.write('path\tstored_before\tstored_after\tdecompressed_before\tdecompressed_after\treplacements\n')
        for f, c in changed.items():
            dec = (c['plain_before'], c['plain_after']) if c['zst'] else ('-', '-')
            out.write(f'{f}\t{c["stored_before"]}\t{c["stored_after"]}\t{dec[0]}\t{dec[1]}\t'
                      + ','.join(f'{k}={v}' for k, v in c['counts'].items()) + '\n')
        for f in sums:  # SHA256SUMS files rewritten above (their own hashes change)
            out.write(f'{f}\t-\t{sha((root / f).read_bytes())}\t-\t-\tsha256sums-updated\n')

    # Other records that pin a changed file by its pre-redaction hash.
    old = {}
    for f, c in changed.items():
        old[c['stored_before']] = f
        old[c['plain_before']] = f
    pattern = re.compile(rb'[0-9a-f]{64}')
    refs = []
    for f, data in plain_cache.items():
        if 'SHA256SUMS' in Path(f).name:
            continue
        for m in set(pattern.findall(data)):
            if m.decode() in old:
                refs.append((f, old[m.decode()]))
    for f, target in sorted(refs):
        print(f'  PINNED pre-redaction hash: {f} pins {target}')
    return 2 if refs else 0


if __name__ == '__main__':
    sys.exit(main())
