# /// script
# requires-python = ">=3.14"
# dependencies = ["pyyaml==6.0.3"]
# ///
"""Stream E trace audit (single set), step 1: build units.jsonl. Post-hoc analysis; no runs, no model calls.
FOLLOWUP-E-TA: a copy of followups-2026-11/a-trace-audit/build_units.py (sha256 993ecee9...) with the changes marked
"FOLLOWUP-E-TA". Unit rule, unit fields and target-step rules are a-trace-audit's; the run sets are the single set's.

A unit is one browser-agent run, counted in the paper, whose own verdict was not "pass":
  (a) a faulty-build run reported fail or unresolved (a counted catch), or
  (b) a healthy-build run reported fail or unresolved (a counted false alarm).
"unresolved" is included because every count script scores it as fail.

FOLLOWUP-E-TA: run sets are exactly those the single-set count scripts read:
  e-single-set/pay/scripts/count_pay.py        payment app, agent arms Luna, Terra, Haiku (runtime arm):
      v0, v2  e-single-set/pay/data/campaigns/campaign-h-20261127-single-{luna,terra,haiku}
      v1      b-change1-faults/data/campaigns/campaign-g-20261126-v1faults-{luna,terra,haiku}
              (healthy-v1-1 = stream B's fresh run, the single-set pairing partner)
  e-single-set/moodle/scripts/count_moodle.py  Moodle arm C (14 cases x {healthy, faulty} x 2 reps x 3 models),
      ledger e-single-set/moodle/data/ledger; harness-exception records (outcome error) are excluded as there.
The builder asserts that the unit counts equal the catch and false-alarm numerators of those count scripts (computed
with their own functions) and, for payment, the frozen e-single-set/pay/results/counts.json.
FOLLOWUP-E-TA: units carry no automated grade and no verdict-rule output beyond the agent's own reported status:
a-trace-audit's `reported_equals_target_text` (payment), `reported_failing_step_verified` and
`reported_failing_step_behat_index` (Moodle, verdict-parser step check) and the re-read / clock-recovery fields are
not written. The mechanical step position stays (`reported_failing_step_number` against `target_step_numbers`).

units.jsonl holds no audit codes. Usage (from the repository root):
  uv run followups-2026-11/e-single-set/trace-audit/build_units.py --payment-only   (before E-moodle has finished)
  uv run followups-2026-11/e-single-set/trace-audit/build_units.py [--moodle-src <pin checkout>]
"""
import argparse
import importlib.util
import json
import re
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]  # FOLLOWUP-E-TA: one level deeper (followups-2026-11/e-single-set/trace-audit)
sys.path.insert(0, str(ROOT / 'scripts/counts'))
from common import read_jsonl  # noqa: E402
import verified  # noqa: E402


def load_script(name, path):  # FOLLOWUP-E-TA: import the stream count scripts to reproduce their counts with their own code
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


E_DIR = 'followups-2026-11/e-single-set'
COUNT_PAY = f'{E_DIR}/pay/scripts/count_pay.py'
COUNT_MOODLE = f'{E_DIR}/moodle/scripts/count_moodle.py'
MOODLE_STREAM = f'{E_DIR}/moodle'
MOODLE_LEDGER = f'{MOODLE_STREAM}/data/ledger'
MOODLE_SHORT = 'e-moodle-1'
ARMS = {'luna': 'Luna', 'terra': 'Terra', 'haiku': 'Haiku'}

