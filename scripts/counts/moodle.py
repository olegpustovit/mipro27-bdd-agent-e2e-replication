# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Moodle: developers' current step definitions (arm A), updated step definitions (arm B, one
update session per historical change, model and repetition) and browser agents (arm C).

Input: results/moodle-campaign.txt, the per-pair table and the list of invalid individual
executions (regenerate it with `npm run analyze:moodle -- --plan 6ac189f540b8`).
Scoring: a run is a pass or not. An agent "unresolved" verdict counts as fail. Runs whose cause
is the setup "Scenario has no leading data steps..." are excluded (they never reached the agent).
Catch = faulty run not passing; false alarm = healthy run not passing; paired catch = healthy
run passes AND faulty run of the same pair and repetition does not pass.
"""
import json
import re
from collections import defaultdict

from common import ROOT, Checker, main

CHANGES = ['B04', 'B07', 'B15', 'B25', 'B27', 'B28', 'B29', 'B34']
SAME_ASSERTION = 'B04'  # the change whose edited step contains the target assertion
MODELS = {'gpt-6-luna': 'Luna', 'gpt-5.6-terra': 'Terra', 'claude-haiku-5-5': 'Haiku'}
SETUP_CAUSE = 'Scenario has no leading data steps'
PAIR = re.compile(r'^(B\d+)\.(S\d+)\s+(X\d+)\s+([ABC])\s+(\S+)\s+(\d+)\s+\S+\s+(\S+)\s+(\S+) \(target \d+\)$')
INVALID = re.compile(r'^  [0-9a-f]+/(B\d+)\.(S\d+)/(healthy|fault:X\d+)/([ABC])/(\S+)/r(\d+): (.+)$')

EXPECTED = {
    'A': {'catches': '16/16', 'false_alarms': '0/16', 'paired': '16/16', 'same': '3/3', 'downstream': '13/13'},
    'B': {'catches': '96/96', 'false_alarms': '35/96', 'paired': '61/96', 'same': '6/18', 'downstream': '55/78'},
    'C': {
        'Luna': {'catches': '27/28', 'catch_unresolved': 2, 'false_alarms': '16/28', 'fa_unresolved': 0, 'paired': '11/28', 'same': '4/6', 'downstream': '7/22'},
        'Terra': {'catches': '26/28', 'catch_unresolved': 4, 'false_alarms': '7/28', 'fa_unresolved': 3, 'paired': '19/28', 'same': '6/6', 'downstream': '13/22'},
        'Haiku': {'catches': '27/28', 'catch_unresolved': 6, 'false_alarms': '13/28', 'fa_unresolved': 6, 'paired': '14/28', 'same': '6/6', 'downstream': '8/22'},
    },
    'fa_sessions': '16/48', 'fa_changes': 'B04,B07,B25,B28,B29', 'b28_fa_sessions': '6/6',
    'healthy_passing_sessions': {'B04': 2, 'B07': 4, 'B15': 6, 'B25': 3, 'B27': 6, 'B28': 0, 'B29': 5, 'B34': 6},
    'agent_fa_b29_b34_b25': '25/36',
    'agent_pairs': '14 pairs from 7 changes',
    'A_on_agent_pairs': {'catches': '14/14', 'false_alarms': '0/14', 'paired': '14/14'},
    'unresolved_at_tool_limit': '13/21',
}
TOOL_CALL_LIMIT = 60  # per agent run in Moodle; a run that hit it records more than 60 calls


def parse():
    """Pair rows and invalid causes from results/moodle-campaign.txt."""
    pairs, causes = [], {}
    for line in (ROOT / 'results/moodle-campaign.txt').read_text('utf-8').splitlines():
        if m := PAIR.match(line):
            change, scenario, fault, arm, model, rep, healthy, faulty = m.groups()
            pairs.append({'change': change, 'case': f'{change}.{scenario}', 'arm': arm, 'model': model,
                          'rep': int(rep), 'healthy': healthy, 'faulty': faulty})
        elif m := INVALID.match(line):
            change, scenario, kind, arm, model, rep, cause = m.groups()
            key = (f'{change}.{scenario}', 'healthy' if kind == 'healthy' else 'faulty', arm, model, int(rep))
            assert key not in causes, key
            causes[key] = cause
    assert len(pairs) == 16 + 96 + 96, len(pairs)
    assert len(causes) == 45, len(causes)
    return pairs, causes


def status(pair, side, causes):
    """'pass', 'fail', 'unresolved' (counts as fail) or None for a setup-invalid run."""
    token = pair[side]
    if token == 'pass':
        return 'pass'
    if token.startswith('fail'):
        return 'fail'
    assert token.startswith('invalid'), token
    cause = causes[(pair['case'], side, pair['arm'], pair['model'], pair['rep'])]
    if cause.startswith(SETUP_CAUSE):
        return None
    assert cause == 'unresolved', cause
    return 'unresolved'


def summary(rows, causes):
    faulty = [status(p, 'faulty', causes) for p in rows]
    healthy = [status(p, 'healthy', causes) for p in rows]
    valid_f = [s for s in faulty if s is not None]
    valid_h = [s for s in healthy if s is not None]
    both = [(h, f) for h, f in zip(healthy, faulty) if h is not None and f is not None]
    return {
        'catches': f'{sum(s != "pass" for s in valid_f)}/{len(valid_f)}',
        'catch_unresolved': sum(s == 'unresolved' for s in valid_f),
        'false_alarms': f'{sum(s != "pass" for s in valid_h)}/{len(valid_h)}',
        'fa_unresolved': sum(s == 'unresolved' for s in valid_h),
        'paired': f'{sum(h == "pass" and f != "pass" for h, f in both)}/{len(both)}',
        'alarms': [p for p, s in zip(rows, healthy) if s is not None and s != 'pass'],
    }


def run(ck: Checker):
    pairs, causes = parse()
    setup = sum(c.startswith(SETUP_CAUSE) for c in causes.values())
    ck.section('Moodle (setup-invalid runs excluded, unresolved = fail)')
    ck.check('invalid individual executions', len(causes), 45)
    ck.check('  of which setup ("no leading data steps")', setup, 24)
    ck.check('  of which unresolved verdicts', len(causes) - setup, 21)
    for arm, label in (('A', "developers' current coded"), ('B', 'updated coded')):
        rows = [p for p in pairs if p['arm'] == arm]
        s = summary(rows, causes)
        for key in ('catches', 'false_alarms', 'paired'):
            ck.check(f'{label} {key.replace("_", " ")}', s[key], EXPECTED[arm][key])
        ck.check(f'{label} paired, same-assertion ({SAME_ASSERTION})',
                 summary([p for p in rows if p['change'] == SAME_ASSERTION], causes)['paired'], EXPECTED[arm]['same'])
        ck.check(f'{label} paired, downstream',
                 summary([p for p in rows if p['change'] != SAME_ASSERTION], causes)['paired'], EXPECTED[arm]['downstream'])

    # Update sessions: one per (change, model, repetition); its result serves every pair of that change.
    sessions = defaultdict(list)
    for p in pairs:
        if p['arm'] == 'B':
            sessions[(p['change'], p['model'], p['rep'])].append(status(p, 'healthy', causes))
    assert len(sessions) == 48 and {c for c, _, _ in sessions} == set(CHANGES)
    alarmed = {k for k, v in sessions.items() if any(s != 'pass' for s in v)}
    ck.check('update sessions with a false alarm', f'{len(alarmed)}/{len(sessions)}', EXPECTED['fa_sessions'])
    ck.check('changes with a false-alarming update', ','.join(sorted({c for c, _, _ in alarmed})), EXPECTED['fa_changes'])
    ck.check('B28 update sessions with a false alarm',
             f'{sum(c == "B28" for c, _, _ in alarmed)}/{sum(c == "B28" for c, _, _ in sessions)}', EXPECTED['b28_fa_sessions'])
    for change in CHANGES:
        passing = sum(1 for k in sessions if k[0] == change and k not in alarmed)
        ck.check(f'{change} updates passing all healthy runs (of 6)', passing, EXPECTED['healthy_passing_sessions'][change])

    ck.section('Moodle browser agents (arm C)')
    all_alarms = []
    for model, label in MODELS.items():
        rows = [p for p in pairs if p['arm'] == 'C' and p['model'] == model]
        s = summary(rows, causes)
        expected = EXPECTED['C'][label]
        for key in ('catches', 'catch_unresolved', 'false_alarms', 'fa_unresolved', 'paired'):
            ck.check(f'{label} {key.replace("_", " ")}', s[key], expected[key])
        ck.check(f'{label} paired, same-assertion ({SAME_ASSERTION})',
                 summary([p for p in rows if p['change'] == SAME_ASSERTION], causes)['paired'], expected['same'])
        ck.check(f'{label} paired, downstream',
                 summary([p for p in rows if p['change'] != SAME_ASSERTION], causes)['paired'], expected['downstream'])
        all_alarms += s['alarms']
    cluster = sum(p['change'] in ('B29', 'B34', 'B25') for p in all_alarms)
    ck.check('agent false alarms in B29+B34+B25', f'{cluster}/{len(all_alarms)}', EXPECTED['agent_fa_b29_b34_b25'])

    # The pairs the agents could run (setup-invalid scenarios excluded) and the coded arm on the same pairs.
    agent_cases = {p['case'] for p in pairs if p['arm'] == 'C'
                   and (status(p, 'healthy', causes) is not None or status(p, 'faulty', causes) is not None)}
    ck.check('pairs the agents could run', f"{len(agent_cases)} pairs from {len({c.split('.')[0] for c in agent_cases})} changes",
             EXPECTED['agent_pairs'])
    a14 = summary([p for p in pairs if p['arm'] == 'A' and p['case'] in agent_cases], causes)
    for key in ('catches', 'false_alarms', 'paired'):
        ck.check(f"developers' current coded on the agents' pairs, {key.replace('_', ' ')}", a14[key], EXPECTED['A_on_agent_pairs'][key])

    # Unresolved agent verdicts from runs that ended at the tool-call limit (moodle-ledger records).
    ledger = [json.loads(line) for line in (ROOT / 'moodle-ledger/trials.jsonl').read_text('utf-8').splitlines() if line.strip()]
    unresolved = [r for r in ledger if r.get('arm') == 'C' and r.get('status') == 'unresolved']
    at_limit = sum((r.get('toolCalls') or 0) > TOOL_CALL_LIMIT for r in unresolved)
    ck.check('unresolved agent runs that ended at the tool-call limit', f'{at_limit}/{len(unresolved)}', EXPECTED['unresolved_at_tool_limit'])


if __name__ == '__main__':
    main(run)
