# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Stream E-moodle counts: the Moodle campaign cells rerun on the single-set setup (post hoc; exploratory-owner-directed,
no gate pass). Written before any measured run of this stream was read.

Input: followups-2026-11/e-single-set/moodle/data/ledger/trials.jsonl (or --ledger <dir>, e.g. data/smoke-ledger).
Rules (scripts/counts/common.py output, scripts/counts/moodle.py scoring, scripts/analysis/moodle-oracle.mjs "caught"):
- A run passes when Behat reports `passed` (arm A) or the agent reports `pass` (arm C). Anything else does not pass; an agent
  `unresolved` verdict counts as fail and is shown separately. A Behat `error` (runner ran, no result) also does not pass and is listed.
- A trial whose record is a harness exception (outcome `error`: e.g. "Scenario has no leading data steps...", data steps failed
  through the generators, sandbox self-check failed) never reached Behat or the agent: excluded and listed with its cause.
- Catch = faulty run not passing. False alarm = healthy run not passing. Paired catch = healthy run of the same case, arm, model and
  repetition passes AND the faulty run does not pass (pairs with an excluded side are left out of the denominator).
- Verified paired catch = paired catch whose faulty run has status fail (unresolved never counts) and fails at the fault's target step:
  arm A the Behat failing step; arm C the agent's failing step only when its number was verified against the listed step text
  (verdict parser v2, `failingStepVerified`), mapped to the Behat index; at the target = same Behat index as the target or the same
  normalised step text (the campaign oracle, tolerance 0). Target = the fault's target step resolved on the pin (recorded per trial).
- Arm A is counted on all 16 cases and on the 14 cases the agents run.
- Flags (recorded by the runner, outcomes unchanged): `harness-setup-step-handed-to-agent` (a data-setup step after the first UI step
  is handed to the agent: B07.S028, B07.S029, B29.S138, B29.S139) and `tool-budget` (unresolved after more than 60 tool calls).
  Counts are also given without the flagged cases, and the flagged runs are listed.
- Tokens = input (incl. cache reads and writes) + output, every attempt; cached share = cache-read / input tokens;
  minutes = sum of trial wall time (`meter.wall.totalMs`, whole trial incl. reset, hand-off and cleanup) / 60000.
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

STREAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(STREAM.parents[2] / 'scripts/counts'))
from common import Checker, main  # noqa: E402
from moodle import MODELS, SETUP_CAUSE, TOOL_CALL_LIMIT, SAME_ASSERTION  # noqa: E402

LEDGER = STREAM / 'data/ledger'
NO_AGENT = {'B07.S025', 'B27.S131'}
HANDED = 'harness-setup-step-handed-to-agent'
PLAN = {'A': 32, 'C': 56}
# 16 Nov campaign (plan 6ac189f540b8) values from scripts/counts/moodle.py, for reference only (not compared).
CAMPAIGN = {'Luna': 'catches 27/28 (2 unres.), false alarms 16/28, paired 11/28',
            'Terra': 'catches 26/28 (4 unres.), false alarms 7/28 (3 unres.), paired 19/28',
            'Haiku': 'catches 27/28 (6 unres.), false alarms 13/28 (6 unres.), paired 14/28',
            'A': 'catches 16/16, false alarms 0/16, paired 16/16'}


def norm(text):
    import re
    return re.sub(r'\s+', ' ', re.sub(r'^(?:Given|When|Then|And|But|\*)\s+', '', str(text or ''))).strip()


def load(ledger):
    """First trial-end per key (a key is one trial; later attempts only follow interrupted ones) and every attempt's meter."""
    ends, attempts, interrupted, stopped = {}, defaultdict(list), [], []
    for line in (ledger / 'trials.jsonl').read_text('utf-8').splitlines():
        if not line.strip():
            continue
        e = json.loads(line)
        if e['type'] == 'trial-end':
            ends.setdefault(e['key'], e)
            attempts[e['key']].append(e)
        elif e['type'] == 'trial-interrupted':
            interrupted.append(e)
        elif e['type'] == 'schedule-stopped':
            stopped.append(e)
    trials = []
    for key, e in ends.items():
        short, case, state, arm, model, rep = key.split('/')
        trials.append({'key': key, 'case': case, 'change': case.split('.')[0], 'side': 'healthy' if state == 'healthy' else 'faulty',
                       'arm': arm, 'model': model, 'rep': int(rep[1:]), 'e': e, 'attempts': attempts[key]})
    return trials, interrupted, stopped