FEATURE = 'study/scenarios.feature'
# FOLLOWUP-E-TA: the single set's payment campaigns (agent arms), replacing B, C, D, X4, E, F.
PAYMENT_SETS = [
    # (set label, campaign label, directory, trials file, log file, re-read directory or None, revisions counted from it)
    *[(f'pay-{name}', f'single-set E-pay {cid}', f'{E_DIR}/pay/data/campaigns/campaign-h-20261127-single-{cid}',
       'trials.jsonl.zst', 'events.jsonl.zst', None, ('v0', 'v2')) for cid, name in ARMS.items()],
    *[(f'pay-{name}', f'single-set v1 = stream B {cid}', f'followups-2026-11/b-change1-faults/data/campaigns/campaign-g-20261126-v1faults-{cid}',
       'trials.jsonl.zst', 'events.jsonl.zst', None, ('v1',)) for cid, name in ARMS.items()],
]
CLOCK_RECOVERY = {}  # FOLLOWUP-E-TA: no clock-recovery grades exist for these runs (and grades stay out of the units)
REVISION = {'v0': 'v0 (original interface)', 'v1': 'v1 (after change 1)', 'v2': 'v2 (after change 2)'}
# FOLLOWUP-E-TA: (catches, false alarms) per run set and revision as stated in e-single-set/pay/README.md "Results";
# the builder also recomputes them with count_pay.py's own functions and reads pay/results/counts.json.
EXPECTED_PAY = {
    ('pay-Luna', 'v0'): (24, 2), ('pay-Luna', 'v1'): (24, 0), ('pay-Luna', 'v2'): (24, 6),
    ('pay-Terra', 'v0'): (24, 2), ('pay-Terra', 'v1'): (24, 2), ('pay-Terra', 'v2'): (24, 4),
    ('pay-Haiku', 'v0'): (24, 3), ('pay-Haiku', 'v1'): (24, 0), ('pay-Haiku', 'v2'): (24, 9),
}
MOODLE_MODELS = {'gpt-6-luna': 'Luna', 'gpt-5.6-terra': 'Terra', 'claude-haiku-5-5': 'Haiku'}
NO_SCREENSHOTS = 'none recorded: no run called browser_take_screenshot; page state is in the inline accessibility snapshots of the trace'


def payment_scenarios():
    """caseId -> list of Gherkin step lines (1-based order) from the frozen feature file."""
    cases, current = {}, None
    for line in (ROOT / FEATURE).read_text('utf-8').splitlines():
        s = line.strip()
        if s.startswith('@'):
            current = s[1:]
            cases[current] = []
        elif current and re.match(r'^(Given|When|Then|And|But)\b', s):
            cases[current].append(s)
    return cases


def payment_faults():
    out = subprocess.run(['node', '-e', "import('./scripts/mutations.mjs').then(m=>process.stdout.write(JSON.stringify(m.faults)))"],
                         cwd=ROOT, check=True, capture_output=True, text=True).stdout
    return {k: {'file': v[0], 'before': v[1], 'after': v[2]} for k, v in json.loads(out).items()}


def payment_targets():
    """Target check per case: the single normalized failedAssertion shared by the coded faulty runs (verified.py rule)."""
    coded = verified.failed_assertions('coded')
    by_case = defaultdict(set)
    for trial_id, assertion in coded.items():
        by_case[trial_id.split('/')[1]].add(assertion)
    assert all(len(v) == 1 for v in by_case.values()), by_case
    return {k: next(iter(v)) for k, v in by_case.items()}


def driver_label(agent, label):
    """CLI that drove the agent (FOLLOWUP-E-TA: every single-set record stores it)."""
    d = agent.get('driver')
    assert isinstance(d, dict), label
    return d.get('cliVersion') or d.get('driver')


def step_numbers(steps, normalized):
    return [i + 1 for i, s in enumerate(steps) if verified.normalize(s) == normalized]


