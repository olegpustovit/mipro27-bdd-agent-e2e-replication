# /// script
# requires-python = ">=3.14"
# dependencies = ["pyyaml==6.0.3"]
# ///
"""Stream A1 (trace audit), step 1: build units.jsonl. Post-hoc analysis; no runs, no model calls.

A unit is one browser-agent run, counted in the paper, whose own verdict was not "pass":
  (a) a faulty-build run reported fail or unresolved (a counted catch), or
  (b) a healthy-build run reported fail or unresolved (a counted false alarm).
"unresolved" is included because every count script scores it as fail.

Run sets are exactly those the count scripts read (scripts/counts/*.py):
  payment.py    campaigns B, C, D (runtime arm)                          data/campaigns/
  matched.py    follow-up comparison, 4 configurations x 36 runs          experiment-4/
                (Opus: original records; the paper also gives a re-read; both statuses are recorded per unit)
  followups.py  Sol continuation (E) and Opus through omp (F)            moodle-ledger/runs/
                (the first Sol campaign e23c7f6 never reached the agent and is not counted; F re-read recorded)
  moodle.py     Moodle arm C, plan 6ac189f540b8, setup-invalid runs excluded (never reached the agent)

units.jsonl holds no audit codes. Usage:
  uv run followups-2026-11/a-trace-audit/build_units.py [--moodle-src <pin checkout>]
"""
import argparse
import json
import re
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / 'scripts/counts'))
from common import read_jsonl  # noqa: E402
import verified  # noqa: E402

FEATURE = 'study/scenarios.feature'
PAYMENT_SETS = [
    # (set label, campaign label, directory, trials file, log file, re-read directory or None)
    ('B', 'main-B', 'data/campaigns/campaign-b-20261101-02f4758', 'trials.jsonl.zst', 'events.jsonl.zst', None),
    ('C', 'main-C', 'data/campaigns/campaign-c-20261101-f7857ea', 'trials.jsonl.zst', 'events.jsonl.zst', None),
    ('D', 'main-D', 'data/campaigns/campaign-d-20261101-2b2589f', 'trials.jsonl.zst', 'events.jsonl.zst', None),
    ('X4-haiku', 'followup-comparison', 'experiment-4/campaign-experiment4-haiku', 'trials.jsonl', 'journal.jsonl', None),
    ('X4-luna', 'followup-comparison', 'experiment-4/campaign-experiment4-luna', 'trials.jsonl', 'journal.jsonl', None),
    ('X4-sonnet', 'followup-comparison', 'experiment-4/campaign-experiment4-sonnet', 'trials.jsonl', 'journal.jsonl', None),
    ('X4-opus', 'followup-comparison', 'experiment-4/campaign-experiment4-opus', 'trials.jsonl', 'journal.jsonl',
     'experiment-4/campaign-experiment4-opus-verdict-v2'),
    ('E', 'followup-E-sol', 'moodle-ledger/runs/campaign-e-20261118-continuation', 'trials.jsonl', 'journal.jsonl', None),
    ('F', 'followup-F-opus-omp', 'moodle-ledger/runs/campaign-f-20261118-opus', 'trials.jsonl', 'journal.jsonl',
     'moodle-ledger/runs/campaign-f-20261118-opus-verdict-v2'),
]
CLOCK_RECOVERY = {
    'E': 'clock-recovery/campaign-e-20261118-continuation-clock-recovery/trials.jsonl',
    'F': 'clock-recovery/campaign-f-20261118-opus-clock-recovery/trials.jsonl',
}
REVISION = {'v0': 'v0 (original interface)', 'v1': 'v1 (after change 1)', 'v2': 'v2 (after change 2)'}
# Paper totals the unit set must reproduce (catches + false alarms under the stated rule).
EXPECTED = {
    'B': (48, 10), 'C': (48, 7), 'D': (48, 11),
    'X4-haiku': (12, 2), 'X4-luna': (12, 1), 'X4-sonnet': (12, 1), 'X4-opus': (12, 8),
    'E': (24, 0), 'F': (12, 2),
    'moodle-gpt-6-luna': (27, 16), 'moodle-gpt-5.6-terra': (26, 7), 'moodle-claude-haiku-5-5': (27, 13),
}
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
    """CLI that drove the agent. B, C, D records do not store it; REPRODUCE.md gives Codex CLI 0.159.3 (B, C) and omp 18.14.0 (D)."""
    d = agent.get('driver')
    if isinstance(d, dict):
        return d.get('cliVersion') or d.get('driver')
    return {'B': 'codex-cli 0.159.3 (REPRODUCE.md)', 'C': 'codex-cli 0.159.3 (REPRODUCE.md)', 'D': 'omp 18.14.0 (REPRODUCE.md)'}[label]


