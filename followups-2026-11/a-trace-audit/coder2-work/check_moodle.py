# /// script
# requires-python = ">=3.14"
# ///
"""Coder 2: list candidate fault-symptom lines in Moodle faulty-unit traces (agent-visible tool results only)."""
import json, re, sys
from items import items, D
PAT = {
 'X014': r'button "Mark .*as done"|"Mark as done"|button "Done',
 'X010': r'frog-related|alert|notifywarning|Dismiss',
 'X025': r"can't block|Are you sure you want to block",
 'X018': r'Criterion name can not be empty|Criterion max score can not be empty|Marking guide 1 Draft',
 'X021': r'Please configure this block|grading method that is not supported',
 'X022': r'Teacher One|teacher1',
 'X026': r'Content bank',
 'X020': r'Delete submission',
}
U = [json.loads(l) for l in open(D.HERE.parent / 'units.jsonl')]
for idx in map(int, sys.argv[1:]):
    u = U[idx]; its, _ = items(u); pat = PAT.get(u['fault_id'] or '', None)
    print(f"== {idx} {u['unit_id']} verdict {u['reported_status']} st{u['reported_failing_step_number']}")
    seen = 0
    for k, n, t in its:
        if k == 'RESULT' and pat:
            url = re.search(r'Page URL: (\S+)', t)
            hits = [l.strip()[:150] for l in t.splitlines() if re.search(pat, l)]
            if hits:
                print(f"   #{n} {url.group(1) if url else ''} :: " + ' | '.join(dict.fromkeys(hits))[:400]); seen += 1
    if not seen: print('   (no hits)')