def payment_units():
    scenarios, faults, targets = payment_scenarios(), payment_faults(), payment_targets()
    units, tally = [], Counter()
    for label, campaign_label, directory, trials, log, reread_dir, revisions in PAYMENT_SETS:
        rows = read_jsonl(f'{directory}/{trials}')
        reread = {}
        if reread_dir:
            reread = {r['record']['trialId']: r['record'] for r in read_jsonl(f'{reread_dir}/trials.jsonl')}
        recovered = {}
        if label in CLOCK_RECOVERY:
            recovered = {r['record']['trialId'] for r in read_jsonl(CLOCK_RECOVERY[label])}
        for row in rows:
            rec = row['record']
            t = rec['trial']
            if t['arm'] != 'runtime':
                continue
            assert t['revision'] in revisions, (label, rec['trialId'])  # FOLLOWUP-E-TA: each campaign holds only its revisions
            status = rec['reportedStatus']
            assert status in ('pass', 'fail', 'unresolved'), rec['trialId']
            if status == 'pass':
                continue
            tally[(label, t['revision'], t['kind'])] += 1  # FOLLOWUP-E-TA: tallied per revision
            agent = rec['agent']
            case = t['caseId']
            steps = scenarios[case]
            faulty = t['kind'] == 'fault'
            target = targets[case]
            reported = agent.get('failedAssertion')
            reported_norm = verified.normalize(reported)
            unit = {
                'unit_id': f'pay:{label}:{rec["trialId"]}',
                'app': 'payment',
                'run_set': label,
                'campaign': campaign_label,
                'campaign_dir': directory,
                'trial_id': rec['trialId'],
                'model': agent.get('requestedModel'),
                'driver': driver_label(agent, label),
                'build_type': 'faulty' if faulty else 'healthy',
                'build': f'{t["revision"]}{"+fault" if faulty else ""}',
                'revision': REVISION[t['revision']],
                'repetition': t['repetition'],
                'scenario': case,
                'scenario_steps': [f'{i + 1}. {s}' for i, s in enumerate(steps)],
                'fault_id': case if faulty else None,
                'fault_change': faults[case] if faulty else None,
                'reported_status': status,
                'reported_failing_step': reported,
                'reported_failing_step_number': step_numbers(steps, reported_norm) or None,
                'reported_reason': agent.get('verdictReason'),
                'verdict_parse_error': agent.get('verdictParseError'),
                'target_step': steps[step_numbers(steps, target)[0] - 1] if faulty else None,
                'target_step_numbers': step_numbers(steps, target) if faulty else None,
                'target_step_rule': ('the single failedAssertion shared by the step-definition faulty runs of this case '
                                     '(scripts/counts/verified.py)') if faulty else None,
                # FOLLOWUP-E-TA: 'reported_equals_target_text' (verified-catch rule input) not written
                'tool_calls': sum(e['type'] == 'tool-call' for e in agent.get('ledger', [])),
                'agent_timed_out': agent.get('timedOut'),
                'run_result': row['result'],
                'run_error': rec.get('error'),
                'paths': {
                    'trace': f'{directory}/{trials}  [record.trialId == "{rec["trialId"]}"; record.agent.ledger = tool calls and results, record.agent.rawResponse = verdict]',
                    'observer_witness': f'{directory}/{trials}  [record.trialId == "{rec["trialId"]}"; record.witness = sampled UI states]'
                    + (f'; also {CLOCK_RECOVERY[label]} [record.observation]' if rec['trialId'] in recovered else ''),
                    'screenshots': NO_SCREENSHOTS,
                    'log': (f'{directory}/{log}  [events from type=trial-start with trial.id == "{rec["trialId"]}" to the next trial-record]'
                            if log.startswith('events') else
                            f'{directory}/{log}  [trial-started / trial-finished entries for "{rec["trialId"]}"]'),
                },
            }
            if reread_dir:
                r2 = reread.get(rec['trialId'])
                unit['reread_status'] = r2['reportedStatus'] if r2 else status
                unit['reread_source'] = f'{reread_dir}/trials.jsonl' if r2 else 'unchanged by verdict parser v2'
            units.append(unit)
    return units, tally


