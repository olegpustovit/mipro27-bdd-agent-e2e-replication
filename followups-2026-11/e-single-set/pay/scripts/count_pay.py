# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Stream E-pay counts: the payment-app cells of the single set (post hoc), under the paper's definitions.

Single set = stream E-pay's campaigns (healthy-v0-1, fault-v0-1/2, healthy-v2-1/2/3, fault-v2-1/2) plus stream B's
v1 campaigns (healthy-v1-1, fault-v1-1/2), same host, harness 9c9eee2 and tool versions.
Reuses scripts/counts/common.py (reading), payment.py (paired-catch rule, original campaigns) and verified.py
(assertion normalisation; target check derived as in verified.py). Definitions (b-change1-faults/README.md):
- status: coded arm = Cucumber exit code; agents = reported status, `unresolved` counted as not passing.
  No run is dropped; infrastructure-invalid runs are kept, scored the same way and listed.
- false alarm: a healthy run that does not pass.
- catch: a faulty run that does not pass. unresolved: faulty agent run with status `unresolved` (counted in catches).
  miss: a faulty run that passed.
- paired catch: catch whose healthy run of the same case/revision/repetition passes (payment.paired_catches: with no
  healthy run at that repetition, repetition 1). v0: both fault repetitions pair with healthy-v0-1; v2: fault rep r
  pairs with healthy-v2-r. v1: in the single set the partner is stream B's fresh healthy-v1-1 run (same arm).
