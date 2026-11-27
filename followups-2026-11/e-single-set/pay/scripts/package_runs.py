# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Copy the stream E-pay campaign run directories into data/campaigns/ in the package layout of data/campaigns/:
trials.jsonl and events.jsonl compressed with zstd (level 19), journal.jsonl as is (the journal holds every
trial-started/finished line, so no separate progress file). Writes data/SHA256SUMS with hashes of the decompressed files. The home-directory
prefix is not rewritten (the raw files are kept byte-for-byte inside the .zst)."""
import hashlib
import shutil
import sys
from compression import zstd
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
RUNS = Path.home() / '.local/share/cucumber-study/runs'
IDS = sys.argv[1:] or [f'campaign-h-20261127-single-{a}' for a in ('coded', 'luna', 'terra', 'haiku')]
sums = []
for cid in IDS:
    src, dst = RUNS / cid, HERE / 'data' / 'campaigns' / cid
    if not src.exists():
        print('missing', cid)
        continue
    dst.mkdir(parents=True, exist_ok=True)
    for name in ('trials.jsonl', 'events.jsonl', 'journal.jsonl'):
        raw = (src / name).read_bytes()
        sums.append(f'{hashlib.sha256(raw).hexdigest()}  campaigns/{cid}/{name}')
        if name == 'journal.jsonl':
            shutil.copyfile(src / name, dst / name)
        else:
            (dst / (name + '.zst')).write_bytes(zstd.compress(raw, level=19))
    print('packaged', cid)
(HERE / 'data' / 'SHA256SUMS').write_text('\n'.join(sorted(sums)) + '\n')