def moodle_units(moodle_src):
    manifest = yaml.safe_load((ROOT / 'manifests/moodle.yaml').read_text('utf-8'))
    scen_meta = {s['id']: s for s in manifest['scenarios']}
    cands = {f['id']: f for f in manifest['fault_candidates'] if f.get('id', '').startswith('X')}
    # FOLLOWUP-E-TA: stream E-moodle's ledger, read with count_moodle.py's own load() (first trial-end per key) and status()
    # (harness exceptions, outcome error, are None: excluded, as in its counts; other non-pass/fail statuses count as unresolved).
    cm = load_script('count_moodle', COUNT_MOODLE)
    trials, _, _ = cm.load(ROOT / MOODLE_LEDGER)
    trials = [t for t in trials if t['arm'] == 'C']
    assert all(t['key'].startswith(f'{MOODLE_SHORT}/') for t in trials)
    excluded = [t['key'] for t in trials if cm.status(t) is None]
    runs = [dict(t['e'], _status=cm.status(t)) for t in trials if cm.status(t) is not None]

    # Target step per (scenario, fault) from results/moodle-campaign.txt (the report the count scripts read).
    target_idx = {}
    for line in (ROOT / 'results/moodle-campaign.txt').read_text('utf-8').splitlines():
        if m := re.match(r'^(B\d+)\.(S\d+)\s+(X\d+)\s+C\s.*\(target (\d+)\)$', line):
            key = (m[2], m[3])
            assert target_idx.get(key, int(m[4])) == int(m[4])
            target_idx[key] = int(m[4])

    scenario_ids = sorted({r['scenario'] for r in runs})
    stdin = '\n'.join(json.dumps({'id': s, 'feature': scen_meta[s]['feature'], 'name': scen_meta[s]['name']}) for s in scenario_ids)
    ui = json.loads(subprocess.run(['node', str(HERE / 'moodle_ui_steps.mjs'), moodle_src], cwd=ROOT, input=stdin,
                                   check=True, capture_output=True, text=True).stdout)

    units, tally = [], Counter()
    for r in runs:
        status = r['_status']  # FOLLOWUP-E-TA: count_moodle.status()
        if status == 'pass':
            continue
        assert status in ('fail', 'unresolved'), r['key']
        faulty = r['state'].startswith('fault:')
        fault = r['state'].split(':', 1)[1] if faulty else None
        _, case, state, _, model, rep = r['key'].split('/')
        scen = r['scenario']
        tally[(f'moodle-{MOODLE_MODELS[model]}', 'fault' if faulty else 'healthy')] += 1  # FOLLOWUP-E-TA: run-set label
        steps = ui[scen]
        assert steps['offset'] == r['handoff']['uiStepIndexOffset'] and len(steps['uiSteps']) == r['handoff']['uiStepCount'], r['key']
        by_behat = {s['behatIndex']: s for s in steps['uiSteps']}
        # The pair's fault (one per scenario in this plan); only faulty units carry the target step.
        pair_faults = {fid for (s, fid) in target_idx if s == scen}
        assert len(pair_faults) == 1, (scen, pair_faults)
        pair_fault_id = next(iter(pair_faults))
        tgt = target_idx[(scen, pair_fault_id)] if faulty else None
        if faulty:
            assert fault == pair_fault_id, (r['key'], fault, pair_fault_id)
            # FOLLOWUP-E-TA: the runner resolved the target on the pin per trial; it must be the frozen screening target
            assert r.get('targetStepIndex') == tgt, (r['key'], r.get('targetStepIndex'), tgt)
        cand = cands[pair_fault_id]
        v = r['verdict']
        blob = r['eventsBlob']
        units.append({
            'unit_id': f'moodle:{r["key"]}',
            'app': 'moodle',
            'run_set': f'moodle-{MOODLE_MODELS[model]}',  # FOLLOWUP-E-TA
            'campaign': 'single-set E-moodle (e-moodle-1; the 16 Nov campaign cells rerun on the campaign pin), arm C',
            'trial_key': r['key'],
            'model': model,
            'driver': (r.get('env') or {}).get('cli', {}).get('omp' if model.startswith('claude') else 'codex'),  # FOLLOWUP-E-TA: recorded version
            'build_type': 'faulty' if faulty else 'healthy',
            'build': f'Moodle pin cfe123f26fc7{" + seeded fault " + fault if faulty else " (healthy)"}; pair from change {case.split(".")[0]}',
            'change': case.split('.')[0],
            'repetition': int(rep[1:]),
            'scenario': scen,
            'scenario_name': steps['scenario'],
            'feature': steps['feature'],
            'scenario_steps': [f'{s["ui"]}. {s["text"]}' for s in steps['uiSteps']],
            'ui_step_index_offset': steps['offset'],
            'fault_id': fault,
            'fault_change': ({'intent': cand['seeded']['intent'], 'mutations': cand['seeded']['mutations']} if faulty else None),
            'reported_status': status,
            'reported_status_raw': r.get('status') if r.get('status') != status else None,  # FOLLOWUP-E-TA: only if count_moodle mapped it
            'reported_failing_step': v.get('failingStepText'),
            'reported_failing_step_number': v.get('failingStep'),
            # FOLLOWUP-E-TA: verdict-parser step check (behatStepIndex, failingStepVerified) not written
            'reported_reason': v.get('verdictReason'),
            'verdict_parse_error': v.get('verdictParseError'),
            'target_step': by_behat[tgt]['text'] if faulty else None,
            'target_step_numbers': [by_behat[tgt]['ui']] if faulty else None,
            'target_step_behat_index': tgt,
            'target_step_rule': 'target step of the pair in results/moodle-campaign.txt (frozen screening target)' if faulty else None,
            'tool_calls': r['toolCalls'],
            'agent_timed_out': r['process'].get('timedOut'),
            'run_result': r['outcome'],
            'run_error': r['fatal'] or None,
            'paths': {
                'trace': f'{MOODLE_LEDGER}/blobs/objects/{blob[:2]}/{blob}  [agent event stream: messages, tool calls, tool results, final verdict]',
                'run_record': f'{MOODLE_LEDGER}/trials.jsonl  [type == "trial-end" and key == "{r["key"]}"; first trial-end of the key]',
                'screenshots': NO_SCREENSHOTS,
                'log': f'{MOODLE_LEDGER}/trials.jsonl  [trial-start / trial-end for key "{r["key"]}"; process.stderrTail]',
            },
        })
    return units, tally, cm, trials, excluded