def step_numbers(steps, normalized):
    return [i + 1 for i, s in enumerate(steps) if verified.normalize(s) == normalized]


def payment_units():
    scenarios, faults, targets = payment_scenarios(), payment_faults(), payment_targets()
    units, tally = [], Counter()
    for label, campaign_label, directory, trials, log, reread_dir in PAYMENT_SETS:
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
            status = rec['reportedStatus']
            assert status in ('pass', 'fail', 'unresolved'), rec['trialId']
            if status == 'pass':
                continue
            tally[(label, t['kind'])] += 1
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
                'reported_equals_target_text': (reported_norm == target) if faulty else None,
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
    ledger = [json.loads(l) for l in (ROOT / 'moodle-ledger/trials.jsonl').read_text('utf-8').splitlines() if l.strip()]
    runs = [r for r in ledger if r.get('type') == 'trial-end' and r.get('arm') == 'C' and r['key'].startswith('6ac189f540b8/')]
    assert len(runs) == 168, len(runs)

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
        status = r['status']
        if status == 'pass':
            continue
        assert status in ('fail', 'unresolved'), r['key']
        faulty = r['state'].startswith('fault:')
        fault = r['state'].split(':', 1)[1] if faulty else None
        _, case, state, _, model, rep = r['key'].split('/')
        scen = r['scenario']
        tally[(f'moodle-{model}', 'fault' if faulty else 'healthy')] += 1
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
        cand = cands[pair_fault_id]
        v = r['verdict']
        blob = r['eventsBlob']
        units.append({
            'unit_id': f'moodle:{r["key"]}',
            'app': 'moodle',
            'run_set': f'moodle-{model}',
            'campaign': 'moodle-campaign-20261116 (plan 6ac189f540b8), arm C',
            'trial_key': r['key'],
            'model': model,
            'driver': 'omp' if model.startswith('claude') else 'codex',
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
            'reported_failing_step': v.get('failingStepText'),
            'reported_failing_step_number': v.get('failingStep'),
            'reported_failing_step_behat_index': v.get('behatStepIndex'),
            'reported_failing_step_verified': v.get('failingStepVerified'),
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
                'trace': f'moodle-ledger/blobs/objects/{blob[:2]}/{blob}  [agent event stream: messages, tool calls, tool results, final verdict]',
                'run_record': f'moodle-ledger/trials.jsonl  [type == "trial-end" and key == "{r["key"]}"]',
                'screenshots': NO_SCREENSHOTS,
                'log': f'moodle-ledger/trials.jsonl  [trial-start / trial-end for key "{r["key"]}"; process.stderrTail]',
            },
        })
    return units, tally


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--moodle-src', default=str(Path.home() / '.local/share/cucumber-study/moodle/src/cfe123f26fc7'))
    args = ap.parse_args()
    head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=args.moodle_src, capture_output=True, text=True, check=True).stdout.strip()
    assert head == 'cfe123f26fc7071981fe949cb16cd5a08a8234f1', head

    pay, pay_tally = payment_units()
    mdl, mdl_tally = moodle_units(args.moodle_src)
    tally = pay_tally + mdl_tally
    for label, (faults, alarms) in EXPECTED.items():
        got = (tally[(label, 'fault')], tally[(label, 'healthy')])
        assert got == (faults, alarms), (label, got, (faults, alarms))
    units = pay + mdl
    assert len({u['unit_id'] for u in units}) == len(units)
    with open(HERE / 'units.jsonl', 'w', encoding='utf-8') as f:
        for u in units:
            f.write(json.dumps(u, ensure_ascii=False) + '\n')
    print(f'{len(units)} units written ({len(pay)} payment, {len(mdl)} Moodle)')
    for label in EXPECTED:
        print(f'  {label:<26} faulty-build failures {tally[(label, "fault")]:>3}   healthy-build failures {tally[(label, "healthy")]:>3}')


if __name__ == '__main__':
    main()