def status(t):
    """'pass', 'fail', 'unresolved', 'error' (Behat error) or None (harness exception: excluded)."""
    e = t['e']
    if e.get('outcome') == 'error':
        return None
    s = e.get('status')
    if t['arm'] == 'A':
        return {'passed': 'pass', 'failed': 'fail'}.get(s, 'error')
    return s if s in ('pass', 'fail', 'unresolved') else 'unresolved'


def at_target(t):
    e = t['e']
    target = e.get('targetStepIndex')
    if t['arm'] == 'A':
        idx, text = e.get('failingStepIndex'), (e.get('failingStep') or {}).get('text')
    else:
        if not e.get('failingStepVerified'):
            return False
        idx, text = e.get('behatStepIndex'), (e.get('verdict') or {}).get('failingStepText')
    if idx is None or target is None:
        return False
    target_text = e.get('targetStepText')
    return idx == target or (text is not None and target_text is not None and norm(text) == norm(target_text))


def frac(n, d):
    return f'{n}/{d}'


def summary(rows):
    h = [t for t in rows if t['side'] == 'healthy' and status(t) is not None]
    f = [t for t in rows if t['side'] == 'faulty' and status(t) is not None]
    partner = {(t['case'], t['arm'], t['model'], t['rep']): t for t in h}
    pairs = [(partner[(t['case'], t['arm'], t['model'], t['rep'])], t) for t in f if (t['case'], t['arm'], t['model'], t['rep']) in partner]
    paired = [(a, b) for a, b in pairs if status(a) == 'pass' and status(b) != 'pass']
    return {
        'catches': frac(sum(status(t) != 'pass' for t in f), len(f)),
        'catch_unresolved': sum(status(t) == 'unresolved' for t in f),
        'false_alarms': frac(sum(status(t) != 'pass' for t in h), len(h)),
        'fa_unresolved': sum(status(t) == 'unresolved' for t in h),
        'paired': frac(len(paired), len(pairs)),
        'verified_paired': frac(sum(status(b) == 'fail' and at_target(b) for a, b in paired), len(pairs)),
    }


def resources(rows):
    m = [a.get('meter') or {} for t in rows for a in t['attempts']]
    inp = sum(x.get('inputTokens') or 0 for x in m)
    out = sum(x.get('outputTokens') or 0 for x in m)
    cache = sum(x.get('cacheReadTokens') or 0 for x in m)
    missing = sum(x.get('inputTokens') is None for x in m)
    minutes = sum(((x.get('wall') or {}).get('totalMs') or 0) for x in m) / 60000
    return {'tokens': inp + out, 'input': inp, 'output': out, 'cached_share': cache / inp if inp else None, 'minutes': minutes,
            'records': len(m), 'missing_usage': missing}


def report(ck, rows, label):
    s = summary(rows)
    ck.check(f'{label} false alarms (healthy not passing)', s['false_alarms'])
    ck.check(f'{label}   of which unresolved', s['fa_unresolved'])
    ck.check(f'{label} catches (faulty not passing)', s['catches'])
    ck.check(f'{label}   of which unresolved', s['catch_unresolved'])
    ck.check(f'{label} paired catches', s['paired'])
    ck.check(f'{label} verified paired catches', s['verified_paired'])