def check_payment(tally):
    """FOLLOWUP-E-TA: unit counts per (run set, revision) == count_pay.py's catch and false-alarm numerators, computed with its
    own campaign_rows() and version_counts(), == the frozen pay/results/counts.json, == EXPECTED_PAY (README)."""
    cp = load_script('count_pay', COUNT_PAY)
    target = cp.targets()
    frozen = json.loads((ROOT / f'{E_DIR}/pay/results/counts.json').read_text('utf-8'))['summary']
    lines = []
    for cid, name in ARMS.items():
        label = name  # count_pay's arm label
        e_rows = cp.campaign_rows(cp.E_STREAM, cp.E_IDS[label], label)
        b_rows = cp.campaign_rows(cp.B_STREAM, cp.B_IDS[label], label)
        for rev in ('v0', 'v1', 'v2'):
            _, s = cp.version_counts(label, rev, b_rows if rev == 'v1' else e_rows, target)
            catches, fa = int(s['catch'].split('/')[0]), s['fa']
            fz = frozen[label][rev]
            got = (tally[(f'pay-{name}', rev, 'fault')], tally[(f'pay-{name}', rev, 'healthy')])
            assert got == (catches, fa) == (int(fz['catch'].split('/')[0]), fz['fa']) == EXPECTED_PAY[(f'pay-{name}', rev)], \
                (name, rev, got, (catches, fa), fz, EXPECTED_PAY[(f'pay-{name}', rev)])
            lines.append(f'  pay-{name:<6} {rev}  faulty units {got[0]:>3} = count_pay catches {s["catch"]:>6} (counts.json {fz["catch"]})'
                         f'   healthy units {got[1]:>3} = count_pay false alarms {fa}/{s["healthy"]} (counts.json {fz["fa"]}/{fz["healthy"]})')
    return lines


