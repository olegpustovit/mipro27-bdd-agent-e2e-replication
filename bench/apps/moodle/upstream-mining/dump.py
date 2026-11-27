# /// script
# requires-python = ">=3.11"
# ///
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from common import *
ref, since, name = sys.argv[1:4]
cs = load_commits(ref, since, cache=f"{os.path.dirname(__file__)}/cache-{name}.jsonl")
print(name, len(cs), sum(1 for c in cs if any(f['k'] in ('feature','behatphp') for f in c['files'])))