def run(ck: Checker):
    ledger = Path(sys.argv[sys.argv.index('--ledger') + 1]).resolve() if '--ledger' in sys.argv else LEDGER
    trials, interrupted, stopped = load(ledger)
    ck.section(f'Stream E-moodle: trials recorded ({ledger.relative_to(STREAM) if ledger.is_relative_to(STREAM) else ledger})')
    ck.check('trial records (first end per key)', len(trials))
    ck.check('interrupted attempts (re-run by the ledger attempt rule, all kept)', len(interrupted))
    ck.check('schedule stops (token cap / deadline / omp cost cap)', len(stopped))
    for e in stopped:
        ck.note(f"stop before {e.get('key')}: {e.get('reason')} {json.dumps({k: v for k, v in e.items() if k not in ('type', 'task', 'key', 'reason', 'at')})}")
    for arm, model in [('A', 'none')] + [('C', m) for m in MODELS]:
        rows = [t for t in trials if t['arm'] == arm and t['model'] == model]
        if not rows:
            continue
        name = 'A' if arm == 'A' else MODELS[model]
        for side in ('healthy', 'faulty'):
            for rep in sorted({t['rep'] for t in rows}):
                n = sum(t['side'] == side and t['rep'] == rep for t in rows)
                ck.check(f'{name} {side} r{rep} runs recorded', n)
        excluded = [t for t in rows if status(t) is None]
        ck.check(f'{name} runs excluded (harness exception before Behat/agent)', len(excluded))
        for t in excluded:
            ck.note(f"excluded {t['key']}: {str(t['e'].get('error'))[:160]}{' [setup: no leading data steps]' if str(t['e'].get('error', '')).startswith(SETUP_CAUSE) else ''}")
        for t in rows:
            if status(t) == 'error':
                ck.note(f"Behat error (counted as not passing) {t['key']}: {str(t['e'].get('stdoutTail'))[-160:]}")

    ck.section("Developers' current step definitions (arm A), one run per case and state")
    a = [t for t in trials if t['arm'] == 'A']
    report(ck, a, 'A, 16 cases:')
    report(ck, [t for t in a if t['case'] not in NO_AGENT], "A, agents' 14 cases:")
    ck.note(f"16 Nov campaign: {CAMPAIGN['A']}")

    ck.section('Browser agents (arm C), 14 cases x 2 repetitions')
    for model, name in MODELS.items():
        rows = [t for t in trials if t['arm'] == 'C' and t['model'] == model]
        if not rows:
            continue
        report(ck, rows, f'{name}:')
        ck.check(f'{name}: paired, same-assertion ({SAME_ASSERTION})', summary([t for t in rows if t['change'] == SAME_ASSERTION])['paired'])
        ck.check(f'{name}: paired, downstream', summary([t for t in rows if t['change'] != SAME_ASSERTION])['paired'])
        ck.note(f'16 Nov campaign {name}: {CAMPAIGN[name]}')

    ck.section(f'Browser agents without the cases flagged {HANDED} (10 cases)')
    flagged_cases = {t['case'] for t in trials if HANDED in (t['e'].get('harnessFlags') or [])}
    ck.check('cases flagged (from the scenario text, before the run)', ','.join(sorted(flagged_cases)) or '-')
    for model, name in MODELS.items():
        rows = [t for t in trials if t['arm'] == 'C' and t['model'] == model and t['case'] not in flagged_cases]
        if rows:
            report(ck, rows, f'{name} (unflagged):')

    ck.section('Flagged agent runs (outcomes as counted above)')
    for model, name in MODELS.items():
        rows = [t for t in trials if t['arm'] == 'C' and t['model'] == model]
        if not rows:
            continue
        hand = [t for t in rows if HANDED in (t['e'].get('harnessFlags') or [])]
        budget = [t for t in rows if 'tool-budget' in (t['e'].get('harnessFlags') or [])]
        unres = [t for t in rows if status(t) == 'unresolved']
        over = [t for t in unres if (t['e'].get('toolCalls') or 0) > TOOL_CALL_LIMIT]
        ck.check(f'{name}: runs flagged {HANDED}', len(hand))
        ck.check(f'{name}:   healthy not passing / faulty not passing',
                 f"{sum(status(t) != 'pass' for t in hand if t['side'] == 'healthy')}/{sum(t['side'] == 'healthy' for t in hand)}"
                 f" / {sum(status(t) != 'pass' for t in hand if t['side'] == 'faulty')}/{sum(t['side'] == 'faulty' for t in hand)}")
        ck.check(f'{name}: runs flagged tool-budget (unresolved, > {TOOL_CALL_LIMIT} tool calls)', f'{len(over)}/{len(unres)} unresolved')
        for t in budget:
            ck.note(f"tool-budget {t['key']} ({t['e'].get('toolCalls')} calls)")
        for t in [x for x in rows if status(x) == 'unresolved' and x not in budget]:
            ck.note(f"unresolved below the tool limit {t['key']} ({t['e'].get('toolCalls')} calls; timedOut {(t['e'].get('process') or {}).get('timedOut')})")

    ck.section('Resources (every attempt; tokens = input incl. cache + output)')
    total = 0
    for arm, model in [('A', 'none')] + [('C', m) for m in MODELS]:
        rows = [t for t in trials if t['arm'] == arm and t['model'] == model]
        if not rows:
            continue
        name = 'A' if arm == 'A' else MODELS[model]
        r = resources(rows)
        if arm == 'C':
            total += r['tokens']
            ck.check(f'{name}: agent tokens (M)', round(r['tokens'] / 1e6, 2))
            ck.check(f'{name}:   mean per run (k)', round(r['tokens'] / r['records'] / 1e3, 1))
            ck.check(f'{name}:   cached share of input', round(r['cached_share'], 3) if r['cached_share'] is not None else None)
            ck.check(f'{name}:   records without usage', r['missing_usage'])
        ck.check(f'{name}: trial minutes (runs recorded {r["records"]} of planned {PLAN[arm]})', round(r['minutes'], 1))
    ck.check('agent tokens, all models (M)', round(total / 1e6, 2))


if __name__ == '__main__':
    main(run)