def check_moodle(tally, cm, trials, expected):
    """FOLLOWUP-E-TA: unit counts per model == count_moodle.py summary() catch and false-alarm numerators (arm C), and == the
    values stated in E-moodle's README when given (--moodle-expected)."""
    lines = []
    for model, name in MOODLE_MODELS.items():
        rows = [t for t in trials if t['model'] == model]
        s = cm.summary(rows)
        catches, fa = int(s['catches'].split('/')[0]), int(s['false_alarms'].split('/')[0])
        got = (tally[(f'moodle-{name}', 'fault')], tally[(f'moodle-{name}', 'healthy')])
        assert got == (catches, fa), (name, got, (catches, fa))
        if expected is not None:
            assert got == expected[name], (name, got, expected[name])
        lines.append(f'  moodle-{name:<6} faulty units {got[0]:>3} = count_moodle catches {s["catches"]:>6} ({s["catch_unresolved"]} unres.)'
                     f'   healthy units {got[1]:>3} = count_moodle false alarms {s["false_alarms"]} ({s["fa_unresolved"]} unres.)'
                     f'   records {len(rows)}')
    return lines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--moodle-src', default=str(Path.home() / '.local/share/cucumber-study/moodle/src/cfe123f26fc7'))
    ap.add_argument('--payment-only', action='store_true', help='FOLLOWUP-E-TA: before E-moodle has finished')
    ap.add_argument('--moodle-expected', help='FOLLOWUP-E-TA: Luna=c,f;Terra=c,f;Haiku=c,f (catches, false alarms) from E-moodle README')
    args = ap.parse_args()

    pay, pay_tally = payment_units()
    report = ['payment (count_pay.py; v0/v2 campaign-h, v1 stream B campaign-g):'] + check_payment(pay_tally)
    mdl = []
    if not args.payment_only:
        assert (ROOT / MOODLE_STREAM / 'README.md').exists(), 'E-moodle README.md missing: the Moodle runs are not final'
        head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=args.moodle_src, capture_output=True, text=True, check=True).stdout.strip()
        assert head == 'cfe123f26fc7071981fe949cb16cd5a08a8234f1', head
        mdl, mdl_tally, cm, trials, excluded = moodle_units(args.moodle_src)
        expected = None
        if args.moodle_expected:
            expected = {k: tuple(int(x) for x in v.split(',')) for k, v in (p.split('=') for p in args.moodle_expected.split(';'))}
        report += ['Moodle arm C (count_moodle.py; ledger e-single-set/moodle/data/ledger):'] + check_moodle(mdl_tally, cm, trials, expected)
        report += [f'  excluded harness-exception records (outcome error, never reached the agent): {len(excluded)}'] + [f'    {k}' for k in excluded]
    units = pay + mdl
    assert len({u['unit_id'] for u in units}) == len(units)
    # FOLLOWUP-E-TA: no automated grade or verdict-rule output in any unit
    banned = {'reported_equals_target_text', 'reported_failing_step_verified', 'reported_failing_step_behat_index', 'reread_status',
              'reread_source', 'code', 'codes', 'observation', 'defectObserved', 'verified', 'failedAssertionVerified'}
    assert not any(banned & set(u) for u in units)
    with open(HERE / 'units.jsonl', 'w', encoding='utf-8') as f:
        for u in units:
            f.write(json.dumps(u, ensure_ascii=False) + '\n')
    print(f'{len(units)} units written ({len(pay)} payment, {len(mdl)} Moodle{"; Moodle not built (--payment-only)" if args.payment_only else ""})')
    print('Reproduction check (passed):')
    print('\n'.join(report))


if __name__ == '__main__':
    main()
