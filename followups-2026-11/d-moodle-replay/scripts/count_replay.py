# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Stream D counts: replay of real Moodle interface changes (plan.md and amendment A1). Written before the results were read.

Input: data/ledger/trials.jsonl (the replay ledger). One record per trial key: its first trial-end (later attempts only
exist after an interrupted attempt; every attempt is listed in the audit section).

Rules (the paper's, scripts/counts/common.py and moodle.py):
- A run passes when Behat reports `passed` (arms A-old, A-new) or the agent reports `pass` (arm C). Anything else is not a pass.
  An agent `unresolved` verdict counts as fail (shown separately). A Behat `error` counts as not passing (shown separately).
- Runs that never reached the agent are excluded and listed: the setup cause "Scenario has no leading data steps", and any other harness
  exception before a verdict (listed with its message).
- Healthy build not passing: on `pre` a failure of the baseline; on `post` a false alarm (for A-old: the expected break).
- Faulty post build not passing = catch. Paired catch = the healthy post run of the same scenario and repetition passes and the faulty
  one does not (arm A has repetition 1 only). Verified catch (supplementary): not passing at the fault's target step.
- Groups: tier 1 = B04, B07, B15 (campaign environment and text); 2021 = B25, B27, B28, B29 (PHP 8.0 runtime), split into cases whose
  text equals the campaign's (B27.S131, B28.S134) and cases run with their historical text (B25.S125, B28.S137, B29.S138, B29.S139).
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
LEDGER = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / 'data/ledger/trials.jsonl'
MODELS = {'gpt-6-luna': 'Luna', 'gpt-5.6-terra': 'Terra', 'claude-haiku-5-5': 'Haiku'}
ARMS = [('A-old', 'none', "developers' step definitions before the change (A-old)"), ('A-new', 'none', "developers' step definitions after the change (A-new)")] + \
       [('C', m, f'browser agent {n}') for m, n in MODELS.items()]
TIER1 = {'B04', 'B07', 'B15'}
HISTORICAL = {'B25.S125', 'B28.S137', 'B29.S138', 'B29.S139'}
SETUP = 'Scenario has no leading data steps'


def load():
    events = [json.loads(l) for l in LEDGER.read_text('utf-8').splitlines() if l.strip()]
    starts, ends, interrupted = defaultdict(list), {}, []
    for e in events:
        if e.get('type') == 'trial-start': starts[e['key']].append(e)
        elif e.get('type') == 'trial-interrupted': interrupted.append(e)
        elif e.get('type') == 'trial-end' and e['key'] not in ends: ends[e['key']] = e
    stops = [e for e in events if e.get('type') == 'schedule-stopped']
    return events, starts, ends, interrupted, stops


def parse_key(key):
    short, case, build, state, arm, model, rep = key.split('/')
    change, scenario = case.split('.')
    return {'case': case, 'change': change, 'scenario': scenario, 'build': build, 'state': state, 'arm': arm, 'model': model, 'rep': int(rep[1:])}


def status(e):
    """('pass'|'fail'|'unresolved'|'behat-error', None) or (None, exclusion reason)."""
    if e.get('outcome') == 'error':
        return None, ('setup: ' if SETUP in e.get('error', '') else 'harness error: ') + e.get('error', '')[:160]
    s = e.get('status')
    if e['arm'] in ('A-old', 'A-new'):
        return {'passed': 'pass', 'failed': 'fail'}.get(s, 'behat-error'), None
    if s in ('pass', 'fail', 'unresolved'): return s, None
    return None, f'no agent verdict (status {s!r})'


def failing_index(e):
    return e.get('failingStepIndex') if e['arm'] in ('A-old', 'A-new') else e.get('behatStepIndex')


def group(k):
    if k['change'] in TIER1: return 'tier1'
    return '2021-historical-text' if k['case'] in HISTORICAL else '2021-campaign-text'


def frac(xs, pred):
    return f'{sum(1 for x in xs if pred(x))}/{len(xs)}'


def main():
    events, starts, ends, interrupted, stops = load()
    runs, excluded = [], []
    for key, e in ends.items():
        k = parse_key(key)
        st, why = status(e)
        r = {**k, 'key': key, 'status': st, 'end': e, 'group': group(k), 'attempts': len(starts[key])}
        (excluded if st is None else runs).append(r if st is not None else {**r, 'why': why})
    by = {(r['case'], r['build'], r['state'], r['arm'], r['model'], r['rep']): r for r in runs}
    out = []
    p = out.append
    p('Stream D: replay of real Moodle interface changes. status: exploratory-owner-directed, gatePassExists: false; post-hoc analysis.')
    p(f'ledger: {LEDGER.relative_to(HERE) if LEDGER.is_relative_to(HERE) else LEDGER}; trial keys with a trial-end: {len(ends)}; counted: {len(runs)}; excluded: {len(excluded)}')
    p('pass = Behat passed / agent pass; unresolved and Behat error count as not passing (shown in brackets).')
    for g, title in (('tier1', 'B04, B07, B15 (campaign environment, campaign scenario text)'),
                     ('2021-campaign-text', 'B27, B28 (Moodle 4.0dev, PHP 8.0 runtime; scenario text equal to the campaign\'s)'),
                     ('2021-historical-text', 'B25, B28, B29 (Moodle 4.0dev, PHP 8.0 runtime; historical scenario text)')):
        rows = [r for r in runs if r['group'] == g]
        if not rows: continue
        p(''); p(f'## {title}')
        p(f'{"arm":<62} {"pre: pass":>10} {"pre: not pass":>14} {"post: pass":>11} {"post: not pass":>15} {"faulty: catch":>14} {"paired catch":>13} {"verified":>9}')
        for arm, model, label in ARMS:
            a = [r for r in rows if r['arm'] == arm and r['model'] == model]
            if not a: continue
            pre = [r for r in a if r['build'] == 'pre' and r['state'] == 'healthy']
            post = [r for r in a if r['build'] == 'post' and r['state'] == 'healthy']
            fau = [r for r in a if r['state'] != 'healthy']
            np_ = lambda xs: f"{frac(xs, lambda r: r['status'] != 'pass')} [{sum(r['status'] in ('unresolved', 'behat-error') for r in xs)}]"
            paired = []
            for r in fau:
                h = by.get((r['case'], 'post', 'healthy', arm, model, r['rep']))
                if h is not None: paired.append(h['status'] == 'pass' and r['status'] != 'pass')
            verified = [r for r in fau if r['status'] == 'fail' and failing_index(r['end']) is not None and failing_index(r['end']) == r['end'].get('targetStepIndex')]
            p(f'{label:<62} {frac(pre, lambda r: r["status"] == "pass"):>10} {np_(pre):>14} {frac(post, lambda r: r["status"] == "pass"):>11} {np_(post):>15} '
              f'{(np_(fau) if fau else "-"):>14} {(f"{sum(paired)}/{len(paired)}" if fau else "-"):>13} {(f"{len(verified)}/{len(fau)}" if fau else "-"):>9}')
        # Transitions per (scenario, rep): pass on pre and not on post = break attributable to the change (on the same scenario/rep).
        p('  change-attributable (pre pass -> post not pass) / post-only recovery (pre not pass -> post pass), per scenario and repetition:')
        for arm, model, label in ARMS:
            pairs = []
            for r in rows:
                if r['arm'] == arm and r['model'] == model and r['build'] == 'pre' and r['state'] == 'healthy':
                    q = by.get((r['case'], 'post', 'healthy', arm, model, r['rep']))
                    if q: pairs.append((r['status'] == 'pass', q['status'] == 'pass'))
            if pairs: p(f'    {label:<60} {sum(a and not b for a, b in pairs)}/{len(pairs)} broke, {sum(b and not a for a, b in pairs)}/{len(pairs)} recovered, {sum(a and b for a, b in pairs)}/{len(pairs)} pass both')
    p(''); p('## Agent runs not passing, by harness flag (plan.md amendment A2; outcomes counted as above, flags only split them)')
    for g in ('tier1', '2021-campaign-text', '2021-historical-text'):
        for model, name in MODELS.items():
            for side, pred in (('healthy pre', lambda r: r['build'] == 'pre' and r['state'] == 'healthy'), ('healthy post', lambda r: r['build'] == 'post' and r['state'] == 'healthy'), ('faulty post', lambda r: r['state'] != 'healthy')):
                xs = [r for r in runs if r['group'] == g and r['arm'] == 'C' and r['model'] == model and pred(r)]
                if not xs: continue
                notp = [r for r in xs if r['status'] != 'pass']
                fl = lambda f: sum(f in (r['end'].get('harnessFlags') or []) for r in notp)
                none = sum(not (r['end'].get('harnessFlags') or []) for r in notp)
                p(f'  {g:<22} {name:<6} {side:<13} not passing {len(notp)}/{len(xs)}: setup-step-handed {fl("harness-setup-step-handed-to-agent")}, tool-budget {fl("tool-budget")}, unflagged {none}')
    p(''); p('## Per change, healthy post-change build: runs not passing / runs (per arm)')
    for ch in sorted({r['change'] for r in runs}):
        cells = []
        for arm, model, label in ARMS:
            xs = [r for r in runs if r['change'] == ch and r['arm'] == arm and r['model'] == model and r['build'] == 'post' and r['state'] == 'healthy']
            if xs: cells.append(f"{(MODELS.get(model) or arm)} {frac(xs, lambda r: r['status'] != 'pass')}")
        p(f'  {ch}: ' + ', '.join(cells))
    p(''); p('## Per change and arm: healthy pre not passing | healthy post not passing | faulty post catches | paired catches  (n = runs; [unresolved or Behat error])')
    for ch in sorted({r['change'] for r in runs}):
        for arm, model, label in ARMS:
            xs = [r for r in runs if r['change'] == ch and r['arm'] == arm and r['model'] == model]
            if not xs: continue
            cell = lambda ys: f"{sum(r['status'] != 'pass' for r in ys)}/{len(ys)} [{sum(r['status'] in ('unresolved', 'behat-error') for r in ys)}]" if ys else '-'
            pre = [r for r in xs if r['build'] == 'pre' and r['state'] == 'healthy']; post = [r for r in xs if r['build'] == 'post' and r['state'] == 'healthy']
            fau = [r for r in xs if r['state'] != 'healthy']
            pc = [by.get((r['case'], 'post', 'healthy', arm, model, r['rep'])) for r in fau]
            paired = f"{sum(h is not None and h['status'] == 'pass' and r['status'] != 'pass' for r, h in zip(fau, pc))}/{len(fau)}" if fau else '-'
            p(f"  {ch} {(MODELS.get(model) or arm):<6} pre {cell(pre):<10} post {cell(post):<10} faulty {cell(fau):<10} paired {paired}")
    p(''); p('## Resources (arm C; tokens = input incl. cache + output; minutes = sum of whole-trial wall time)')
    for model, name in MODELS.items():
        xs = [r['end'] for r in runs + excluded if r['arm'] == 'C' and r['model'] == model]
        tok = [(e.get('meter') or {}).get('inputTokens') for e in xs]
        out_ = [(e.get('meter') or {}).get('outputTokens') for e in xs]
        known = [i + o for i, o in zip(tok, out_) if i is not None and o is not None]
        mins = sum(((e.get('meter') or {}).get('wall') or {}).get('totalMs') or 0 for e in xs) / 60000
        p(f'  {name}: runs {len(xs)}, tokens {sum(known) / 1e6:.2f}M (metered {len(known)}/{len(xs)}), mean {sum(known) / max(1, len(known)) / 1e3:.1f}k, minutes {mins:.1f}')
    allc = [r['end'] for r in runs + excluded if r['arm'] == 'C']
    p(f"  total agent tokens: {sum(((e.get('meter') or {}).get('inputTokens') or 0) + ((e.get('meter') or {}).get('outputTokens') or 0) for e in allc) / 1e6:.2f}M")
    ua = [r for r in runs if r['arm'] == 'C' and r['status'] == 'unresolved']
    p(f"  unresolved agent runs that ended at the tool-call limit (>60 calls): {sum((r['end'].get('toolCalls') or 0) > 60 for r in ua)}/{len(ua)}")
    p(''); p('## Excluded runs (never reached a verdict)')
    for r in sorted(excluded, key=lambda r: r['key']): p(f"  {r['key']}: {r['why']}")
    p(''); p('## Audit')
    p(f'  interrupted attempts: {len(interrupted)}' + ''.join(f"\n    {e['key']} attempt {e['attempt']}: {e['reason']}" for e in interrupted))
    p(f'  keys with more than one attempt: {sum(1 for v in starts.values() if len(v) > 1)}')
    p(f'  schedule stops: {len(stops)}' + ''.join(f"\n    {e['task']} at {e['key']}: {e['reason']}" for e in stops))
    p(f"  studyMode values: {sorted({e.get('studyMode') for e in ends.values()}, key=str)}; gatePassExists values: {sorted({str(e.get('gatePassExists')) for e in ends.values()})}")
    p(''); p('## Every counted run')
    for r in sorted(runs, key=lambda r: r['key']):
        e = r['end']
        p(f"  {r['key']}: {r['status']} failing@{failing_index(e)} target {e.get('targetStepIndex')} tools {e.get('toolCalls')}")
    print('\n'.join(out))


if __name__ == '__main__':
    main()