- verified catch: status `fail` (never unresolved) and normalised failedAssertion equal to the case's target check
  (the single normalised failedAssertion of campaign A's coded faulty v0/v2 runs). verified paired catch: verified
  catch whose partner passes.
- coded arm on v1 (stream B's post-hoc rule): faulty runs of scenarios whose coded step definitions do not pass the
  healthy v1 build (the partner run) cannot show a catch; reported separately, never counted as catches.
Usage: uv run scripts/count_pay.py   (writes results/counts.txt and results/counts.json)
"""
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
REPO = HERE.parents[2]
sys.path.insert(0, str(REPO / 'scripts' / 'counts'))
import payment  # noqa: E402
import verified  # noqa: E402
from common import read_jsonl  # noqa: E402

E_STREAM = 'followups-2026-11/e-single-set/pay'
B_STREAM = 'followups-2026-11/b-change1-faults'
ARMS = ('coded', 'Luna', 'Terra', 'Haiku')
E_IDS = {a: f'campaign-h-20261127-single-{a.lower()}' for a in ARMS}
B_IDS = {a: f'campaign-g-20261126-v1faults-{a.lower()}' for a in ARMS}
SOCIAL = payment.SOCIAL
# Plan estimate (e-single-set/plan.md) for the 96 E-pay runs per arm.
ESTIMATE = {'coded': (0.0, 10), 'Luna': (11.0, 61), 'Terra': (23.2, 86), 'Haiku': (23.0, 74)}


def frac(a, b):
    return f'{a}/{b}'


def campaign_rows(stream, cid, label):
    """All trial rows of one campaign, none dropped. Returns None when the campaign is not packaged yet."""
    arm = 'maintained' if label == 'coded' else 'runtime'
    path = f'{stream}/data/campaigns/{cid}/trials.jsonl.zst'
    if not (REPO / path).exists():
        return None
    rows = []
    for row in read_jsonl(path):
        record = row['record']
        trial = record['trial']
        assert trial['arm'] == arm, record['trialId']
        if arm == 'maintained':
            status = 'pass' if (record.get('baseline') or {}).get('code') == 0 else 'fail'
        else:
            status = record['reportedStatus']
            assert status in ('pass', 'fail', 'unresolved'), record['trialId']
        agent = record.get('agent') or {}
        usage = agent.get('usage') or {}
        rows.append({'kind': trial['kind'], 'caseId': trial['caseId'], 'revision': trial['revision'],
                     'repetition': trial['repetition'], 'status': status, 'trialId': record['trialId'],
                     'invalid': row['result'] != 'recorded', 'error': record.get('error'),
                     'implementationSHA': record.get('implementationSHA'),
                     'assertion': verified.normalize(record.get('failedAssertion')),
                     'tokens': (usage.get('input_tokens') or 0) + (usage.get('output_tokens') or 0) if usage else None,
                     'input': usage.get('input_tokens') if usage else None,
                     'cached': usage.get('cached_input_tokens') if usage else None,
                     'runnerRetries': agent.get('runnerRetries'),
                     'elapsedMs': record.get('elapsedMs'),
                     'models': agent.get('actualModels'), 'modelVerified': agent.get('modelVerified')})
    return rows


def journal_facts(stream, cid):
    """Journal-level facts: attempts > 1, interrupted / not-run trials, stops, completion."""
    path = REPO / stream / 'data' / 'campaigns' / cid / 'journal.jsonl'
    lines = [json.loads(x) for x in path.read_text().splitlines() if x.strip()]
    types = Counter(x['type'] for x in lines)
    return {'trial-started': types['trial-started'], 'trial-finished': types['trial-finished'],
            'trial-interrupted': types['trial-interrupted'], 'trial-not-run': types['trial-not-run'],
            'attempts>1': sum(x['type'] == 'trial-started' and x.get('attempt', 1) > 1 for x in lines),
            'campaign-complete': types['campaign-complete'], 'campaign-stopped': types['campaign-stopped'],
            'inputs': lines[0]['inputs'] if lines and lines[0]['type'] == 'campaign-frozen' else None}


def mcp_transport_failures(stream, cid):
    """Browser-tool transport failures inside agent runs (informational, not a verdict input): omp
    tool_execution_end events whose result text starts with 'MCP failure' (e.g. ECONNRESET), and Codex
    rollout/tool events carrying the same text. Attributed to the trial whose trial-start precedes them.
    Such failures are reported to the agent ('retryable: no'); neither the harness (runnerRetries) nor the
    driver retries them. Returns {trialId: count} or None when the events are not packaged."""
    path = f'{stream}/data/campaigns/{cid}/events.jsonl.zst'
    if not (REPO / path).exists():
        return None
    hits, current = Counter(), None
    for event in read_jsonl(path):
        if event.get('type') == 'trial-start':
            current = event['trial']['id']
            continue
        inner = event.get('event') if isinstance(event.get('event'), dict) else {}
        if event.get('type') == 'agent-event' and inner.get('type') != 'tool_execution_end':
            continue
        if event.get('type') in ('agent-event', 'codex-rollout', 'tool-event') and 'MCP failure' in json.dumps(event):
            hits[current] += 1
    return hits


def targets():
    coded_assertions = verified.failed_assertions('coded')
    out = defaultdict(set)
    for row in payment.runs('coded')[1]:
        if row['kind'] == 'fault':
            out[row['caseId']].add(coded_assertions[row['trialId']])
    assert all(len(v) == 1 and all(v) for v in out.values())
    return {case: next(iter(v)) for case, v in out.items()}


def version_counts(label, revision, rows, target):
    healthy = [r for r in rows if r['kind'] == 'healthy' and r['revision'] == revision]
    faulty = [r for r in rows if r['kind'] == 'fault' and r['revision'] == revision]
    a: dict = {'healthy runs': len(healthy), 'faulty runs': len(faulty)}
    a['false alarms (healthy not passing)'] = frac(sum(r['status'] != 'pass' for r in healthy), len(healthy))
    a['  false alarms with unresolved verdict'] = sum(r['status'] == 'unresolved' for r in healthy)
    a['  false alarms: scenarios'] = dict(sorted(Counter(r['caseId'] for r in healthy if r['status'] != 'pass').items()))
    ver = [r for r in faulty if r['status'] == 'fail' and r['assertion'] == target[r['caseId']]]
    partner_status = {(r['caseId'], r['repetition']): r['status'] for r in healthy}
    if label == 'coded' and revision == 'v1':
        # Stream B's rule: scenarios not passing healthy v1 (the single-set partner = B's fresh healthy-v1-1) cannot show a catch.
        eligible = {r['caseId'] for r in healthy if r['status'] == 'pass'}
        elig = [r for r in faulty if r['caseId'] in eligible]
        inel = [r for r in faulty if r['caseId'] not in eligible]
        a['scenarios passing healthy v1'] = f'{len(eligible)}/12: ' + ','.join(sorted(eligible))
        a['catches (eligible scenarios)'] = frac(sum(r['status'] != 'pass' for r in elig), len(elig))
        a['unresolved'] = 0
        a['misses (eligible scenarios)'] = sum(r['status'] == 'pass' for r in elig)
        a['faulty runs on scenarios failing healthy v1 (not catches)'] = len(inel)
        a['  of which failed'] = sum(r['status'] != 'pass' for r in inel)
        a['  of which passed'] = sum(r['status'] == 'pass' for r in inel)
        a['not passing, all faulty runs (uncorrected)'] = frac(sum(r['status'] != 'pass' for r in faulty), len(faulty))
        a['verified catches (eligible scenarios)'] = frac(sum(r in ver for r in elig), len(elig))
    else:
        a['catches'] = frac(sum(r['status'] != 'pass' for r in faulty), len(faulty))
        a['unresolved (included in catches)'] = sum(r['status'] == 'unresolved' for r in faulty)
        a['misses (faulty run passed)'] = sum(r['status'] == 'pass' for r in faulty)
        a['verified catches'] = frac(len(ver), len(faulty))
    a['paired catches'] = frac(payment.paired_catches(healthy + faulty)[0], len(faulty))
    a['verified paired catches'] = frac(payment.paired_catches(healthy + ver)[0], len(faulty))
    a['infrastructure-invalid runs (healthy+faulty)'] = sum(r['invalid'] for r in healthy + faulty)
    per_case = defaultdict(list)
    for r in sorted(faulty, key=lambda r: r['repetition']):
        partner = partner_status.get((r['caseId'], r['repetition']), partner_status.get((r['caseId'], 1)))
        per_case[r['caseId']].append(r['status'] + ('*' if r in ver else '') + ('!' if r['invalid'] else '')
                                     + ('' if partner == 'pass' else '~'))
    a['per fault (* verified at target, ~ partner not passing, ! invalid)'] = {c: per_case[c] for c in sorted(per_case)}
    return a, {'fa': sum(r['status'] != 'pass' for r in healthy), 'healthy': len(healthy), 'faulty': len(faulty),
               'catch': a.get('catches', a.get('catches (eligible scenarios)')), 'unres': sum(r['status'] == 'unresolved' for r in faulty),
               'miss': a.get('misses (faulty run passed)', a.get('misses (eligible scenarios)')),
               'paired': a['paired catches'], 'ver': a.get('verified catches', a.get('verified catches (eligible scenarios)')),
               'verpaired': a['verified paired catches'],
               'inel': a.get('faulty runs on scenarios failing healthy v1 (not catches)')}


def cost(rows):
    tok = [r['tokens'] for r in rows if r['tokens'] is not None]
    inp = sum(r['input'] or 0 for r in rows if r['tokens'] is not None)
    cached = sum(r['cached'] or 0 for r in rows if r['tokens'] is not None)
    return {'runs': len(rows), 'runs with usage': len(tok), 'tokens M': round(sum(tok) / 1e6, 2),
            'cached share of input': round(cached / inp, 3) if inp else None,
            'trial minutes': round(sum(r['elapsedMs'] or 0 for r in rows) / 60000, 1)}


def main():
    target = targets()
    out = {'targets': target, 'arms': {}, 'summary': {}}
    lines = []
    p = lines.append
    p('Stream E-pay: payment-app cells of the single set. status exploratory-owner-directed, gatePassExists false; post hoc.')
    p('v0 and v2 from stream E-pay (campaign-h-20261127-single-*), v1 from stream B (campaign-g-20261126-v1faults-*).')
    table = []
    for label in ARMS:
        e_rows = campaign_rows(E_STREAM, E_IDS[label], label)
        b_rows = campaign_rows(B_STREAM, B_IDS[label], label)
        if e_rows is None:
            p(f'\n## {label}: no stream E-pay data yet')
            continue
        a: dict = {'E-pay campaign': E_IDS[label], 'v1 campaign (stream B)': B_IDS[label]}
        facts = journal_facts(E_STREAM, E_IDS[label])
        inputs = facts.pop('inputs') or {}
        a['journal'] = facts
        a['frozen inputs'] = {'harnessCommit': (inputs.get('followup') or {}).get('harnessCommit'),
                              'node': inputs.get('node'), 'codex': inputs.get('codex'), 'driver': inputs.get('driver'),
                              'orderSeed': inputs.get('orderSeed'), 'deadline': inputs.get('deadline'),
                              'runtimeSource': (inputs.get('runtimeSource') or {}).get('id'),
                              'executionsPlanned': (inputs.get('config') or {}).get('executions')}
        a['runs per stage (E-pay)'] = dict(Counter(f"{r['kind']}-{r['revision']}-{r['repetition']}" for r in e_rows))
        a['step code per revision'] = {rev: sorted({(r['implementationSHA'] or '')[:8] for r in e_rows if r['revision'] == rev})
                                       for rev in ('v0', 'v2')} if label == 'coded' else '-'
        all_rows = e_rows + (b_rows or [])
        summary = {}
        for rev in ('v0', 'v1', 'v2'):
            src = b_rows if rev == 'v1' else e_rows
            if src is None:
                continue
            a[rev], summary[rev] = version_counts(label, rev, src, target)
        # Pooled over versions (agents; coded pooled only where B's v1 rule does not apply is left to the reader).
        a['cost, E-pay runs'] = cost(e_rows)
        a['cost, single set incl. stream B v1'] = cost(all_rows)
        if label != 'coded':
            a['models reported (E-pay)'] = dict(Counter(m for r in e_rows for m in (r['models'] or ['<none>'])))
            a['runs with modelVerified not true (E-pay)'] = sum(r['modelVerified'] is not True for r in e_rows)
            a['harness runnerRetries (E-pay, sum)'] = sum(r['runnerRetries'] or 0 for r in e_rows)
            hits = mcp_transport_failures(E_STREAM, E_IDS[label])
            a['MCP transport failures reported to the agent (E-pay; per trial)'] = dict(hits) if hits else 0
        est = ESTIMATE[label]
        a['plan estimate for the 96 runs (tokens M, trial minutes)'] = f'{est[0]}M, {est[1]} min'
        a['infrastructure-invalid runs (E-pay)'] = {r['trialId']: (r['error'] or '')[:200] for r in e_rows if r['invalid']}
        out['arms'][label] = a
        out['summary'][label] = summary
        p(f'\n## {label}')
        for k, v in a.items():
            if isinstance(v, dict) and k in ('v0', 'v1', 'v2'):
                p(f'### {label} {k}')
                for k2, v2 in v.items():
                    p(f'  {k2:<70} {v2}')
            else:
                p(f'{k:<72} {v}')
        table.append((label, summary, a['cost, E-pay runs']))
    p('\n## Summary table (single set; v1 = stream B runs, partner = B fresh healthy-v1-1)')
    p(f'{"arm":<6} {"ver":<3} {"false alarms":>12} {"catches":>9} {"unres":>5} {"misses":>6} {"paired":>7} {"verified":>8} {"ver.paired":>10}')
    for label, summary, _ in table:
        for rev, s in summary.items():
            catch = s['catch'] + (f' (+{s["inel"]} n/a)' if s['inel'] else '')
            p(f'{label:<6} {rev:<3} {frac(s["fa"], s["healthy"]):>12} {catch:>9} {s["unres"]:>5} {s["miss"]:>6} {s["paired"]:>7} {s["ver"]:>8} {s["verpaired"]:>10}')
    p('\nCost (E-pay runs only): arm, runs, runs with usage, tokens M (input+output), cached share of input, trial minutes')
    for label, _, c in table:
        p(f'{label:<6} {c["runs"]:>4} {c["runs with usage"]:>4} {c["tokens M"]:>8} {str(c["cached share of input"]):>6} {c["trial minutes"]:>7}')
    text = '\n'.join(lines)
    print(text)
    (HERE / 'results').mkdir(exist_ok=True)
    (HERE / 'results' / 'counts.txt').write_text(text + '\n')
    (HERE / 'results' / 'counts.json').write_text(json.dumps(out, indent=1, default=str) + '\n')


if __name__ == '__main__':
    main()
