# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Single set: every number the revised paper may state from the one consistent set of runs (post hoc).

Status of every run: exploratory-owner-directed, gatePassExists false; the single set was decided after the
original campaigns (followups-2026-11/e-single-set/plan.md).

Usage (from the package root):  uv run scripts/counts/single_set.py [--moodle-ledger DIR] [--no-write]
Writes results/counts-single-set.txt and results/counts-single-set.json (unless --no-write).
Exit status 1 when a value differs from the value a stream script printed, or when a version check fails.
PENDING (data incomplete) and NOT FOUND (value cannot be computed from the records) are not failures here;
scripts/reproduce_single_set.py fails on them when the paper states the value.

Sections
1. Payment app per arm and version (v0, v1, v2) and totals (v0+v2; all versions).
   Data: v0/v2 = e-single-set/pay campaigns campaign-h-20261127-single-*; v1 = b-change1-faults campaigns
   campaign-g-20261126-v1faults-*; the v1 pairing partner is stream B's fresh healthy-v1-1 run.
2. Change-1 (v1) rows, including the coded arm's eligibility split (stream B's rule).
3. Moodle single set (e-single-set/moodle ledger).
4. Cost per suite (paper style: mean per run x 12 or x 16) and measured totals.
5. Moodle replay (d-moodle-replay ledger).
6. Verdict parser and versions, with a check that every single-set campaign shares them.
7. Trace audit of the single-set agent failures (three coders).
8. Further quantities the paper states (derived from the single set; the reused step-definition update sessions;
   Moodle case selection). Only the single set is reported; the 1 Nov campaigns keep their own counts
   (results/counts-v1.1.4.txt, scripts/reproduce_counts.py). Campaign A's records are read only for the target checks
   (verified.py's rule) and for the update sessions whose code the single set reuses.

Rules are the paper's and are reused, not re-derived:
- payment.py: status (coded = Cucumber exit code; agents = reported status, unresolved = not passing),
  SOCIAL, paired_catches (same case/revision/repetition, else repetition 1).
- verified.py: normalize; target check = the single normalised failedAssertion of campaign A's coded faulty runs.
- Stream B's coded-v1 rule: faulty runs of scenarios whose step definitions do not pass the healthy v1 partner
  cannot show a catch; reported separately, never counted as catches.
- No run is dropped; infrastructure-invalid runs are scored by their status (as payment.py does for coded runs)
  and listed.
- Moodle: e-single-set/moodle/scripts/count_moodle.py status() and at_target() (moodle.py scoring; setup
  exceptions excluded and listed). Replay: d-moodle-replay/scripts/count_replay.py status(), group(), parse_key().
Every value line names its source file(s). Values a stream script prints are checked against that output.
"""
import contextlib
import io
import json
import re
import subprocess
import sys
from collections import Counter, defaultdict
from fractions import Fraction
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import payment  # noqa: E402
import verified  # noqa: E402
from common import ROOT  # noqa: E402
from common import read_jsonl  # noqa: E402

FU = 'followups-2026-11'
E_PAY = f'{FU}/e-single-set/pay'
B_STREAM = f'{FU}/b-change1-faults'
E_MOODLE = f'{FU}/e-single-set/moodle'
D_STREAM = f'{FU}/d-moodle-replay'
ARMS = ('coded', 'Luna', 'Terra', 'Haiku')
AGENTS = ('Luna', 'Terra', 'Haiku')
MODEL_OF = {'Luna': 'gpt-6-luna', 'Terra': 'gpt-5.6-terra', 'Haiku': 'claude-haiku-5-5'}
LABEL_OF = {v: k for k, v in MODEL_OF.items()}
SOCIAL = payment.SOCIAL

# Completion flags for the streams still running. Set to True only when the coordinator reports the stream done.
E_MOODLE_DONE = True  # coordinator, task t_bccc2be5fc998409 (2026-11-27): stream E-moodle done
D_DONE = True  # coordinator, task t_bfa06b864e2ee52b (2026-11-27): stream D done
MOODLE_SRC = f'{E_MOODLE}/data/ledger/trials.jsonl'
MOODLE_THEIRS = ({}, None)

# The setup the plan fixed (e-single-set/plan.md, "Owner decision this implements").
PLAN_MD = f'{FU}/e-single-set/plan.md'
PLAN = {'harnessCommit': '9c9eee2478ca761902f963fd7ccc791a57a4439b', 'codex': 'codex-cli 0.169.0', 'omp': 'omp/18.20.2',
        'node': 'v24.22.1', 'playwright': '1.65.0-alpha-2026-10-30', 'playwrightMcp': '0.0.84', 'bwrap': 'bubblewrap 0.9.0',
        'host': '<host>', 'appRevision': '0729f68ac220f7cda4ad09c5693dba11d7c532c6',
        'moodleCommit': 'cfe123f26fc7071981fe949cb16cd5a08a8234f1', 'php': '8.3', 'postgres': '17',
        'payRuntimeWallMs': 240000, 'payRetainedWallMs': 60000, 'moodleToolCalls': 60, 'moodleTimeoutMs': 300000}


def e_dir(arm):
    return f'{E_PAY}/data/campaigns/campaign-h-20261127-single-{arm.lower()}'


def b_dir(arm):
    return f'{B_STREAM}/data/campaigns/campaign-g-20261126-v1faults-{arm.lower()}'


# --------------------------------------------------------------------------------------------------- output

class Out:
    """Value rows: quantity, value, stream value (if any), status, source files."""

    def __init__(self):
        self.rows = []

    def section(self, title, status=None):
        self.rows.append({'type': 'section', 'title': title, 'status': status})

    def note(self, text):
        self.rows.append({'type': 'note', 'text': text})

    def val(self, quantity, value, sources, expected=None, expected_src=None, status=None):
        sources = [sources] if isinstance(sources, str) else list(sources)
        if value is None and status is None:
            status, value = 'NOT FOUND', 'NOT FOUND'
        elif status is None:
            if expected is None:
                status = 'info'
            else:
                status = 'ok' if str(value) == str(expected) else 'MISMATCH'
        if expected_src:
            sources.append(f'check: {expected_src}')
        assert all(r.get('quantity') != quantity for r in self.rows), f'duplicate quantity {quantity}'
        self.rows.append({'type': 'row', 'quantity': quantity, 'value': str(value),
                          'expected': None if expected is None else str(expected), 'status': status, 'sources': sources})

    def fail(self, quantity, value, sources, why):
        self.val(quantity, value, sources, status=f'MISMATCH: {why}')

    @property
    def failures(self):
        return [r for r in self.rows if r['type'] == 'row' and r['status'].startswith('MISMATCH')]

    def render(self):
        width = min(84, max([len(r['quantity']) for r in self.rows if r['type'] == 'row'] + [20]))
        vwidth = min(28, max([len(r['value']) for r in self.rows if r['type'] == 'row'] + [10]))
        out = []
        for r in self.rows:
            if r['type'] == 'section':
                out += ['', f'## {r["title"]}' + (f'  [{r["status"]}]' if r['status'] else ''),
                        f'{"quantity":<{width}}  {"value":>{vwidth}}  {"stream":>12}  {"status":<9}  source']
            elif r['type'] == 'note':
                out.append(f'   note: {r["text"]}')
            else:
                out.append(f'{r["quantity"]:<{width}}  {r["value"]:>{vwidth}}  {(r["expected"] or ""):>12}  '
                           f'{r["status"]:<9}  {"; ".join(r["sources"])}')
        return '\n'.join(out)


def frac(n, d):
    return f'{n}/{d}'


def exact_mean(total, n, scale_num=1, scale_den=1):
    """Exact value of total/n * scale as a Fraction, and a decimal shown to 4 places (no rounding in the comparison)."""
    if not n:
        return None, None
    f = Fraction(total, n) * Fraction(scale_num, scale_den)
    return f, f'{float(f):.4f}'


# ------------------------------------------------------------------------------------- stream output parsers

def parse_stream_counts(rel):
    """Parse a stream counts.txt written as f'{key:<72} {value}' (stream B and E-pay layouts)."""
    path = ROOT / rel
    if not path.exists():
        return None
    out, arm, sub = {}, None, None
    for line in path.read_text('utf-8').splitlines():
        if m := re.match(r'^## (\w+)', line):
            arm, sub = m[1], None
            out.setdefault((arm, None), {})
            continue
        if m := re.match(r'^### (\w+) (v\d)$', line):
            sub = m[2]
            out[(arm, sub)] = {}
            continue
        if arm is None or len(line) < 74 or line[72] != ' ':
            continue
        if sub and not line.startswith('  '):
            sub = None
        key = line[:72].strip()
        if key:
            out[(arm, sub)][key] = line[73:].strip()
    return out


E_COUNTS = f'{E_PAY}/results/counts.txt'
B_COUNTS = f'{B_STREAM}/results/counts.txt'
_streams = {}


def stream(rel, arm, sub, key, first_token=False):
    if rel not in _streams:
        _streams[rel] = parse_stream_counts(rel)
    data = _streams[rel]
    if data is None:
        return 'NO STREAM FILE'
    value = data.get((arm, sub), {}).get(key)
    if value is None:
        return f'NO STREAM VALUE ({key})'
    return value.split()[0] if first_token and value else value


# ------------------------------------------------------------------------------------------------ payment

def load_runs(cdir, label):
    """Every trial row of one campaign (none dropped), scored as payment.runs() scores it."""
    arm = 'maintained' if label == 'coded' else 'runtime'
    rows = []
    for row in read_jsonl(f'{cdir}/trials.jsonl.zst'):
        record = row['record']
        trial = record['trial']
        assert trial['arm'] == arm, record['trialId']
        agent = record.get('agent') or {}
        if arm == 'maintained':
            status = 'pass' if (record.get('baseline') or {}).get('code') == 0 else 'fail'
        else:
            status = record['reportedStatus']
            assert status in ('pass', 'fail', 'unresolved'), record['trialId']
        rows.append({'kind': trial['kind'], 'caseId': trial['caseId'], 'revision': trial['revision'],
                     'repetition': trial['repetition'], 'status': status, 'trialId': record['trialId'],
                     'reportedStatus': record.get('reportedStatus'), 'invalid': row['result'] != 'recorded',
                     'error': record.get('error'), 'assertion': verified.normalize(record.get('failedAssertion')),
                     'usage': agent.get('usage') or None, 'elapsedMs': record.get('elapsedMs'),
                     'parser': agent.get('verdictParserVersion'), 'format': agent.get('verdictFormat'),
                     'parseError': agent.get('verdictParseError'), 'models': agent.get('actualModels'),
                     'requested': agent.get('requestedModel'), 'modelVerified': agent.get('modelVerified'),
                     'implementationSHA': record.get('implementationSHA'), 'source': f'{cdir}/trials.jsonl.zst'})
    return rows


def targets():
    """verified.py's target check per case: the single normalised failedAssertion of campaign A's coded faulty runs."""
    assertions = verified.failed_assertions('coded')
    out = defaultdict(set)
    for row in payment.runs('coded')[1]:
        if row['kind'] == 'fault':
            out[row['caseId']].add(assertions[row['trialId']])
    for case, values in out.items():
        assert len(values) == 1 and all(values), (case, values)
    return {case: next(iter(v)) for case, v in out.items()}


def cell(label, rows, target):
    """Counts for one arm over the given rows (any mix of revisions). Returns a dict of exact counts."""
    healthy = [r for r in rows if r['kind'] == 'healthy']
    faulty = [r for r in rows if r['kind'] == 'fault']
    # Stream B's rule, coded arm on v1: a scenario whose healthy v1 partner does not pass cannot show a catch.
    ineligible_cases = {r['caseId'] for r in healthy if r['revision'] == 'v1' and r['status'] != 'pass'} if label == 'coded' else set()
    ineligible = [r for r in faulty if r['revision'] == 'v1' and r['caseId'] in ineligible_cases]
    eligible = [r for r in faulty if r not in ineligible]
    ver = [r for r in eligible if r['status'] == 'fail' and r['assertion'] == target[r['caseId']]]
    alarms = [r for r in healthy if r['status'] != 'pass']
    social_healthy = [r for r in healthy if r['caseId'] in SOCIAL]
    out_f = [r for r in faulty if r['caseId'] not in SOCIAL]
    out_elig = [r for r in eligible if r['caseId'] not in SOCIAL]
    out_rows = [r for r in rows if r['caseId'] not in SOCIAL]
    return {
        'healthy': len(healthy), 'faulty': len(faulty),
        'fa': len(alarms), 'fa_unres': sum(r['status'] == 'unresolved' for r in alarms),
        'fa_social': sum(r['caseId'] in SOCIAL for r in alarms),
        'social_healthy': len(social_healthy), 'social_healthy_np': sum(r['status'] != 'pass' for r in social_healthy),
        'fa_scenarios': dict(sorted(Counter(r['caseId'] for r in alarms).items())),
        'eligible': len(eligible), 'catch': sum(r['status'] != 'pass' for r in eligible),
        'catch_unres': sum(r['status'] == 'unresolved' for r in eligible),
        'miss': sum(r['status'] == 'pass' for r in eligible),
        'inel': len(ineligible), 'inel_failed': sum(r['status'] != 'pass' for r in ineligible),
        'inel_target': sum(r['status'] == 'fail' and r['assertion'] == target[r['caseId']] for r in ineligible),
        'inel_passed': sum(r['status'] == 'pass' for r in ineligible),
        'inel_cases': sorted(ineligible_cases),
        'uncorrected': sum(r['status'] != 'pass' for r in faulty),
        'paired': payment.paired_catches(healthy + faulty)[0],
        'ver': len(ver), 'verpaired': payment.paired_catches(healthy + ver)[0],
        'out_faulty': len(out_f), 'out_eligible': len(out_elig),
        'out_healthy': sum(r['caseId'] not in SOCIAL for r in healthy),
        'out_fa': sum(r['caseId'] not in SOCIAL and r['status'] != 'pass' for r in healthy),
        'out_catch': sum(r['status'] != 'pass' for r in out_elig),
        'out_ver': sum(r['caseId'] not in SOCIAL for r in ver),
        'out_paired': payment.paired_catches([r for r in out_rows if r['kind'] == 'healthy'] + [r for r in out_f])[0],
        'out_verpaired': payment.paired_catches([r for r in out_rows if r['kind'] == 'healthy'] + [r for r in ver if r['caseId'] not in SOCIAL])[0],
        'invalid': [r for r in rows if r['invalid']],
    }


def payment_section(out, data, target):
    out.section('1. Payment app, single set (v0, v2: stream E-pay; v1: stream B; v1 partner = B fresh healthy-v1-1)')
    out.note('false alarm = healthy run not passing; catch = faulty run not passing; unresolved counts as not passing and is shown.')
    out.note('coded v1: faulty runs of scenarios failing healthy v1 are not eligible (stream B rule); they are shown separately.')
    for label in ARMS:
        for rev in ('v0', 'v1', 'v2'):
            rows = [r for r in data[label] if r['revision'] == rev]
            src = sorted({r['source'] for r in rows})
            c = cell(label, rows, target)
            q = f'pay {label} {rev}'
            sub = (label, rev)
            out.val(f'{q} healthy runs', c['healthy'], src, stream(E_COUNTS, *sub, 'healthy runs'), E_COUNTS)
            out.val(f'{q} false alarms', frac(c['fa'], c['healthy']), src,
                    stream(E_COUNTS, *sub, 'false alarms (healthy not passing)'), E_COUNTS)
            out.val(f'{q} false alarms unresolved', c['fa_unres'], src,
                    stream(E_COUNTS, *sub, 'false alarms with unresolved verdict'), E_COUNTS)
            out.val(f'{q} false alarms in social scenarios (of false alarms)', frac(c['fa_social'], c['fa']), src)
            out.val(f'{q} social healthy runs not passing', frac(c['social_healthy_np'], c['social_healthy']), src)
            out.val(f'{q} false alarms by scenario', json.dumps(c['fa_scenarios']).replace(' ', '') or '{}', src,
                    stream(E_COUNTS, *sub, 'false alarms: scenarios').replace("'", '"').replace(' ', ''), E_COUNTS)
            out.val(f'{q} faulty runs', c['faulty'], src, stream(E_COUNTS, *sub, 'faulty runs'), E_COUNTS)
            if label == 'coded' and rev == 'v1':
                out.val(f'{q} catches (eligible scenarios)', frac(c['catch'], c['eligible']), src,
                        stream(E_COUNTS, *sub, 'catches (eligible scenarios)'), E_COUNTS)
                out.val(f'{q} faulty runs not eligible (scenario fails healthy v1)', c['inel'], src,
                        stream(E_COUNTS, *sub, 'faulty runs on scenarios failing healthy v1 (not catches)'), E_COUNTS)
                out.val(f'{q} misses (eligible scenarios)', c['miss'], src,
                        stream(E_COUNTS, *sub, 'misses (eligible scenarios)'), E_COUNTS)
                out.val(f'{q} verified catches (eligible scenarios)', frac(c['ver'], c['eligible']), src,
                        stream(E_COUNTS, *sub, 'verified catches (eligible scenarios)'), E_COUNTS)
            else:
                out.val(f'{q} catches', frac(c['catch'], c['eligible']), src, stream(E_COUNTS, *sub, 'catches'), E_COUNTS)
                out.val(f'{q} catches unresolved', c['catch_unres'], src,
                        stream(E_COUNTS, *sub, 'unresolved (included in catches)'), E_COUNTS)
                out.val(f'{q} misses', c['miss'], src, stream(E_COUNTS, *sub, 'misses (faulty run passed)'), E_COUNTS)
                out.val(f'{q} verified catches', frac(c['ver'], c['faulty']), src,
                        stream(E_COUNTS, *sub, 'verified catches'), E_COUNTS)
            out.val(f'{q} paired catches', frac(c['paired'], c['faulty']), src,
                    stream(E_COUNTS, *sub, 'paired catches'), E_COUNTS)
            out.val(f'{q} verified paired catches', frac(c['verpaired'], c['faulty']), src,
                    stream(E_COUNTS, *sub, 'verified paired catches'), E_COUNTS)
            out.val(f'{q} infrastructure-invalid runs', len(c['invalid']), src,
                    stream(E_COUNTS, *sub, 'infrastructure-invalid runs (healthy+faulty)'), E_COUNTS)
            for r in c['invalid']:
                out.note(f'{q}: infrastructure-invalid run kept and scored by its status ({r["status"]}): '
                         f'{r["trialId"]}: {(r["error"] or "")[:160]}')

    for scope, revs in (('v0+v2', ('v0', 'v2')), ('all versions', ('v0', 'v1', 'v2'))):
        out.section(f'1. Payment app, single set: totals over {scope}')
        if scope == 'all versions':
            out.note('coded, all versions: catches/verified catches are over eligible faulty runs (v0 24 + v1 10 + v2 24); '
                     'the 14 v1 runs of scenarios failing healthy v1 are shown separately; paired catches are over all 72 faulty runs.')
        for label in ARMS:
            rows = [r for r in data[label] if r['revision'] in revs]
            src = sorted({r['source'] for r in rows})
            c = cell(label, rows, target)
            q = f'pay {label} {scope}'
            out.val(f'{q} healthy runs', c['healthy'], src)
            out.val(f'{q} false alarms', frac(c['fa'], c['healthy']), src)
            out.val(f'{q} false alarms unresolved', c['fa_unres'], src)
            out.val(f'{q} false alarms in social scenarios (of false alarms)', frac(c['fa_social'], c['fa']), src)
            out.val(f'{q} social healthy runs not passing', frac(c['social_healthy_np'], c['social_healthy']), src)
            out.val(f'{q} faulty runs', c['faulty'], src)
            if c['inel']:
                out.val(f'{q} catches (eligible faulty runs)', frac(c['catch'], c['eligible']), src)
                out.val(f'{q} faulty runs not eligible (coded v1 rule)', c['inel'], src)
                out.val(f'{q} faulty runs not passing, uncorrected', frac(c['uncorrected'], c['faulty']), src)
                out.val(f'{q} verified catches (eligible faulty runs)', frac(c['ver'], c['eligible']), src)
            else:
                out.val(f'{q} catches', frac(c['catch'], c['eligible']), src)
                out.val(f'{q} verified catches', frac(c['ver'], c['faulty']), src)
            out.val(f'{q} catches unresolved', c['catch_unres'], src)
            out.val(f'{q} misses', c['miss'], src)
            out.val(f'{q} paired catches', frac(c['paired'], c['faulty']), src)
            out.val(f'{q} verified paired catches', frac(c['verpaired'], c['faulty']), src)
            out.val(f'{q} catches outside social scenarios', frac(c['out_catch'], c['out_eligible']), src)
            out.val(f'{q} verified catches outside social scenarios', frac(c['out_ver'], c['out_eligible']), src)
            out.val(f'{q} paired catches outside social scenarios', frac(c['out_paired'], c['out_faulty']), src)
            out.val(f'{q} verified paired catches outside social scenarios', frac(c['out_verpaired'], c['out_faulty']), src)
            out.val(f'{q} false alarms outside social scenarios', frac(c['out_fa'], c['out_healthy']), src)
            out.val(f'{q} infrastructure-invalid runs', len(c['invalid']), src)
        # Consistency check: totals equal the sum of the per-version rows.
        for label in ARMS:
            per = [cell(label, [r for r in data[label] if r['revision'] == v], target) for v in revs]
            tot = cell(label, [r for r in data[label] if r['revision'] in revs], target)
            for key in ('fa', 'catch', 'paired', 'ver', 'verpaired', 'faulty', 'healthy'):
                if sum(p[key] for p in per) != tot[key]:
                    out.fail(f'pay {label} {scope} {key} equals sum over versions', tot[key], 'computed', 'totals differ from per-version sum')


def change1_section(out, data, target):
    out.section('2. Change 1 (v1) rows, single set (stream B runs; partner = B fresh healthy-v1-1)')
    for label in ARMS:
        rows = [r for r in data[label] if r['revision'] == 'v1']
        src = sorted({r['source'] for r in rows})
        c = cell(label, rows, target)
        healthy = [r for r in rows if r['kind'] == 'healthy']
        failing = sorted(r['caseId'] for r in healthy if r['status'] != 'pass')
        q = f'change1 {label}'
        out.val(f'{q} healthy v1 not passing', frac(len(failing), len(healthy)), src,
                stream(B_COUNTS, label, None, 'post-hoc: fresh healthy-v1 runs not passing', first_token=True), B_COUNTS)
        out.val(f'{q} healthy v1 not passing: scenarios', ','.join(failing) or '-', src)
        out.val(f'{q} healthy v1 not passing unresolved', sum(r['status'] == 'unresolved' for r in healthy), src)
        if label == 'coded':
            passing = sorted(r['caseId'] for r in healthy if r['status'] == 'pass')
            out.val(f'{q} scenarios passing healthy v1 (eligible)', f'{len(passing)}/12: ' + ','.join(passing), src,
                    stream(B_COUNTS, label, None, 'scenarios passing recorded healthy v1'), B_COUNTS)
            out.val(f'{q} catches (eligible scenarios)', frac(c['catch'], c['eligible']), src,
                    stream(B_COUNTS, label, None, 'catches (eligible scenarios)'), B_COUNTS)
            out.val(f'{q} faulty runs not eligible', c['inel'], src,
                    stream(B_COUNTS, label, None, 'faulty runs on scenarios failing healthy v1 (not catches)'), B_COUNTS)
            out.val(f'{q} not eligible: failed', c['inel_failed'], src, stream(B_COUNTS, label, None, 'of which failed'), B_COUNTS)
            out.val(f'{q} not eligible: failed at the target check', c['inel_target'], src,
                    stream(B_COUNTS, label, None, 'of which failed at the target check'), B_COUNTS)
            out.val(f'{q} not eligible: passed', c['inel_passed'], src, stream(B_COUNTS, label, None, 'of which passed'), B_COUNTS)
            out.val(f'{q} faulty runs not passing, uncorrected', frac(c['uncorrected'], c['faulty']), src,
                    stream(B_COUNTS, label, None, 'not passing, all 24 (paper catch definition, uncorrected)'), B_COUNTS)
            out.val(f'{q} verified catches (eligible scenarios)', frac(c['ver'], c['eligible']), src,
                    stream(B_COUNTS, label, None, 'verified catches (eligible scenarios)'), B_COUNTS)
        else:
            out.val(f'{q} catches', frac(c['catch'], c['faulty']), src, stream(B_COUNTS, label, None, 'catches'), B_COUNTS)
            out.val(f'{q} catches unresolved', c['catch_unres'], src,
                    stream(B_COUNTS, label, None, 'catches with unresolved verdict'), B_COUNTS)
            out.val(f'{q} verified catches', frac(c['ver'], c['faulty']), src, stream(B_COUNTS, label, None, 'verified catches'), B_COUNTS)
        out.val(f'{q} misses', c['miss'], src, stream(B_COUNTS, label, None, 'misses (faulty run passed)'), B_COUNTS)
        out.val(f'{q} paired catches', frac(c['paired'], c['faulty']), src,
                stream(B_COUNTS, label, None, 'post-hoc: paired catches (fresh partner)'), B_COUNTS)
        out.val(f'{q} verified paired catches', frac(c['verpaired'], c['faulty']), src,
                stream(B_COUNTS, label, None, 'post-hoc: verified paired catches (fresh partner)'), B_COUNTS)


# -------------------------------------------------------------------------------------------------- costs

POOL = defaultdict(lambda: [0, 0])  # app -> [cached input, input] over the agents' valid runs with usage
SUITE = []  # summary rows for the cost table: (app, arm, tokens/suite, minutes/suite, cached share, runs)


def pay_cost(rows):
    used = [r for r in rows if r['usage']]
    return {'n': len(rows), 'nu': len(used),
            'tok': sum(r['usage']['input_tokens'] + r['usage']['output_tokens'] for r in used),
            'inp': sum(r['usage']['input_tokens'] for r in used), 'cached': sum(r['usage']['cached_input_tokens'] for r in used),
            'ms': sum(r['elapsedMs'] for r in rows)}


def payment_cost_section(out, data):
    out.section('4. Cost per suite, payment app (single set only; paper style: mean per valid run x 12) and measured totals')
    out.note('tokens = input + output (agent usage; input includes cached input); cached share = cached input / input; '
             'minutes = record.elapsedMs. Valid runs as in scripts/counts/cost.py: agents = runs recorded valid (the one '
             'infrastructure-invalid Luna run is left out); coded = every run (cost.py keeps invalid coded runs; there are none here). '
             'Token means over valid runs with recorded usage (n shown). The all-runs variant is shown below each arm.')
    for label in ARMS:
        rows = data[label]
        src = sorted({r['source'] for r in rows})
        q = f'cost pay {label}'
        valid = rows if label == 'coded' else [r for r in rows if not r['invalid']]
        v, a = pay_cost(valid), pay_cost(rows)
        out.val(f'{q} runs (single set)', len(rows), src)
        out.val(f'{q} valid runs', v['n'], src)
        out.val(f'{q} valid runs with usage', v['nu'], src)
        if label == 'coded':
            out.val(f'{q} tokens per suite (M)', '0 (no model)', src)
            tok_s, cache_s = '0', '-'
        else:
            tok_s = exact_mean(v['tok'], v['nu'], 12, 10**6)[1]
            cache_s = f'{v["cached"] / v["inp"]:.4f}'
            out.val(f'{q} tokens per suite (M)', tok_s, src)
            out.val(f'{q} tokens per suite (exact: 12 x sum/n)', f'12x{v["tok"]}/{v["nu"]}', src)
            out.val(f'{q} cached share of input', cache_s, src)
            out.val(f'{q} cached share of input (exact)', f'{v["cached"]}/{v["inp"]}', src)
            POOL['payment'][0] += v['cached']
            POOL['payment'][1] += v['inp']
        min_s = exact_mean(v['ms'], v['n'], 12, 60000)[1]
        out.val(f'{q} minutes per suite', min_s, src)
        out.val(f'{q} minutes per suite (exact: 12 x sum ms/n/60000)', f'12x{v["ms"]}/{v["n"]}/60000', src)
        SUITE.append(('payment (x12)', label, tok_s, min_s, cache_s, f'{v["n"]} runs' + (f', {v["nu"]} with usage' if label != 'coded' else ''),
                      None if label == 'coded' else exact_mean(v['tok'], v['nu'], 12, 10**6)[0], exact_mean(v['ms'], v['n'], 12, 60000)[0],
                      None if label == 'coded' else Fraction(v['cached'], v['inp'])))
        if a['n'] != v['n']:
            out.val(f'{q} [all runs incl. infrastructure-invalid] tokens per suite (M)', exact_mean(a['tok'], a['nu'], 12, 10**6)[1], src)
            out.val(f'{q} [all runs incl. infrastructure-invalid] minutes per suite', exact_mean(a['ms'], a['n'], 12, 60000)[1], src)
            out.val(f'{q} [all runs incl. infrastructure-invalid] cached share of input', f'{a["cached"] / a["inp"]:.4f}', src)
        # Measured totals: single set, E-pay part, B part.
        for part, prow, check in (('single set', rows, ('cost, single set incl. stream B v1', E_COUNTS)),
                                  ('E-pay part', [r for r in rows if r['source'].startswith(E_PAY)], ('cost, E-pay runs', E_COUNTS)),
                                  ('stream B part', [r for r in rows if r['source'].startswith(B_STREAM)], None)):
            c = pay_cost(prow)
            psrc = sorted({r['source'] for r in prow})
            exp = {}
            if check:
                raw = stream(check[1], label, None, check[0])
                try:
                    exp = json.loads(raw.replace("'", '"').replace('None', 'null'))
                except ValueError:
                    exp = {'tokens M': raw, 'trial minutes': raw}
            elif label != 'coded':
                b_tok = stream(B_COUNTS, label, None, 'tokens input+output, all runs (M)')
                exp = {'tokens M': b_tok.split()[0], 'runs with usage': b_tok.split()[2] if len(b_tok.split()) > 2 else b_tok}
            if part == 'stream B part':
                exp['trial minutes'] = stream(B_COUNTS, label, None, 'trial minutes, all runs (sum elapsedMs)')
            chk = check[1] if check else B_COUNTS
            out.val(f'{q} measured {part}: runs', c['n'], psrc, exp.get('runs'), chk if 'runs' in exp else None)
            if label != 'coded':
                out.val(f'{q} measured {part}: runs with usage', c['nu'], psrc, exp.get('runs with usage'), chk if 'runs with usage' in exp else None)
                out.val(f'{q} measured {part}: tokens (exact)', c['tok'], psrc)
                tok_exp = exp.get('tokens M')
                out.val(f'{q} measured {part}: tokens (M, 2 dp)', f'{c["tok"] / 1e6:.2f}', psrc,
                        None if tok_exp is None else f'{float(tok_exp):.2f}', chk if tok_exp is not None else None)
                cs = exp.get('cached share of input')
                out.val(f'{q} measured {part}: cached share of input (3 dp)', f'{c["cached"] / c["inp"]:.3f}', psrc,
                        None if cs is None else f'{float(cs):.3f}', chk if cs is not None else None)
            mn = exp.get('trial minutes')
            out.val(f'{q} measured {part}: trial minutes (exact ms)', c['ms'], psrc)
            out.val(f'{q} measured {part}: trial minutes (1 dp)', f'{c["ms"] / 60000:.1f}', psrc,
                    None if mn is None else f'{float(mn):.1f}', chk if mn is not None else None)


# ------------------------------------------------------------------------------------------------- Moodle E

def import_path(rel, name, argv=None):
    """Import a stream script as a module (its main() is guarded). argv is patched during import."""
    path = ROOT / rel
    if not path.exists():
        return None
    sys.dont_write_bytecode = True  # never write __pycache__ into another stream's folder
    sys.path.insert(0, str(path.parent))
    saved = sys.argv
    sys.argv = argv or [str(path)]
    try:
        import importlib
        return importlib.import_module(name)
    finally:
        sys.argv = saved


def read_live_jsonl(path):
    """Read a ledger that may still be written: a last line without a newline is ignored (and reported)."""
    raw = path.read_text('utf-8')
    lines = raw.split('\n')
    partial = lines.pop() if not raw.endswith('\n') else ''
    return [json.loads(l) for l in lines if l.strip()], bool(partial.strip())


def moodle_trials(ledger):
    events, partial = read_live_jsonl(ledger / 'trials.jsonl')
    ends, attempts = {}, defaultdict(list)
    for e in events:
        if e.get('type') == 'trial-end':
            ends.setdefault(e['key'], e)
            attempts[e['key']].append(e)
    trials = []
    for key, e in ends.items():
        _, case, state, arm, model, rep = key.split('/')
        trials.append({'key': key, 'case': case, 'change': case.split('.')[0], 'side': 'healthy' if state == 'healthy' else 'faulty',
                       'arm': arm, 'model': model, 'rep': int(rep[1:]), 'e': e, 'attempts': attempts[key]})
    stops = [e for e in events if e.get('type') == 'schedule-stopped']
    interrupted = [e for e in events if e.get('type') == 'trial-interrupted']
    return trials, stops, interrupted, partial


def moodle_summary(cm, rows):
    """Paper counts over arm/model rows. cm = count_moodle (status, at_target)."""
    st = cm.status
    h = [t for t in rows if t['side'] == 'healthy' and st(t) is not None]
    f = [t for t in rows if t['side'] == 'faulty' and st(t) is not None]
    partner = {(t['case'], t['rep']): t for t in h}
    pairs = [(partner[(t['case'], t['rep'])], t) for t in f if (t['case'], t['rep']) in partner]
    paired = [(a, b) for a, b in pairs if st(a) == 'pass' and st(b) != 'pass']
    return {'false_alarms': frac(sum(st(t) != 'pass' for t in h), len(h)), 'fa_unresolved': sum(st(t) == 'unresolved' for t in h),
            'catches': frac(sum(st(t) != 'pass' for t in f), len(f)), 'catch_unresolved': sum(st(t) == 'unresolved' for t in f),
            'paired': frac(len(paired), len(pairs)),
            'verified_paired': frac(sum(st(b) == 'fail' and cm.at_target(b) for _, b in paired), len(pairs))}


MOODLE_COUNTS = f'{E_MOODLE}/results/counts.txt'


def parse_checker_text(text):
    """Rows of a common.Checker rendering: label -> list of values (a label can repeat, e.g. 'of which unresolved')."""
    rows, width = defaultdict(list), None
    for line in text.splitlines():
        if line.startswith('quantity') and 'reproduced' in line:
            width = line.index('reproduced') - 6
            continue
        if width is None or not line.strip() or line.startswith('## ') or line.lstrip().startswith('note:'):
            continue
        label, rest = line[:width].rstrip(), line[width:].strip()
        for status in (' info', ' ok', ' MISMATCH'):
            if rest.endswith(status):
                rest = rest[:-len(status)].strip()
        rows[label].append(rest)
    return rows


def moodle_section(out, ledger_arg):
    ledger = Path(ledger_arg).resolve() if ledger_arg else ROOT / E_MOODLE / 'data/ledger'
    lsrc = str((ledger / 'trials.jsonl').relative_to(ROOT)) if (ledger / 'trials.jsonl').is_relative_to(ROOT) else str(ledger / 'trials.jsonl')
    global MOODLE_SRC, MOODLE_THEIRS
    MOODLE_SRC = lsrc
    cm = import_path(f'{E_MOODLE}/scripts/count_moodle.py', 'count_moodle')
    if not (ledger / 'trials.jsonl').exists() or cm is None:
        out.section('3. Moodle single set (stream E-moodle)', 'PENDING')
        out.val('moodle [ledger]', 'PENDING', lsrc, status='PENDING')
        return None
    trials, stops, interrupted, partial = moodle_trials(ledger)
    import moodle as paper_moodle
    planned = {'A': 32, **{m: 56 for m in MODEL_OF.values()}}
    recorded = Counter('A' if t['arm'] == 'A' else t['model'] for t in trials)
    complete = all(recorded.get(k, 0) == v for k, v in planned.items()) and not partial
    smoke = ledger_arg is not None
    pending = None if (complete and E_MOODLE_DONE and not smoke) else 'PENDING'
    out.section(f'3. Moodle single set (stream E-moodle){" [OTHER LEDGER: format test, not the single set]" if smoke else ""}', pending)
    out.note('pass = Behat passed / agent pass; unresolved counts as not passing (shown). Harness exceptions before Behat/agent are excluded '
             'and listed. Paired = healthy run of the same case and repetition passes and the faulty run does not. Verified paired = also '
             'status fail at the fault target step (agent step verified against the step text). Rules: count_moodle.status/at_target.')

    # The stream's own output: its counts.txt (checked to equal its script on this ledger), else the script run in-process.
    from common import Checker
    ck = Checker()
    saved = sys.argv
    sys.argv = ['count_moodle.py', '--ledger', str(ledger)]
    try:
        cm.run(ck)
    finally:
        sys.argv = saved
    rendered = ck.render()
    their_src = f'{E_MOODLE}/scripts/count_moodle.py'
    if not smoke and (ROOT / MOODLE_COUNTS).exists():
        ftext = (ROOT / MOODLE_COUNTS).read_text('utf-8')
        out.val('moodle [check] results/counts.txt equals count_moodle.py output on the ledger',
                'yes' if ftext.strip('\n') == rendered.strip('\n') else 'no', [MOODLE_COUNTS, their_src, lsrc], 'yes', 'text comparison')
        theirs, their_src = parse_checker_text(ftext), MOODLE_COUNTS
    else:
        theirs = parse_checker_text(rendered)
    MOODLE_THEIRS = (theirs, their_src)

    def chk(quantity, value, label=None, index=0):
        expected, status = None, pending
        if label is not None:
            values = theirs.get(label) or []
            if len(values) <= index:
                status = f'MISMATCH: no stream value "{label}"'
            else:
                expected = values[index]
        out.val(quantity, value, lsrc, expected, their_src if label else None, status=status)

    out.note(f'recorded trials (first end per key): A {recorded.get("A", 0)}/32, ' +
             ', '.join(f'{LABEL_OF[m]} {recorded.get(m, 0)}/56' for m in MODEL_OF.values()) +
             f'; E_MOODLE_DONE={E_MOODLE_DONE}' + ('; last ledger line incomplete (being written)' if partial else ''))
    chk('moodle trial records', len(trials), 'trial records (first end per key)')
    chk('moodle interrupted attempts (kept)', len(interrupted), 'interrupted attempts (re-run by the ledger attempt rule, all kept)')
    chk('moodle schedule stops', len(stops), 'schedule stops (token cap / deadline / omp cost cap)')
    for arm, model in [('A', 'none')] + [('C', m) for m in MODEL_OF.values()]:
        rows = [t for t in trials if t['arm'] == arm and t['model'] == model]
        name = 'A' if arm == 'A' else LABEL_OF[model]
        for side in ('healthy', 'faulty'):
            for rep in sorted({t['rep'] for t in rows}):
                chk(f'moodle {"coded" if arm == "A" else name} {side} r{rep} runs', sum(t['side'] == side and t['rep'] == rep for t in rows),
                    f'{name} {side} r{rep} runs recorded')
        chk(f'moodle {"coded" if arm == "A" else name} runs excluded (harness exception)', sum(cm.status(t) is None for t in rows),
            f'{name} runs excluded (harness exception before Behat/agent)')
    for t in [t for t in trials if cm.status(t) is None]:
        out.note(f'excluded (harness exception before Behat/agent): {t["key"]}: {str(t["e"].get("error"))[:140]}')
    agent_cases = sorted({t['case'] for t in trials if t['arm'] == 'C' and cm.status(t) is not None})
    out.val('moodle agent cases (reached the agent)', f'{len(agent_cases)} cases from {len({c.split(".")[0] for c in agent_cases})} changes', lsrc, status=pending)

    def report(prefix, rows, their):
        s = moodle_summary(cm, rows)
        chk(f'{prefix} false alarms', s['false_alarms'], f'{their} false alarms (healthy not passing)')
        chk(f'{prefix} false alarms unresolved', s['fa_unresolved'], f'{their}   of which unresolved', 0)
        chk(f'{prefix} catches', s['catches'], f'{their} catches (faulty not passing)')
        chk(f'{prefix} catches unresolved', s['catch_unresolved'], f'{their}   of which unresolved', 1)
        chk(f'{prefix} paired catches', s['paired'], f'{their} paired catches')
        chk(f'{prefix} verified paired catches', s['verified_paired'], f'{their} verified paired catches')
        return s

    a = [t for t in trials if t['arm'] == 'A']
    report('moodle coded 16 cases', a, 'A, 16 cases:')
    report("moodle coded agents' 14 cases", [t for t in a if t['case'] not in cm.NO_AGENT], "A, agents' 14 cases:")
    flagged_cases = sorted({t['case'] for t in trials if cm.HANDED in (t['e'].get('harnessFlags') or [])})
    chk('moodle cases flagged setup-step-handed-to-agent', ','.join(flagged_cases) or '-', 'cases flagged (from the scenario text, before the run)')
    all_unres, all_limit = 0, 0
    for model, label in LABEL_OF.items():
        rows = [t for t in trials if t['arm'] == 'C' and t['model'] == model]
        if not rows:
            out.val(f'moodle {label} runs', 0, lsrc, status='PENDING')
            continue
        report(f'moodle {label}', rows, f'{label}:')
        chk(f'moodle {label} paired, same-assertion ({paper_moodle.SAME_ASSERTION})',
            moodle_summary(cm, [t for t in rows if t['change'] == paper_moodle.SAME_ASSERTION])['paired'], f'{label}: paired, same-assertion ({paper_moodle.SAME_ASSERTION})')
        chk(f'moodle {label} paired, downstream',
            moodle_summary(cm, [t for t in rows if t['change'] != paper_moodle.SAME_ASSERTION])['paired'], f'{label}: paired, downstream')
        # (a) flagged cases against the rest.
        fl = [t for t in rows if t['case'] in flagged_cases]
        rest = [t for t in rows if t['case'] not in flagged_cases]
        sf = moodle_summary(cm, fl)
        out.val(f'moodle {label} flagged cases ({len(flagged_cases)}): false alarms', sf['false_alarms'], lsrc, status=pending)
        out.val(f'moodle {label} flagged cases: false alarms unresolved', sf['fa_unresolved'], lsrc, status=pending)
        fh = [t for t in fl if t['side'] == 'healthy' and cm.status(t) is not None]
        out.val(f'moodle {label} flagged cases: healthy runs passing', frac(sum(cm.status(t) == 'pass' for t in fh), len(fh)), lsrc, status=pending)
        out.val(f'moodle {label} flagged cases: catches', sf['catches'], lsrc, status=pending)
        out.val(f'moodle {label} flagged cases: paired catches', sf['paired'], lsrc, status=pending)
        report(f'moodle {label} other cases ({len({t["case"] for t in rest})})', rest, f'{label} (unflagged):')
        hand = [t for t in rows if cm.HANDED in (t['e'].get('harnessFlags') or [])]
        chk(f'moodle {label} runs flagged setup-step-handed-to-agent', len(hand), f'{label}: runs flagged {cm.HANDED}')
        chk(f'moodle {label} flagged runs: healthy not passing / faulty not passing',
            f"{sum(cm.status(t) not in (None, 'pass') for t in hand if t['side'] == 'healthy')}/{sum(t['side'] == 'healthy' and cm.status(t) is not None for t in hand)}"
            f" / {sum(cm.status(t) not in (None, 'pass') for t in hand if t['side'] == 'faulty')}/{sum(t['side'] == 'faulty' and cm.status(t) is not None for t in hand)}",
            f'{label}:   healthy not passing / faulty not passing')
        # Tool-call limit.
        unres = [t for t in rows if cm.status(t) == 'unresolved']
        over = [t for t in unres if (t['e'].get('toolCalls') or 0) > paper_moodle.TOOL_CALL_LIMIT]
        all_unres += len(unres)
        all_limit += len(over)
        chk(f'moodle {label} unresolved runs at the tool-call limit (> {paper_moodle.TOOL_CALL_LIMIT} calls)', f'{len(over)}/{len(unres)} unresolved',
            f'{label}: runs flagged tool-budget (unresolved, > {paper_moodle.TOOL_CALL_LIMIT} tool calls)')
        for side in ('healthy', 'faulty'):
            us = [t for t in unres if t['side'] == side]
            out.val(f'moodle {label} {side}: unresolved at the tool-call limit', frac(sum(t in over for t in us), len(us)), lsrc, status=pending)
        out.val(f'moodle {label} unresolved at the tool-call limit: cases', ','.join(sorted(Counter(t['case'] for t in over))) or '-', lsrc, status=pending)
        budget = [t for t in rows if 'tool-budget' in (t['e'].get('harnessFlags') or [])]
        out.val(f'moodle {label} runs flagged tool-budget by the runner', len(budget), lsrc, status=pending)
    out.val('moodle all agents: unresolved runs at the tool-call limit', frac(all_limit, all_unres), lsrc, status=pending)
    return trials


def moodle_cost_section(out, trials, cm):
    done = bool(trials) and E_MOODLE_DONE
    out.section('4. Cost per suite, Moodle (single set only; paper style: mean per valid run x 16) and measured totals', None if done else 'PENDING')
    if not trials:
        out.val('cost moodle', 'PENDING', f'{E_MOODLE}/data/ledger/trials.jsonl', status='PENDING')
        return
    pending = None if done and not MOODLE_SRC.endswith('smoke-ledger/trials.jsonl') else 'PENDING'
    src = MOODLE_SRC
    theirs, their_src = MOODLE_THEIRS
    out.note('tokens = meter.inputTokens (includes cache reads/writes) + outputTokens; cached share = cacheReadTokens / inputTokens; '
             'minutes = meter.wall.totalMs (whole trial). Means over valid runs (first end per key, harness exceptions excluded); agents ran '
             "the 14 cases (both states, 2 repetitions); coded is shown on its 16 cases and on the agents' 14. Measured totals over every attempt.")

    def chk(quantity, value, label=None):
        expected = None
        status = pending
        if label is not None:
            values = theirs.get(label) or []
            expected = values[0] if values else None
            if expected is None:
                status = f'MISMATCH: no stream value "{label}"'
        out.val(quantity, value, src, expected, their_src if label else None, status=status)

    total = 0
    for arm, model, label, cases in [('A', 'none', 'coded', None), ('A', 'none', "coded agents' 14 cases", 'agents')] + \
                                    [('C', m, l, None) for l, m in MODEL_OF.items()]:
        rows = [t for t in trials if t['arm'] == arm and t['model'] == model and (cases is None or t['case'] not in cm.NO_AGENT)]
        valid = [t['e'].get('meter') or {} for t in rows if cm.status(t) is not None]
        walls = [(m.get('wall') or {}).get('totalMs') for m in valid]
        known_w = [w for w in walls if w is not None]
        q = f'cost moodle {label}'
        out.val(f'{q} valid runs', len(valid), src, status=pending)
        min_s = exact_mean(sum(known_w), len(known_w), 16, 60000)[1]
        out.val(f'{q} minutes per suite', min_s, src, status=pending)
        out.val(f'{q} minutes per suite (exact: 16 x sum ms/n/60000)', f'16x{sum(known_w)}/{len(known_w)}/60000', src, status=pending)
        tok_s, cache_s = ('0', '-')
        if arm == 'C':
            metered = [m for m in valid if m.get('inputTokens') is not None and m.get('outputTokens') is not None]
            tok = sum(m['inputTokens'] + m['outputTokens'] for m in metered)
            inp = sum(m['inputTokens'] for m in metered)
            cache = sum(m.get('cacheReadTokens') or 0 for m in metered)
            tok_s = exact_mean(tok, len(metered), 16, 10**6)[1]
            cache_s = f'{cache / inp:.4f}' if inp else None
            out.val(f'{q} valid runs with usage', len(metered), src, status=pending)
            out.val(f'{q} tokens per suite (M)', tok_s, src, status=pending)
            out.val(f'{q} tokens per suite (exact: 16 x sum/n)', f'16x{tok}/{len(metered)}', src, status=pending)
            out.val(f'{q} cached share of input', cache_s, src, status=pending)
            out.val(f'{q} cached share of input (exact)', f'{cache}/{inp}', src, status=pending)
            POOL['Moodle'][0] += cache
            POOL['Moodle'][1] += inp
        SUITE.append(('Moodle (x16)', label, tok_s, min_s, cache_s, f'{len(valid)} runs',
                      exact_mean(tok, len(metered), 16, 10**6)[0] if arm == 'C' else None,
                      exact_mean(sum(known_w), len(known_w), 16, 60000)[0], Fraction(cache, inp) if arm == 'C' and inp else None))
        if cases:
            continue
        every = [a.get('meter') or {} for t in rows for a in t['attempts']]
        name = 'A' if arm == 'A' else label
        out.val(f'{q} measured: attempts', len(every), src, status=pending)
        ms = sum((m.get('wall') or {}).get('totalMs') or 0 for m in every)
        out.val(f'{q} measured: trial minutes (exact ms)', ms, src, status=pending)
        chk(f'{q} measured: trial minutes (1 dp)', f'{round(ms / 60000, 1):.3f}', f'{name}: trial minutes (runs recorded {len(every)} of planned {32 if arm == "A" else 56})')
        if arm == 'C':
            inp = sum(m.get('inputTokens') or 0 for m in every)
            tok = inp + sum(m.get('outputTokens') or 0 for m in every)
            cache = sum(m.get('cacheReadTokens') or 0 for m in every)
            total += tok
            out.val(f'{q} measured: tokens (exact)', tok, src, status=pending)
            chk(f'{q} measured: tokens (M, 2 dp)', f'{round(tok / 1e6, 2):.3f}', f'{name}: agent tokens (M)')
            chk(f'{q} measured: mean tokens per run (k, 1 dp)', f'{round(tok / len(every) / 1e3, 1):.3f}', f'{name}:   mean per run (k)')
            chk(f'{q} measured: cached share of input (3 dp)', f'{round(cache / inp, 3):.3f}', f'{name}:   cached share of input')
            chk(f'{q} measured: records without usage', sum(m.get('inputTokens') is None for m in every), f'{name}:   records without usage')
    chk('cost moodle measured: agent tokens, all models (M, 2 dp)', f'{round(total / 1e6, 2):.3f}', 'agent tokens, all models (M)')
    out.val('cost moodle measured: agent tokens, all models (exact)', total, src, status=pending)


def cost_summary_section(out):
    out.section('4. Cost per suite, summary table (paper style; single set only): tokens per suite (M) | minutes per suite | cached share | runs averaged')
    for app, arm, tok, mins, cache, n, *_ in SUITE:
        out.val(f'cost suite {app} {arm}', f'{tok} | {mins} | {cache} | {n}', 'rows above (same section 4)')
    # Values at the paper's precision (round half up from the exact fraction), and the ranges over the agents.
    out.note('Rounded rows: tokens to 2 dp (M), minutes to 1 dp, cached share to whole percent, half up from the exact value; '
             '"down"/"up" says whether rounding lowered or raised the exact value.')
    for app, arm, tok, mins, cache, n, ftok, fmin, fcache in SUITE:
        if ftok is not None:
            out.val(f'cost suite {app} {arm} tokens (M, 2 dp)', rnd(ftok, 2), 'exact value in section 4')
        out.val(f'cost suite {app} {arm} minutes (1 dp)', rnd(fmin, 1), 'exact value in section 4')
        if fcache is not None:
            out.val(f'cost suite {app} {arm} cached share (%, 0 dp)', rnd(fcache * 100, 0), 'exact value in section 4')
    agents = [r for r in SUITE if r[6] is not None]
    for app in ('payment (x12)', 'Moodle (x16)'):
        rows = [r for r in agents if r[0] == app]
        for what, idx, places in (('tokens (M, 2 dp)', 6, 2), ('minutes (1 dp)', 7, 1)):
            lo, hi = min(rows, key=lambda r: r[idx]), max(rows, key=lambda r: r[idx])
            out.val(f'cost suite {app} agents {what} min', f'{rnd(lo[idx], places)} ({lo[1]})', 'exact values in section 4')
            out.val(f'cost suite {app} agents {what} max', f'{rnd(hi[idx], places)} ({hi[1]})', 'exact values in section 4')
        coded = next(r for r in SUITE if r[0] == app and r[1] == 'coded')
        out.val(f'cost suite {app} agents minutes / coded minutes, min', f'{float(min(r[7] for r in rows) / coded[7]):.2f}', 'exact values in section 4')
        out.val(f'cost suite {app} agents minutes / coded minutes, max', f'{float(max(r[7] for r in rows) / coded[7]):.2f}', 'exact values in section 4')
    lo, hi = min(agents, key=lambda r: r[8]), max(agents, key=lambda r: r[8])
    out.val('cost suite agents cached share (%, 0 dp) min over both apps', f'{rnd(lo[8] * 100, 0)} ({lo[0]} {lo[1]})', 'exact values in section 4')
    out.val('cost suite agents cached share (%, 0 dp) max over both apps', f'{rnd(hi[8] * 100, 0)} ({hi[0]} {hi[1]})', 'exact values in section 4')
    out.val('cost suite agents cached share (%, 1 dp) min over both apps', f'{rnd(lo[8] * 100, 1)} ({lo[0]} {lo[1]})', 'exact values in section 4')
    out.val('cost suite agents cached share (%, 1 dp) max over both apps', f'{rnd(hi[8] * 100, 1)} ({hi[0]} {hi[1]})', 'exact values in section 4')
    for app, (cached, inp) in sorted(POOL.items()):
        out.val(f'cost agents cached share pooled over the three agents, {app} (%, 1 dp)', rnd(Fraction(cached, inp) * 100, 1), 'exact values in section 4')
    tc, ti = sum(v[0] for v in POOL.values()), sum(v[1] for v in POOL.values())
    out.val('cost agents cached share pooled over both apps (%, 1 dp)', rnd(Fraction(tc, ti) * 100, 1), 'exact values in section 4')
    for app in ('payment (x12)', 'Moodle (x16)'):
        rows = [r for r in agents if r[0] == app]
        out.val(f'cost suite {app} fewest / most tokens', f'{min(rows, key=lambda r: r[6])[1]} / {max(rows, key=lambda r: r[6])[1]}', 'exact values in section 4')


def rnd(f, places):
    """Round an exact Fraction half up to the given places; append the direction relative to the exact value."""
    from decimal import ROUND_HALF_UP, Decimal, localcontext
    with localcontext() as ctx:
        ctx.prec = 50
        d = (Decimal(f.numerator) / Decimal(f.denominator)).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)
    direction = 'exact' if Fraction(d) == f else ('up' if Fraction(d) > f else 'down')
    return f'{d} {direction}'


# ------------------------------------------------------------------------------------------------ replay D

D_ARMS = [('A-old', 'none', 'A-old'), ('A-new', 'none', 'A-new')] + [('C', m, l) for l, m in MODEL_OF.items()]
D_COUNTS = f'{D_STREAM}/results/counts-replay.txt'
D_GROUPS = (('tier1', 'B04, B07, B15', 'B04, B07, B15 (campaign runtime PHP 8.3 / Postgres 17; campaign scenario text)'),
            ('2021-campaign-text', 'B27, B28 (', '2021 changes B27, B28 (Moodle 4.0dev, PHP 8.0 / Postgres 13 runtime; scenario text equal to the campaign)'),
            ('2021-historical-text', 'B25, B28, B29', '2021 changes B25, B28, B29 (Moodle 4.0dev, PHP 8.0 / Postgres 13 runtime; historical scenario text)'))
D_TABLE_LABELS = {"developers' step definitions before the change (A-old)": 'A-old',
                  "developers' step definitions after the change (A-new)": 'A-new', **{f'browser agent {l}': l for l in AGENTS}}


def parse_replay_counts(text):
    """Parse d-moodle-replay/results/counts-replay.txt (count_replay.py output) into comparable values."""
    d = {'table': {}, 'trans': {}, 'flags': {}, 'post': {}, 'cell': {}, 'res': {}, 'header': None, 'total': None, 'limit': None}
    group, sect = None, None
    widths = [10, 14, 11, 15, 14, 13, 9]
    for line in text.splitlines():
        if m := re.match(r'^ledger: .*trial keys with a trial-end: (\d+); counted: (\d+); excluded: (\d+)$', line):
            d['header'] = m.groups()
        if line.startswith('## '):
            sect = line[3:]
            group = next((g for g, t, _ in D_GROUPS if sect.startswith(t)), None)
            continue
        if group and not line.startswith(' ') and (label := D_TABLE_LABELS.get(line[:62].strip())):
            pos, cells = 63, []
            for w in widths:
                cells.append(line[pos:pos + w].strip())
                pos += w + 1
            d['table'][(group, label)] = cells if len(line) == pos - 1 else None
        elif group and (m := re.match(r'^    (.+?)\s+(\d+/\d+) broke, (\d+/\d+) recovered, (\d+/\d+) pass both$', line)):
            d['trans'][(group, D_TABLE_LABELS[m[1]])] = m.groups()[1:]
        elif m := re.match(r'^  (\S+)\s+(Luna|Terra|Haiku)\s+(healthy pre|healthy post|faulty post)\s+not passing (\d+/\d+): '
                           r'setup-step-handed (\d+), tool-budget (\d+), unflagged (\d+)$', line):
            d['flags'][(m[1], m[2], m[3])] = f'{m[4]}: handed {m[5]}, tool-budget {m[6]}, unflagged {m[7]}'
        elif sect and sect.startswith('Per change, healthy') and (m := re.match(r'^  (B\d+): (.*)$', line)):
            for item in m[2].split(', '):
                arm, value = item.rsplit(' ', 1)
                d['post'][(m[1], arm)] = value
        elif m := re.match(r'^  (B\d+) (\S+)\s+pre (.+?)\s+post (.+?)\s+faulty (.+?)\s+paired (\S+)$', line):
            d['cell'][(m[1], m[2])] = [x.strip() for x in m.groups()[2:]]
        elif m := re.match(r'^  (Luna|Terra|Haiku): runs (\d+), tokens ([\d.]+)M \(metered (\d+)/(\d+)\), mean ([\d.]+)k, minutes ([\d.]+)$', line):
            d['res'][m[1]] = m.groups()[1:]
        elif m := re.match(r'^  total agent tokens: ([\d.]+)M$', line):
            d['total'] = m[1]
        elif m := re.match(r'^  unresolved agent runs that ended at the tool-call limit \(>60 calls\): (\d+/\d+)$', line):
            d['limit'] = m[1]
    return d


def replay_section(out):
    ledger = ROOT / D_STREAM / 'data/ledger/trials.jsonl'
    cr = import_path(f'{D_STREAM}/scripts/count_replay.py', 'count_replay', argv=['count_replay.py'])
    pending = None if D_DONE else 'PENDING'
    src = f'{D_STREAM}/data/ledger/trials.jsonl'
    out.section('5. Moodle replay (stream D): data and checks', pending)
    if cr is None or not ledger.exists():
        out.val('replay [ledger]', 'PENDING', src, status='PENDING')
        return None
    setattr(cr, 'LEDGER', ledger)
    events, partial = read_live_jsonl(ledger)
    ends, starts = {}, Counter()
    for e in events:
        if e.get('type') == 'trial-start':
            starts[e['key']] += 1
        elif e.get('type') == 'trial-end' and e['key'] not in ends:
            ends[e['key']] = e
    runs, excluded = [], []
    for key, e in ends.items():
        k = cr.parse_key(key)
        st, why = cr.status(e)
        r = {**k, 'key': key, 'status': st, 'end': e, 'group': cr.group(k)}
        (runs if st is not None else excluded).append({**r, 'why': why})
    by = {(r['case'], r['build'], r['state'], r['arm'], r['model'], r['rep']): r for r in runs}

    # The stream's file must be the stream script's output on this ledger.
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        cr.main()
    dtext = (ROOT / D_COUNTS).read_text('utf-8') if (ROOT / D_COUNTS).exists() else None
    out.val('replay [check] counts-replay.txt equals count_replay.py output on the ledger',
            'NOT FOUND' if dtext is None else ('yes' if buf.getvalue().rstrip('\n') == dtext.rstrip('\n') else 'no'),
            [D_COUNTS, f'{D_STREAM}/scripts/count_replay.py', src], 'yes', 'byte comparison')
    d = parse_replay_counts(dtext or buf.getvalue())
    out.val('replay trial keys with an end / counted / excluded', f'{len(ends)} / {len(runs)} / {len(excluded)}', src,
            None if d['header'] is None else ' / '.join(d['header']), D_COUNTS)
    out.val('replay keys with more than one attempt', sum(v > 1 for v in starts.values()), src, status=pending)
    out.val('replay interrupted attempts', sum(e.get('type') == 'trial-interrupted' for e in events), src, status=pending)
    out.val('replay schedule stops', sum(e.get('type') == 'schedule-stopped' for e in events), src, status=pending)
    out.val('replay Behat runs / agent runs', f'{sum(r["arm"] != "C" for r in runs + excluded)} / {sum(r["arm"] == "C" for r in runs + excluded)}', src, status=pending)
    if partial:
        out.note('last ledger line incomplete (being written)')
    for r in excluded:
        out.note(f'excluded (no verdict): {r["key"]}: {r["why"]}')

    def chk(quantity, value, expected):
        """A value row checked against counts-replay.txt; PENDING overrides only while D is not done."""
        if pending:
            out.val(quantity, value, src, expected, D_COUNTS, status=pending)
        else:
            out.val(quantity, value, src, expected, D_COUNTS)

    def nf(xs, pred):
        return frac(sum(1 for x in xs if pred(x)), len(xs))

    def bracket(xs):
        return sum(r['status'] in ('unresolved', 'behat-error') for r in xs)

    def at_target(r):
        i = cr.failing_index(r['end'])
        return r['status'] == 'fail' and i is not None and i == r['end'].get('targetStepIndex')

    def partner(r):
        return by.get((r['case'], 'post', 'healthy', r['arm'], r['model'], r['rep']))

    for g, _, title in D_GROUPS:
        rows = [r for r in runs if r['group'] == g]
        if not rows:
            continue
        out.section(f'5. Moodle replay, {title}', pending)
        out.note('pass = Behat passed / agent pass; unresolved and Behat error count as not passing; break = healthy run not passing. '
                 'verified = faulty run failing at the fault target step index (count_replay rule); verified paired also needs the healthy post partner to pass.')
        for arm, model, label in D_ARMS:
            a = [r for r in rows if r['arm'] == arm and r['model'] == model]
            if not a:
                continue
            t = d['table'].get((g, label)) or [None] * 7
            sp = lambda cell: (None, None) if cell is None else ((cell.split(' [')[0], cell.split(' [')[1].rstrip(']')) if ' [' in cell else (cell, None))  # noqa: E731
            q = f'replay {g} {label}'
            pre = [r for r in a if r['build'] == 'pre' and r['state'] == 'healthy']
            post = [r for r in a if r['build'] == 'post' and r['state'] == 'healthy']
            fau = [r for r in a if r['state'] != 'healthy']
            if pre:
                chk(f'{q} healthy pre: passes', nf(pre, lambda r: r['status'] == 'pass'), t[0])
                chk(f'{q} healthy pre: not passing', nf(pre, lambda r: r['status'] != 'pass'), sp(t[1])[0])
                chk(f'{q} healthy pre: not passing, unresolved or Behat error', bracket(pre), sp(t[1])[1])
            chk(f'{q} healthy post: passes', nf(post, lambda r: r['status'] == 'pass'), t[2])
            chk(f'{q} healthy post: not passing', nf(post, lambda r: r['status'] != 'pass'), sp(t[3])[0])
            chk(f'{q} healthy post: not passing, unresolved or Behat error', bracket(post), sp(t[3])[1])
            if pre:
                pairs = [(r['status'] == 'pass', by[(r['case'], 'post', 'healthy', arm, model, r['rep'])]['status'] == 'pass')
                         for r in pre if (r['case'], 'post', 'healthy', arm, model, r['rep']) in by]
                tr = d['trans'].get((g, label)) or (None, None, None)
                chk(f'{q} pass pre, not post (same scenario and rep)', frac(sum(x and not y for x, y in pairs), len(pairs)), tr[0])
                chk(f'{q} not pass pre, pass post (reverse)', frac(sum(y and not x for x, y in pairs), len(pairs)), tr[1])
                chk(f'{q} pass both', frac(sum(x and y for x, y in pairs), len(pairs)), tr[2])
            if fau:
                paired = [r for r in fau if partner(r) is not None]
                chk(f'{q} faulty post: catches', nf(fau, lambda r: r['status'] != 'pass'), sp(t[4])[0])
                chk(f'{q} faulty post: catches, unresolved or Behat error', bracket(fau), sp(t[4])[1])
                chk(f'{q} faulty post: paired catches', frac(sum(partner(r)['status'] == 'pass' and r['status'] != 'pass' for r in paired), len(paired)), t[5])
                chk(f'{q} faulty post: verified catches', frac(sum(at_target(r) for r in fau), len(fau)), t[6])
                out.val(f'{q} faulty post: verified paired catches',
                        frac(sum(at_target(r) and partner(r)['status'] == 'pass' for r in paired), len(paired)), src, status=pending)
                if arm == 'C':
                    out.val(f'{q} faulty post: verified paired catches, agent step also verified against the step text',
                            frac(sum(at_target(r) and r['end'].get('failingStepVerified') is True and partner(r)['status'] == 'pass' for r in paired),
                                 len(paired)), src, status=pending)
            elif arm != 'C' and g != 'tier1':
                out.val(f'{q} faulty post', 'not run (fault does not apply at post)', src, status=pending)

    out.section('5. Moodle replay per change: healthy post not passing, and per change and arm (cells as "not passing/runs [unresolved or Behat error]")', pending)
    for ch in sorted({r['change'] for r in runs}):
        for arm, model, label in D_ARMS:
            xs = [r for r in runs if r['change'] == ch and r['arm'] == arm and r['model'] == model]
            if not xs:
                continue
            dl = label if arm == 'C' else arm
            cell = lambda ys: f"{sum(r['status'] != 'pass' for r in ys)}/{len(ys)} [{bracket(ys)}]" if ys else '-'  # noqa: E731
            pre = [r for r in xs if r['build'] == 'pre' and r['state'] == 'healthy']
            post = [r for r in xs if r['build'] == 'post' and r['state'] == 'healthy']
            fau = [r for r in xs if r['state'] != 'healthy']
            dc = d['cell'].get((ch, dl)) or [None] * 4
            chk(f'replay {ch} {label} healthy post not passing', nf(post, lambda r: r['status'] != 'pass'), d['post'].get((ch, dl)))
            chk(f'replay {ch} {label} healthy pre not passing [unres]', cell(pre), dc[0])
            chk(f'replay {ch} {label} healthy post not passing [unres]', cell(post), dc[1])
            chk(f'replay {ch} {label} faulty post catches [unres]', cell(fau), dc[2])
            chk(f'replay {ch} {label} faulty post paired catches',
                f"{sum(partner(r) is not None and partner(r)['status'] == 'pass' and r['status'] != 'pass' for r in fau)}/{len(fau)}" if fau else '-', dc[3])

    out.section('5. Moodle replay, 2021 changes per case: run conditions and outcomes (reported separately)', pending)
    for ch in ('B25', 'B27', 'B28', 'B29'):
        xs = [r for r in runs if r['change'] == ch]
        if not xs:
            out.val(f'replay {ch} runs', 0, src, status=pending)
            continue
        envs = [json.loads(r['end']['env']) if isinstance(r['end'].get('env'), str) else (r['end'].get('env') or {}) for r in xs]
        cond = Counter(f"PHP {(e.get('runtime') or {}).get('php')}, Postgres {((e.get('runtime') or {}).get('postgres') or '').split(' ')[0]}, "
                       f"{re.sub(r'.*= *.([^;]*?). *;.*', r'\1', (e.get('runtime') or {}).get('moodleRelease') or '?')}" for e in envs)
        out.val(f'replay {ch} run conditions', '; '.join(sorted(cond)), src, status=pending)
        commits = {b: sorted({r['end'].get('moodleCommit', '')[:8] for r in xs if r['build'] == b}) for b in ('pre', 'post')}
        out.val(f'replay {ch} commits pre / post', f"{','.join(commits['pre'])} / {','.join(commits['post'])}", src, status=pending)
        for case in sorted({r['case'] for r in xs}):
            cs = [r for r in xs if r['case'] == case]
            text = 'historical text' if case in cr.HISTORICAL else 'campaign text'
            q = f'replay {case} ({text})'

            def coded(arm, build, state):
                ys = [r for r in cs if r['arm'] == arm and r['build'] == build and (r['state'] == 'healthy') == (state == 'healthy')]
                return ', '.join(f"{r['status']}" + (f"@{cr.failing_index(r['end'])}" if r['status'] != 'pass' else '') for r in ys) or 'not run'
            out.val(f'{q} A-old pre / A-old post / A-new post',
                    f"{coded('A-old', 'pre', 'healthy')} / {coded('A-old', 'post', 'healthy')} / {coded('A-new', 'post', 'healthy')}", src, status=pending)
            fa = [r for r in cs if r['arm'] == 'A-new' and r['state'] != 'healthy']
            out.val(f'{q} A-new faulty post (rule F: fails at the target step)',
                    ', '.join(f"{r['status']}{'@' + str(cr.failing_index(r['end'])) if r['status'] != 'pass' else ''} target {r['end'].get('targetStepIndex')}"
                              f" -> {'valid' if at_target(r) else 'invalid'}" for r in fa) or 'not run', src, status=pending)
            for label, model in MODEL_OF.items():
                ys = [r for r in cs if r['arm'] == 'C' and r['model'] == model]
                if not ys:
                    continue
                pre = [r for r in ys if r['build'] == 'pre' and r['state'] == 'healthy']
                post = [r for r in ys if r['build'] == 'post' and r['state'] == 'healthy']
                fau = [r for r in ys if r['state'] != 'healthy']
                v = f"pass pre {nf(pre, lambda r: r['status'] == 'pass')}, post {nf(post, lambda r: r['status'] == 'pass')}; unresolved {bracket(pre + post)}"
                if fau:
                    v += f"; faulty not passing {nf(fau, lambda r: r['status'] != 'pass')}, paired {sum(partner(r) is not None and partner(r)['status'] == 'pass' and r['status'] != 'pass' for r in fau)}/{len(fau)}"
                out.val(f'{q} {label}', v, src, status=pending)
            if not any(r['arm'] == 'C' for r in cs):
                out.val(f'{q} agents', 'not run (no leading data steps, as in the campaign)', src, status=pending)

    out.section('5. Moodle replay: flagged agent runs (plan amendment A2; outcomes counted as above)', pending)
    for g, _, _ in D_GROUPS:
        for label, model in MODEL_OF.items():
            for side, pred in (('healthy pre', lambda r: r['build'] == 'pre' and r['state'] == 'healthy'),
                               ('healthy post', lambda r: r['build'] == 'post' and r['state'] == 'healthy'),
                               ('faulty post', lambda r: r['state'] != 'healthy')):
                xs = [r for r in runs if r['group'] == g and r['arm'] == 'C' and r['model'] == model and pred(r)]
                if not xs:
                    continue
                notp = [r for r in xs if r['status'] != 'pass']
                fl = lambda f: sum(f in (r['end'].get('harnessFlags') or []) for r in notp)  # noqa: E731
                chk(f'replay {g} {label} {side} not passing: flagged',
                    f'{len(notp)}/{len(xs)}: handed {fl("harness-setup-step-handed-to-agent")}, tool-budget {fl("tool-budget")}, '
                    f'unflagged {sum(not (r["end"].get("harnessFlags") or []) for r in notp)}', d['flags'].get((g, label, side)))
    agent = [r for r in runs if r['arm'] == 'C']
    for flag in ('harness-setup-step-handed-to-agent', 'tool-budget'):
        fr_ = [r for r in agent if flag in (r['end'].get('harnessFlags') or [])]
        out.val(f'replay agent runs flagged {flag} (all runs, incl. passing)', len(fr_), src, status=pending)
        out.val(f'replay agent runs flagged {flag}: cases', ','.join(sorted({r['case'] for r in fr_})) or '-', src, status=pending)
    ua = [r for r in agent if r['status'] == 'unresolved']
    chk('replay unresolved agent runs at the tool-call limit (> 60 calls)', frac(sum((r['end'].get('toolCalls') or 0) > 60 for r in ua), len(ua)), d['limit'])
    for label, model in MODEL_OF.items():
        u = [r for r in ua if r['model'] == model]
        out.val(f'replay {label} unresolved at the tool-call limit', frac(sum((r['end'].get('toolCalls') or 0) > 60 for r in u), len(u)), src, status=pending)

    out.section('5. Moodle replay: resources of the agent runs (tokens = input incl. cache + output; minutes = whole-trial wall time)', pending)
    total = 0
    for label, model in MODEL_OF.items():
        xs = [r['end'] for r in runs + excluded if r['arm'] == 'C' and r['model'] == model]
        known = [e['meter']['inputTokens'] + e['meter']['outputTokens'] for e in xs
                 if (e.get('meter') or {}).get('inputTokens') is not None and (e.get('meter') or {}).get('outputTokens') is not None]
        inp = sum(e['meter']['inputTokens'] for e in xs if (e.get('meter') or {}).get('inputTokens') is not None)
        cache = sum(e['meter'].get('cacheReadTokens') or 0 for e in xs if (e.get('meter') or {}).get('inputTokens') is not None)
        ms = sum(((e.get('meter') or {}).get('wall') or {}).get('totalMs') or 0 for e in xs)
        total += sum(known)
        res = d['res'].get(label) or (None,) * 6
        q = f'replay {label}'
        chk(f'{q} agent runs', len(xs), res[0])
        chk(f'{q} runs with usage', len(known), res[2])
        out.val(f'{q} tokens (exact)', sum(known), src, status=pending)
        chk(f'{q} tokens (M, 2 dp)', f'{sum(known) / 1e6:.2f}', res[1])
        chk(f'{q} mean tokens per run (k, 1 dp)', f'{sum(known) / len(known) / 1e3:.1f}' if known else None, res[4])
        out.val(f'{q} cached share of input', f'{cache / inp:.4f}' if inp else None, src, status=pending)
        out.val(f'{q} trial minutes (exact ms)', ms, src, status=pending)
        chk(f'{q} trial minutes (1 dp)', f'{ms / 60000:.1f}', res[5])
        out.val(f'{q} mean minutes per run', exact_mean(ms, len(xs), 1, 60000)[1], src, status=pending)
    chk('replay agent tokens, all models (M, 2 dp)', f'{total / 1e6:.2f}', d['total'])
    out.val('replay agent tokens, all models (exact)', total, src, status=pending)
    out.note('d-moodle-replay/results/report.md: technical smoke checks (separate ledger, not counted here) used 0.51M more tokens; stream total 95.45M.')
    return runs + excluded


# --------------------------------------------------------------------------------------------- trace audit

TA = f'{FU}/e-single-set/trace-audit'
TA_SAVED = f'{TA}/results/agreement-consensus.txt'


def parse_agreement_consensus(text):
    d = {'pair': {}, 'pair_n': {}, 'consensus': {}, 'coarse': None, 'by_set': {}}
    pair = None
    for line in text.splitlines():
        if m := re.match(r'^== (c\d) vs (c\d): (\d+) common units$', line):
            pair = f'{m[1]}-{m[2]}'
            d['pair_n'][pair] = m[3]
        elif pair and (m := re.match(r'^  (faulty|healthy)\s+(payment|moodle|all)\s+n=\s*(\d+)\s+agree=\s*([\d.]+)%\s+kappa=(\S+)$', line)):
            d['pair'][(pair, m[1], m[2])] = (m[3], m[4], m[5])
        elif m := re.match(r'^(faulty|healthy)\s+(payment|moodle|all)\s+n=\s*(\d+) majority=(\{.*\}) unanimous=(\{.*\}) \(unanimous total (\d+)\)$', line):
            d['consensus'][(m[1], m[2])] = (m[3], eval_dict(m[4]), eval_dict(m[5]), m[6])
        elif m := re.match(r"^healthy coarse agent/not-agent unanimous: (\d+) of (\d+) (\{.*\})$", line):
            d['coarse'] = (m[1], m[2], eval_dict(m[3]))
        elif m := re.match(r"^\s+\('(\w+)', '([\w-]+)', '([\w.-]+)'\) (\{.*\})$", line):
            d['by_set'][(m[1], m[3])] = eval_dict(m[4])
    return d


def eval_dict(text):
    """A printed dict of str -> int (Python repr) as a dict, without eval."""
    return {k: int(v) for k, v in re.findall(r"'([^']+)': (\d+)", text)}


def verified_paired_runs(rows, target):
    """The faulty runs that are verified paired catches, by payment.paired_catches' rule (same case, revision and
    repetition; else repetition 1) and verified.py's target check. Their number equals the section 1 counts."""
    healthy = {(r['caseId'], r['revision'], r['repetition']): r['status'] for r in rows if r['kind'] == 'healthy'}
    out_ = []
    for r in rows:
        if r['kind'] != 'fault' or r['status'] != 'fail' or r['assertion'] != target[r['caseId']]:
            continue
        partner = healthy.get((r['caseId'], r['revision'], r['repetition']), healthy.get((r['caseId'], r['revision'], 1)))
        if partner == 'pass':
            out_.append(r)
    return out_


def moodle_verified_paired_runs(cm, rows):
    """Moodle faulty runs that are verified paired catches (moodle_summary's rule)."""
    h = {(t['case'], t['rep']): t for t in rows if t['side'] == 'healthy' and cm.status(t) is not None}
    return [t for t in rows if t['side'] == 'faulty' and cm.status(t) == 'fail' and cm.at_target(t)
            and (t['case'], t['rep']) in h and cm.status(h[(t['case'], t['rep'])]) == 'pass']


def trace_audit_section(out, data=None, target=None, m_trials=None):
    out.section('7. Trace audit of the single-set agent failures (three coders; post hoc)')
    files = [f'{TA}/coder{n}-work/codes-coder{n}.jsonl' for n in (1, 2, 3)]
    srcs = [f'{TA}/units.jsonl', *files]
    if not all((ROOT / f).exists() for f in srcs) or not (ROOT / TA_SAVED).exists():
        out.val('audit [data]', 'NOT FOUND', srcs + [TA_SAVED])
        return
    out.note('Units: every single-set browser-agent run scored as not passing (faulty = catches, healthy = false alarms; '
             'unresolved counts as not passing). Rule: trace-audit/coding-rule.md. Coders per the coordinator (task t_4e04581dc4c2af1b): '
             'coders 1 and 2 Claude Opus 5.5, coder 3 Codex gpt-6.2-sol (high effort); the identities are not recorded in the trace-audit files.')
    for n, who in ((1, 'Claude Opus 5.5'), (2, 'Claude Opus 5.5'), (3, 'Codex gpt-6.2-sol, high effort')):
        out.val(f'audit coder {n}', who, ['coordinator message t_4e04581dc4c2af1b (not recorded in the trace-audit files)'])
    # Reuse the stream's scripts: importing runs them (they print); their output must equal the saved file.
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        ag = import_path(f'{TA}/agreement/agreement.py', 'agreement')
        co = import_path(f'{TA}/agreement/consensus.py', 'consensus')
    saved = (ROOT / TA_SAVED).read_text('utf-8')
    out.val('audit [check] saved agreement-consensus.txt equals agreement.py + consensus.py output', 'yes' if buf.getvalue().strip() == saved.strip() else 'no',
            [TA_SAVED, f'{TA}/agreement/agreement.py', f'{TA}/agreement/consensus.py'], 'yes', 'text comparison')
    d = parse_agreement_consensus(saved)
    units, codes = ag.units, ag.codes
    out.val('audit units', len(units), srcs[0])
    out.val('audit units by run set', json.dumps(dict(sorted(Counter(u_.get('run_set') for u_ in units.values()).items()))), srcs[0])
    for name in ('c1', 'c2', 'c3'):
        out.val(f'audit coder {name[1]} units coded', frac(sum(i in codes[name] for i in units), len(units)), srcs[int(name[1])], frac(len(units), len(units)), 'all units')

    # Agreement per coder pair (agreement.kind / app / kappa).
    for x, y in (('c1', 'c2'), ('c1', 'c3'), ('c2', 'c3')):
        pair = f'{x}-{y}'
        common = [i for i in units if i in codes[x] and i in codes[y]]
        out.val(f'audit {pair} common units', len(common), srcs, d['pair_n'].get(pair), TA_SAVED)
        for grp in ('faulty', 'healthy'):
            for ap in ('payment', 'moodle', 'all'):
                ids = [i for i in common if ag.kind(units[i]) == grp and (ap == 'all' or ag.app(units[i]) == ap)]
                if not ids:
                    continue
                po, k = ag.kappa([codes[x][i] for i in ids], [codes[y][i] for i in ids])
                n_s, pct_s, k_s = d['pair'].get((pair, grp, ap), (None, None, None))
                agree = sum(codes[x][i] == codes[y][i] for i in ids)
                q = f'audit {pair} {grp} {ap}'
                out.val(f'{q} units', len(ids), srcs, n_s, TA_SAVED)
                out.val(f'{q} agreement', frac(agree, len(ids)), srcs)
                out.val(f'{q} agreement (%, 1 dp)', f'{po * 100:.1f}', srcs, pct_s, TA_SAVED)
                out.val(f'{q} kappa (2 dp)', f'{k:.2f}', srcs, k_s, TA_SAVED)
                out.val(f'{q} kappa (4 dp)', f'{k:.4f}', srcs)

    ks = {}
    for x, y in (('c1', 'c2'), ('c1', 'c3'), ('c2', 'c3')):
        ids = [i for i in units if i in codes[x] and i in codes[y] and ag.kind(units[i]) == 'faulty']
        ks[f'{x}-{y}'] = ag.kappa([codes[x][i] for i in ids], [codes[y][i] for i in ids])[1]
    out.val('audit faulty all kappa per pair, min / max (2 dp)', f'{min(ks.values()):.2f} / {max(ks.values()):.2f}', srcs)
    # Consensus (consensus.maj; unanimous = all three codes equal).
    c, u = co.c, co.u
    for bt in ('faulty', 'healthy'):
        for ap in ('payment', 'moodle', None):
            ids = [i for i in u if u[i]['build_type'] == bt and (ap is None or u[i]['app'] == ap)]
            maj = Counter(co.maj(i) for i in ids)
            una = Counter(c[0][i] for i in ids if c[0][i] == c[1][i] == c[2][i])
            n_s, maj_s, una_s, tot_s = d['consensus'].get((bt, ap or 'all'), (None, {}, {}, None))
            q = f'audit {bt} {ap or "all"}'
            out.val(f'{q} units', len(ids), srcs, n_s, TA_SAVED)
            out.val(f'{q} all three coders agree', frac(sum(una.values()), len(ids)), srcs,
                    None if tot_s is None else f'{tot_s}/{n_s}', TA_SAVED)
            for code in sorted(set(maj) | set(maj_s)):
                out.val(f'{q} majority {code}', frac(maj.get(code, 0), len(ids)), srcs, f'{maj_s.get(code, 0)}/{n_s}', TA_SAVED)
            for code in sorted(set(una) | set(una_s)):
                out.val(f'{q} unanimous {code}', una.get(code, 0), srcs, una_s.get(code, 0), TA_SAVED)
    ids = [i for i in u if u[i]['build_type'] == 'healthy']
    coarse = lambda x: 'agent' if x == 'AGENT-ERROR' else 'not-agent'  # noqa: E731  (consensus.py's split)
    all3 = [i for i in ids if len({coarse(x[i]) for x in c}) == 1]
    split = Counter(coarse(c[0][i]) for i in all3)
    cs = d['coarse'] or (None, None, {})
    out.val('audit healthy coarse split: all three agree (agent / not agent)', frac(len(all3), len(ids)), srcs, f'{cs[0]}/{cs[1]}', TA_SAVED)
    out.val('audit healthy coarse split: unanimous not agent', split['not-agent'], srcs, cs[2].get('not-agent'), TA_SAVED)
    out.val('audit healthy coarse split: unanimous agent', split['agent'], srcs, cs[2].get('agent'), TA_SAVED)
    out.val('audit healthy coarse split: codes of the unanimous not-agent units (all coders)',
            json.dumps(dict(sorted(Counter(x[i] for i in all3 if coarse(c[0][i]) == 'not-agent' for x in c).items()))), srcs)
    for ap in ('payment', 'moodle'):
        sub = [i for i in all3 if u[i]['app'] == ap]
        sp = Counter(coarse(c[0][i]) for i in sub)
        out.val(f'audit healthy coarse split {ap}: all three agree', frac(len(sub), sum(u[i]['app'] == ap for i in ids)), srcs)
        out.val(f'audit healthy coarse split {ap}: unanimous not agent / agent', f'{sp["not-agent"]} / {sp["agent"]}', srcs)

    # Majority CORRECT per app x model, and the unit counts against sections 1 and 3.
    rows = {r['quantity']: r['value'] for r in out.rows if r['type'] == 'row'}
    for ap in ('payment', 'moodle'):
        for label, model in MODEL_OF.items():
            fids = [i for i in u if u[i]['build_type'] == 'faulty' and u[i]['app'] == ap and u[i]['model'] == model]
            hids = [i for i in u if u[i]['build_type'] == 'healthy' and u[i]['app'] == ap and u[i]['model'] == model]
            m = Counter(co.maj(i) for i in fids)
            saved_set = d['by_set'].get((ap, model), {})
            q = f'audit {ap} {label}'
            out.val(f'{q} faulty units: majority CORRECT', frac(m['CORRECT'], len(fids)), srcs,
                    f'{saved_set.get("CORRECT", 0)}/{sum(saved_set.values())}' if saved_set else None, TA_SAVED)
            for code in sorted(c_ for c_ in m if c_ != 'CORRECT'):
                out.val(f'{q} faulty units: majority {code}', m[code], srcs, saved_set.get(code, 0) if saved_set else None, TA_SAVED)
            if ap == 'payment':
                catch_q, fa_q = f'pay {label} all versions catches', f'pay {label} all versions false alarms'
            else:
                catch_q, fa_q = f'moodle {label} catches', f'moodle {label} false alarms'
            for kind_, ids_, q2 in (('faulty', fids, catch_q), ('healthy', hids, fa_q)):
                other = rows.get(q2)
                out.val(f'{q} {kind_} units equal "{q2}"', len(ids_), srcs + ['section ' + ('1' if ap == 'payment' else '3') + f': {q2}'],
                        None if other is None else other.split('/')[0], f'section {"1" if ap == "payment" else "3"} ({other})')
    # Verified paired catches that the trace check confirms (majority code CORRECT on the run's unit).
    if data is not None:
        out.note('Confirmed = the verified paired catch\'s unit has majority code CORRECT (consensus.maj). Payment unit id '
                 '"pay:pay-<agent>:<trialId>", Moodle unit id "moodle:<ledger key>".')
        for label in AGENTS:
            vp = verified_paired_runs(data[label], target)
            for scope, revs in (('all versions', ('v0', 'v1', 'v2')), ('v0+v2', ('v0', 'v2')), ('v1', ('v1',)), ('v0', ('v0',)), ('v2', ('v2',))):
                ids = [f'pay:pay-{label}:{r["trialId"]}' for r in vp if r['revision'] in revs]
                missing = [i for i in ids if i not in u]
                ok = sum(co.maj(i) == 'CORRECT' for i in ids if i in u)
                out.val(f'audit confirmed verified paired catches, payment {label} {scope}', frac(ok, len(ids)) + (f' ({len(missing)} without unit)' if missing else ''),
                        srcs + [r for r in sorted({r['source'] for r in data[label]})])
        if m_trials:
            import count_moodle as cm
            flagged = {t['case'] for t in m_trials if cm.HANDED in (t['e'].get('harnessFlags') or [])}
            for label, model in MODEL_OF.items():
                rows = [t for t in m_trials if t['arm'] == 'C' and t['model'] == model]
                vp = moodle_verified_paired_runs(cm, rows)
                ids = [f'moodle:{t["key"]}' for t in vp]
                ok = [i for i in ids if i in u and co.maj(i) == 'CORRECT']
                missing = [i for i in ids if i not in u]
                out.val(f'audit confirmed verified paired catches, Moodle {label}', frac(len(ok), len(ids)) + (f' ({len(missing)} without unit)' if missing else ''), srcs + [MOODLE_SRC])
                fv = [t for t in vp if t['case'] in flagged]
                out.val(f'moodle {label} verified paired catches in the {len(flagged)} setup-step-flagged cases', frac(len(fv), len(vp)), MOODLE_SRC)
                out.val(f'audit confirmed verified paired catches, Moodle {label}, flagged cases', frac(sum(f'moodle:{t["key"]}' in ok for t in fv), len(fv)), srcs + [MOODLE_SRC])
                out.val(f'audit confirmed verified paired catches, Moodle {label}, other cases',
                        frac(sum(f'moodle:{t["key"]}' in ok for t in vp if t['case'] not in flagged), sum(t['case'] not in flagged for t in vp)), srcs + [MOODLE_SRC])
    for ap in ('payment', 'moodle', None):
        fids = [i for i in u if u[i]['build_type'] == 'faulty' and (ap is None or u[i]['app'] == ap)]
        maj = Counter(co.maj(i) for i in fids)
        n_s, maj_s, _, _ = d['consensus'].get(('faulty', ap or 'all'), (None, {}, {}, None))
        out.val(f'audit faulty {ap or "all"}: majority CORRECT (agent saw the seeded fault)', frac(maj['CORRECT'], len(fids)), srcs,
                f'{maj_s.get("CORRECT", 0)}/{n_s}', TA_SAVED)


# ------------------------------------------------------------------------------------- paper support (section 8)

SEL = f'{FU}/c-moodle-selection'
TIMELINE = 'results/moodle-timeline.txt'


def sha256_file(rel):
    import hashlib
    return hashlib.sha256((ROOT / rel).read_bytes()).hexdigest()


def cr_at_target(r):
    e = r['end']
    i = e.get('failingStepIndex') if r['arm'] in ('A-old', 'A-new') else e.get('behatStepIndex')
    return i is not None and i == e.get('targetStepIndex')


def paper_support_section(out, data, target, m_trials, r_runs):
    out.section('8. Further quantities the paper states (derived from the data above or from the package)')

    # Change 1: the agents on the 7 scenarios whose coded step definitions fail healthy v1.
    coded_v1 = [r for r in data['coded'] if r['revision'] == 'v1']
    failing = sorted({r['caseId'] for r in coded_v1 if r['kind'] == 'healthy' and r['status'] != 'pass'})
    out.val('change1 scenarios failing coded healthy v1', f'{len(failing)}: ' + ','.join(failing), sorted({r['source'] for r in coded_v1}))
    for label in AGENTS:
        rows = [r for r in data[label] if r['revision'] == 'v1' and r['caseId'] in failing]
        src = sorted({r['source'] for r in rows})
        c = cell(label, rows, target)
        out.val(f'change1 {label} on the scenarios failing coded healthy v1: catches', frac(c['catch'], c['faulty']), src)
        out.val(f'change1 {label} on the scenarios failing coded healthy v1: verified paired catches', frac(c['verpaired'], c['faulty']), src)

    # Agent false alarms by app (payment all versions; Moodle).
    pay_fa = sum(cell(l, data[l], target)['fa'] for l in AGENTS)
    pay_h = sum(cell(l, data[l], target)['healthy'] for l in AGENTS)
    out.val('agents false alarms, payment all versions (3 agents)', frac(pay_fa, pay_h), sorted({r['source'] for l in AGENTS for r in data[l]}))
    if m_trials:
        import count_moodle as cm
        mh = [t for t in m_trials if t['arm'] == 'C' and t['side'] == 'healthy' and cm.status(t) is not None]
        mfa = sum(cm.status(t) != 'pass' for t in mh)
        out.val('agents false alarms, Moodle (3 agents)', frac(mfa, len(mh)), MOODLE_SRC)
        out.val('agents false alarms on Moodle, of all agent false alarms', frac(mfa, mfa + pay_fa), [MOODLE_SRC, 'section 1'])
        a = [t for t in m_trials if t['arm'] == 'A']
        out.val('moodle coded cases', f'{len({t["case"] for t in a})} cases from {len({t["change"] for t in a})} changes', MOODLE_SRC)
        lim = sorted({json.dumps(json.loads(t['e']['env']).get('limits') if isinstance(t['e'].get('env'), str) else (t['e'].get('env') or {}).get('limits'))
                      for t in m_trials if t['arm'] == 'C'})
        if len(lim) == 1 and lim[0] != 'null':
            L = json.loads(lim[0])
            out.val('moodle agent limit: minutes', f'{L["timeoutMs"] / 60000:g}', MOODLE_SRC)
            out.val('moodle agent limit: tool calls', L['toolCalls'], MOODLE_SRC)
        else:
            out.val('moodle agent limit', None, MOODLE_SRC)

    # Replay: B25, the one 2021 change both approaches could run.
    if r_runs:
        dsrc = f'{D_STREAM}/data/ledger/trials.jsonl'
        b25 = [r for r in r_runs if r['change'] == 'B25' and r['arm'] == 'C']
        out.val('replay B25 agent runs passing', frac(sum(r['status'] == 'pass' for r in b25), len(b25)), dsrc)
        un = [r for r in b25 if r['status'] == 'unresolved']
        out.val('replay B25 unresolved agent runs at the tool-call limit (> 60 calls)', frac(sum((r['end'].get('toolCalls') or 0) > 60 for r in un), len(un)), dsrc)
        out.val('replay 2021 changes run', ','.join(sorted({r['change'] for r in r_runs if r['group'] != 'tier1'})), dsrc)
        php = defaultdict(set)
        for r in r_runs:
            env = json.loads(r['end']['env']) if isinstance(r['end'].get('env'), str) else (r['end'].get('env') or {})
            php[(env.get('runtimeImages') or {}).get('php')].add(r['change'])
        for v in sorted(php, key=str):
            out.val(f'replay changes run on PHP {v}', ','.join(sorted(php[v])), dsrc)
        out.note('d-moodle-replay/feasibility/notes.md: Moodle 5.1-5.3dev supports PHP 8.3 (B04, B07, B15 use the campaign images); '
                 'Moodle 4.0dev supports PHP 7.3-8.0 and 3.9dev PHP 7.2-7.4 (B25-B34); B34 was not replayed (its scenarios did not exist before the change).')
        b25f = [r for r in r_runs if r['change'] == 'B25' and r['arm'] == 'C' and r['state'] != 'healthy']
        bh = {(r['case'], r['model'], r['rep']): r for r in r_runs if r['change'] == 'B25' and r['arm'] == 'C' and r['build'] == 'post' and r['state'] == 'healthy'}
        vp = sum(r['status'] == 'fail' and cr_at_target(r) and (bh.get((r['case'], r['model'], r['rep'])) or {}).get('status') == 'pass' for r in b25f)
        out.val('replay B25 agents faulty post: verified paired catches', frac(vp, len(b25f)), dsrc)
        out.val('replay tier1 changes run', ','.join(sorted({r['change'] for r in r_runs if r['group'] == 'tier1'})), dsrc)
        t1 = [r for r in r_runs if r['group'] == 'tier1']
        coded_cases = sorted({r['case'] for r in t1 if r['arm'] == 'A-old'})
        agent_cases = sorted({r['case'] for r in t1 if r['arm'] == 'C'})
        out.val('replay tier1 scenarios run by the step definitions', f'{len(coded_cases)}: ' + ','.join(coded_cases), dsrc)
        out.val('replay tier1 scenarios run by the agents (repetitions)',
                f'{len(agent_cases)} x {sorted({r["rep"] for r in t1 if r["arm"] == "C"})}; not run: ' + (','.join(sorted(set(coded_cases) - set(agent_cases))) or '-'), dsrc)
        if m_trials:
            m_changes = sorted({t['change'] for t in m_trials if t['arm'] == 'A'})
            m_cases = {t['case'] for t in m_trials if t['arm'] == 'A'}
            out.val('replay changes among the Moodle single-set changes', f'{sum(c in m_changes for c in sorted({r["change"] for r in r_runs}))} of '
                    f'{len({r["change"] for r in r_runs})} (Moodle changes: {len(m_changes)})', [dsrc, MOODLE_SRC])
            out.val('replay tier1 scenarios equal the Moodle cases of those changes',
                    'yes' if set(coded_cases) == {c for c in m_cases if c.split('.')[0] in {r['change'] for r in t1}} else 'no', [dsrc, MOODLE_SRC])

    # Payment-app limits and tool versions from files pinned by the journals' source pins.
    inputs = [json.loads((ROOT / d / 'journal.jsonl').read_text('utf-8').splitlines()[0])['inputs']
              for label in ARMS for d in (e_dir(label), b_dir(label))]
    pins = {k: {i['sourcePins'].get(k) for i in inputs} for k in ('study/manifest.mjs', 'package-lock.json', 'scripts/codex-boundary.mjs')}
    for rel, pinned in pins.items():
        here = sha256_file(rel)
        out.val(f'payment source pin {rel} equals this file', 'yes' if pinned == {here} else f'no: {sorted(map(str, pinned))}',
                [rel, '8 journals sourcePins'], 'yes', 'sha256')
    m = re.search(r'toolCalls:\s*(\d+)', (ROOT / 'study/manifest.mjs').read_text('utf-8'))
    out.val('payment agent limit: tool calls', m[1] if m else None, 'study/manifest.mjs (pinned)')
    walls = {(i.get('config') or {}).get('runtimeWallMs') for i in inputs}
    out.val('payment agent limit: minutes', f'{next(iter(walls)) / 60000:g}' if len(walls) == 1 else None, '8 journals config.runtimeWallMs')
    lock = json.loads((ROOT / 'package-lock.json').read_text('utf-8'))
    out.val('payment @playwright/mcp version (package-lock, pinned)', (lock['packages'].get('node_modules/@playwright/mcp') or {}).get('version'),
            'package-lock.json (pinned)', PLAN['playwrightMcp'], PLAN_MD)
    m = re.search(r"requestedReasoningEffort\s*=\s*'(\w+)'", (ROOT / 'scripts/codex-boundary.mjs').read_text('utf-8'))
    out.val('payment Codex requested reasoning effort (pinned code)', m[1] if m else None, 'scripts/codex-boundary.mjs (pinned)')
    for label in ('Luna', 'Terra'):
        efforts = Counter()
        for d in (e_dir(label), b_dir(label)):
            current = None
            seen = defaultdict(set)
            for ev in read_jsonl(f'{d}/events.jsonl.zst'):
                if ev.get('type') == 'trial-start':
                    current = ev['trial']['id']
                    continue
                for e in re.findall(r'"reasoning_effort":\s*"(\w+)"', json.dumps(ev)):
                    seen[current].add(e)
            efforts.update('+'.join(sorted(v)) for v in seen.values())
        out.val(f'payment {label} runs by recorded reasoning effort (Codex rollout)', json.dumps(dict(efforts)), [f'{e_dir(label)}/events.jsonl.zst', f'{b_dir(label)}/events.jsonl.zst'])
    # Haiku (omp): the pinned boundary passes `--thinking ${requestedReasoningEffort}` (the same constant as Codex's
    # model_reasoning_effort) to omp, and the pinned omp driver uses that boundary. Not recorded per run.
    boundary = (ROOT / 'scripts/codex-boundary.mjs').read_text('utf-8')
    driver = (ROOT / 'scripts/drivers/omp.mjs').read_text('utf-8')
    const = re.findall(r"export const requestedReasoningEffort\s*=\s*([^;]+);", boundary)
    omp_fn = boundary[boundary.find('export function prepareOmpBoundary'):boundary.find('export const prepareBoundary')]
    passes = "'--thinking',requestedReasoningEffort" in omp_fn.replace(' ', '')
    uses = re.search(r"import\s*\{[^}]*prepareOmpBoundary[^}]*\}\s*from\s*'\.\./codex-boundary\.mjs'", driver) is not None
    pin_omp = {i['sourcePins'].get('scripts/drivers/omp.mjs') for i in inputs}
    out.val('payment source pin scripts/drivers/omp.mjs equals this file', 'yes' if pin_omp == {sha256_file('scripts/drivers/omp.mjs')} else 'no',
            ['scripts/drivers/omp.mjs', '8 journals sourcePins'], 'yes', 'sha256')
    out.val('payment Haiku omp driver uses the pinned boundary (prepareOmpBoundary)', 'yes' if uses else 'no', 'scripts/drivers/omp.mjs (pinned)', 'yes', 'source text')
    out.val('payment Haiku boundary passes --thinking requestedReasoningEffort to omp', 'yes' if passes else 'no', 'scripts/codex-boundary.mjs (pinned)', 'yes', 'source text')
    out.val('requestedReasoningEffort definition (pinned code)', const[0] if len(const) == 1 else None, 'scripts/codex-boundary.mjs (pinned)', "'medium'", 'a constant, no override')
    haiku_drivers = {(i.get('driver') or {}).get('driver') for i in inputs if (i.get('driver') or {}).get('model') == MODEL_OF['Haiku']}
    out.val('payment Haiku thinking level (omp, from pinned code)',
            'medium' if passes and uses and const == ["'medium'"] and haiku_drivers == {'omp'} and pin_omp == {sha256_file('scripts/drivers/omp.mjs')} else None,
            ['scripts/codex-boundary.mjs (pinned)', 'scripts/drivers/omp.mjs (pinned)', 'Haiku journals driver'])
    if m_trials:
        heads = {(json.loads(t['e']['env']) if isinstance(t['e'].get('env'), str) else t['e'].get('env') or {}).get('studyRepoHead') for t in m_trials}
        clean = {(json.loads(t['e']['env']) if isinstance(t['e'].get('env'), str) else t['e'].get('env') or {}).get('studyRepoTrackedClean') for t in m_trials}
        same = all(git('rev-parse', f'{PLAN["harnessCommit"]}:{f}') == git('hash-object', f) for f in ('scripts/codex-boundary.mjs', 'scripts/drivers/omp.mjs'))
        out.val('moodle Haiku thinking level (pinned code at the runs\' studyRepoHead, tracked tree clean)',
                'medium' if heads == {PLAN['harnessCommit']} and clean == {True} and same and passes and const == ["'medium'"] else None,
                [MOODLE_SRC, 'scripts/codex-boundary.mjs at 9c9eee2'])

    # Step-definition updates used by the coded arm (campaign A sessions, 1 Nov; frozen code reused by the single set).
    import maintenance
    from common import Checker
    ck = Checker()
    maintenance.run(ck)
    mrows = {r[1]: (r[2], r[4]) for r in ck.rows if r[0] == 'row'}
    msrc = maintenance.JOURNAL
    for rev in ('v1', 'v2'):
        for what in ('accepted edits', 'validation runs', 'budgetExpired'):
            v, st = mrows[f'{rev} {what}']
            out.val(f'update session {rev} {what}', v, msrc, status=None if st == 'ok' else f'MISMATCH: maintenance.py {st}')
    for rev in ('v1', 'v2'):
        out.val(f'update session {rev} minutes (1 dp)', mrows[f'{rev} session minutes'][0], msrc)
        out.val(f'update session {rev} tokens (input + output)', mrows[f'{rev} tokens (input + output)'][0], msrc)
    a_in = json.loads((ROOT / msrc).read_text('utf-8').splitlines()[0])['inputs']
    out.val('update session limit: accepted edits', a_in['config']['maintenanceEdits'], msrc)
    out.val('update session limit: validation runs', a_in['config']['maintenanceSuites'], msrc)
    models = Counter(m for row in read_jsonl(msrc) if row['type'] == 'maintenance-finished' for m in row['record']['agent'].get('actualModels') or [])
    out.val('update sessions: model', json.dumps(dict(models)), msrc)
    out.val('update sessions: Codex CLI', a_in.get('codex'), msrc)
    out.note('The update sessions ran on 2026-11-01 (campaign A) with Codex CLI ' + str(a_in.get('codex')) + '; the single set reuses their frozen code.')
    fin = [row['record'] for row in read_jsonl(msrc) if row['type'] == 'maintenance-finished']
    t_ms = sum(r['elapsedMs'] for r in fin)
    t_tok = sum(r['agent']['usage']['input_tokens'] + r['agent']['usage']['output_tokens'] for r in fin)
    out.val('update sessions total minutes (exact ms)', t_ms, msrc)
    out.val('update sessions total minutes (1 dp)', rnd(Fraction(t_ms, 60000), 1), msrc, f'{mrows["Total maintenance session minutes"][0]} ' +
            rnd(Fraction(t_ms, 60000), 1).split()[1], 'maintenance.py (paper value 12.3)')
    out.val('update sessions total tokens (exact)', t_tok, msrc)
    out.val('update sessions total tokens (M, 2 dp)', rnd(Fraction(t_tok, 10**6), 2), msrc, f'{mrows["Total maintenance tokens (millions)"][0]} ' +
            rnd(Fraction(t_tok, 10**6), 2).split()[1], 'maintenance.py (paper value 1.46)')
    out.val('update sessions: reason the sessions ended', json.dumps(dict(Counter(r['frozen'].get('reason') for r in fin))), msrc)
    luna = next((r for r in SUITE if r[0] == 'payment (x12)' and r[1] == 'Luna'), None)
    if luna is not None:
        cheapest = min((r for r in SUITE if r[0] == 'payment (x12)' and r[6] is not None), key=lambda r: r[6])
        agent_rows = [r for r in SUITE if r[6] is not None]
        out.val('update sessions total tokens < every agent suite (both apps)', 'yes' if all(Fraction(t_tok, 10**6) < r[6] for r in agent_rows) else 'no',
                [msrc, 'section 4 cost rows'])
        for app in ('payment (x12)', 'Moodle (x16)'):
            ms_ = [r[7] for r in agent_rows if r[0] == app]
            tm = Fraction(t_ms, 60000)
            out.val(f'update sessions total minutes ({float(tm):.1f}) vs one agent suite, {app}',
                    f'{sum(tm > m for m in ms_)} of {len(ms_)} agent suites take fewer minutes (suites {float(min(ms_)):.1f} to {float(max(ms_)):.1f})',
                    [msrc, 'section 4 cost rows'])
        out.val('update sessions total tokens < one payment suite of the cheapest agent',
                f'{"yes" if Fraction(t_tok, 10**6) < cheapest[6] else "no"} ({t_tok / 1e6:.4f}M < {float(cheapest[6]):.4f}M, {cheapest[1]})',
                [msrc, 'section 4 cost rows'])

    # Moodle selection funnel and fault types (stream C), re-run and checked against the saved output.
    saved = (ROOT / SEL / 'selection-counts.txt').read_text('utf-8')
    try:
        rerun = subprocess.run(['uv', 'run', '--offline', '--quiet', f'{SEL}/selection_counts.py'], cwd=ROOT, capture_output=True, text=True, timeout=120)
        same = 'yes' if rerun.returncode == 0 and rerun.stdout.strip() == saved.strip() else 'no'
    except (OSError, subprocess.TimeoutExpired):
        same = 'NOT RUN'
    out.val('selection [check] selection_counts.py output equals selection-counts.txt', same, [f'{SEL}/selection_counts.py', f'{SEL}/selection-counts.txt'], 'yes', 're-run (uv, offline)')
    ssrc = f'{SEL}/selection-counts.txt'
    for q, pat in (('selection mined interface changes', r'mined interface changes \(manifest breaks\): (\d+)'),
                   ('selection changes breaking a scenario in the start state', r'bite in arm B start state \(core\): (\d+)'),
                   ('selection selected cases', r'selected pairs: (\d+ over \d+ changes)'),
                   ('selection cases the agents could run', r'cases the agents could run: (\d+ over \d+ changes)')):
        m = re.search(pat, saved)
        out.val(q, m[1] if m else None, ssrc)
    for q, pat in (('fault types payment (12)', r'payment app: faults \(= cases\)\s+(.*)'), ('fault types Moodle 16 cases', r'Moodle: the 16 cases\s+(.*)')):
        m = re.search(pat, saved)
        out.val(q, m[1].strip() if m else None, ssrc)
    m = re.search(r'^class-i-first-v3 .*?: (\d+) model-driven smoke trials had started before this commit .*?; (\d+) of them were on the scenario and fault of a pair of the current selection \(([^)]*)\)', (ROOT / TIMELINE).read_text('utf-8'), re.M)
    out.val('selection rule v3: model-driven smoke trials before it', m[1] if m else None, TIMELINE)
    out.val('selection rule v3: of them on a selected case', f'{m[2]} ({m[3]})' if m else None, TIMELINE)
    m = re.search(r'^class-i-first-v2 .*?: (\d+) model-driven smoke trials had started before this commit .*?; (\d+) of them', (ROOT / TIMELINE).read_text('utf-8'), re.M)
    out.val('selection rule v2 (first with X010@S028): smoke trials before it / of them on X010@S028', f'{m[1]} / {m[2]}' if m else None, TIMELINE)

    # Worked example: payment bank-delete, fault after change 2, repetition 1.
    for label, tid in (('Haiku', 'fault-v2-1/bank-delete/runtime'), ('coded', 'fault-v2-1/bank-delete/maintained')):
        r = next(x for x in data[label] if x['trialId'] == tid)
        out.val(f'example {label} {tid}: status, failed at the target check', f'{r["status"]}, {"yes" if r["assertion"] == target["bank-delete"] else "no"}', r['source'])
    h = next(x for x in data['Haiku'] if x['trialId'] == 'healthy-v2-1/bank-delete/runtime')
    out.val('example Haiku healthy partner healthy-v2-1/bank-delete status', h['status'], h['source'])
    rec = next(row['record'] for row in read_jsonl(f'{e_dir("Haiku")}/trials.jsonl.zst') if row['record']['trialId'] == 'fault-v2-1/bank-delete/runtime')
    reason = rec['agent'].get('verdictReason') or ''
    quote = "The row still reads 'Waters, King and O'Reilly Bank' with an active 'Delete' button and no deleted marker"
    out.val('example Haiku verdict reason contains the quoted words', 'yes' if quote in reason else 'no', f'{e_dir("Haiku")}/trials.jsonl.zst')
    full = quote + ', unchanged after waiting ~3s.'
    out.val('example Haiku verdict reason contains the full quoted sentence', 'yes' if full in reason else 'no', f'{e_dir("Haiku")}/trials.jsonl.zst')


# ------------------------------------------------------------------------------------------------ versions

def git(*args):
    try:
        return subprocess.run(['git', '-C', str(ROOT), *args], capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def versions_section(out, data, moodle_trials_, replay_runs):
    out.section('6. Verdict parser and versions of the single set (fails loudly when campaigns differ)')
    # Verdict parser shipped at 9c9eee2.
    for rel in ('scripts/verdict.mjs', 'adapters/moodle/verdict.mjs'):
        text = (ROOT / rel).read_text('utf-8')
        m = re.search(r'export const verdictParserVersion = (\d+);', text)
        out.val(f'verdict parser {rel}: verdictParserVersion', m[1] if m else None, rel)
        at = git('rev-parse', f'{PLAN["harnessCommit"]}:{rel}')
        here = git('hash-object', rel)
        out.val(f'verdict parser {rel}: file equals the one at 9c9eee2', 'yes' if at and at == here else ('NOT FOUND (no git)' if at is None else 'no'),
                [rel, 'git 9c9eee2'], 'yes', 'git blob at 9c9eee2' if at else None)
    harness_copy = ROOT / E_PAY / 'harness/scripts/verdict.mjs'
    if harness_copy.exists():
        same = harness_copy.read_bytes() == (ROOT / 'scripts/verdict.mjs').read_bytes()
        out.val('verdict parser: e-single-set/pay/harness copy equals scripts/verdict.mjs', 'yes' if same else 'no',
                [f'{E_PAY}/harness/scripts/verdict.mjs', 'scripts/verdict.mjs'], 'yes', 'byte comparison')

    # Verdict parser v2 on every single-set agent run, and what it accepts.
    out.note('verdict parser v2, payment app (scripts/verdict.mjs decodeVerdict; port scripts/counts/verdict_parser.py): accepts (1) the '
             'whole response as one JSON object, (2) exactly one closed ```json or unlabelled code fence with prose around it, or '
             '(3) prose followed by one bare JSON object that ends the response (new in v2). The object needs exactly the keys status, '
             'reason, failedAssertion, status pass|fail|unresolved, no duplicate keys; the prose must hold no other explicit verdict '
             '("status: pass", ...) and no other object with a status key. Anything else decodes as unresolved.')
    out.note('verdict parser v2, Moodle (adapters/moodle/verdict.mjs decodeStepVerdict, also labelled v2): accepts only (1) whole JSON or '
             '(2) one closed JSON/unlabelled fence with the same prose checks; there is no trailing-object form. Keys exactly status, reason, '
             'failingStep, failingStepText; a fail must give a 1-based step number and quote the step; the step is then verified against the '
             'listed step text and mapped to the Behat index. Anything else decodes as unresolved.')
    pay_agent = [r for label in AGENTS for r in data[label]]
    pay_src = sorted({r['source'] for r in pay_agent})
    out.val('parser v2 recorded: payment agent runs', frac(sum(r['parser'] == 2 for r in pay_agent), len(pay_agent)), pay_src,
            frac(len(pay_agent), len(pay_agent)), 'every run')
    out.val('parser formats: payment agent runs', json.dumps(dict(sorted(Counter(str(r['format']) for r in pay_agent).items()))), pay_src)
    errs = [r for r in pay_agent if r['parseError']]
    out.val('parser errors (decoded as unresolved): payment agent runs', len(errs), pay_src)
    for r in errs:
        out.note(f'payment parse error: {r["source"].split("/")[-2]} {r["trialId"]}: {r["parseError"]}')
    total_v2, total_n = sum(r['parser'] == 2 for r in pay_agent), len(pay_agent)
    if moodle_trials_:
        mt = [t for t in moodle_trials_ if t['arm'] == 'C']
        verdicts = [t['e'].get('verdict') if isinstance(t['e'].get('verdict'), dict) else {} for t in mt]
        v2 = sum(v.get('verdictParserVersion') == 2 for v in verdicts)
        out.val('parser v2 recorded: Moodle single-set agent runs', frac(v2, len(mt)), MOODLE_SRC, frac(len(mt), len(mt)), 'every run')
        out.val('parser formats: Moodle single-set agent runs', json.dumps(dict(sorted(Counter(str(v.get('verdictFormat')) for v in verdicts).items()))), MOODLE_SRC)
        merr = [(t, v) for t, v in zip(mt, verdicts) if v.get('verdictParseError')]
        out.val('parser errors (decoded as unresolved): Moodle single-set agent runs', len(merr), MOODLE_SRC)
        for t, v in merr:
            out.note(f'Moodle parse error: {t["key"]}: {v["verdictParseError"]}')
        total_v2, total_n = total_v2 + v2, total_n + len(mt)
    out.val('parser v2 recorded: all single-set agent runs (payment + Moodle)', frac(total_v2, total_n), [*pay_src, MOODLE_SRC],
            frac(total_n, total_n), 'every run')
    if replay_runs:
        ra = [r['end'] for r in replay_runs if r['arm'] == 'C']
        rv = [e.get('verdict') if isinstance(e.get('verdict'), dict) else {} for e in ra]
        dsrc = f'{D_STREAM}/data/ledger/trials.jsonl'
        out.val('parser v2 recorded: replay (stream D) agent runs', frac(sum(v.get('verdictParserVersion') == 2 for v in rv), len(ra)), dsrc,
                frac(len(ra), len(ra)), 'every run')
        out.val('parser formats: replay agent runs', json.dumps(dict(sorted(Counter(str(v.get('verdictFormat')) for v in rv).items()))), dsrc)
        out.val('parser errors (decoded as unresolved): replay agent runs', sum(bool(v.get('verdictParseError')) for v in rv), dsrc)

    # Payment journals: frozen inputs.
    inputs = {}
    for label in ARMS:
        for part, cdir in (('E', e_dir(label)), ('B', b_dir(label))):
            first = json.loads((ROOT / cdir / 'journal.jsonl').read_text('utf-8').splitlines()[0])
            assert first['type'] == 'campaign-frozen', cdir
            inputs[(label, part)] = (first['inputs'], f'{cdir}/journal.jsonl')
    shared = {
        'harness commit': lambda i: (i.get('followup') or {}).get('harnessCommit'),
        'Codex CLI': lambda i: i.get('codex'),
        'Node': lambda i: i.get('node'),
        'mode': lambda i: i.get('mode'),
        'gatePassExists': lambda i: i.get('gatePassExists'),
        'app revision': lambda i: (i.get('appPins') or {}).get('revision'),
        'app pins (hash)': lambda i: _h(i.get('appPins')),
        'source pins (hash, incl. package-lock)': lambda i: _h(i.get('sourcePins')),
        'contract/feature/evaluator hashes': lambda i: _h(i.get('hashes')),
        'limits (runtime/retained/fixture wall ms)': lambda i: '/'.join(str((i.get('config') or {}).get(k)) for k in ('runtimeWallMs', 'retainedWallMs', 'fixtureEnvelopeMs')),
        'coded step source (runtimeSource)': lambda i: (i.get('runtimeSource') or {}).get('id'),
    }
    srcs = [s for _, s in inputs.values()]
    for name, fn in shared.items():
        values = {k: fn(i) for k, (i, _) in inputs.items()}
        distinct = set(map(str, values.values()))
        if len(distinct) == 1:
            v = next(iter(distinct))
            out.val(f'payment campaigns share {name}', v, srcs[:1] + [f'(all {len(srcs)} journals)'], v, f'all {len(srcs)} journals equal')
        else:
            out.fail(f'payment campaigns share {name}', json.dumps({f'{a}/{p}': str(v) for (a, p), v in values.items()}), srcs, 'campaigns differ')
    for key, expect in (('harness commit', PLAN['harnessCommit']), ('Codex CLI', PLAN['codex']), ('Node', PLAN['node']), ('app revision', PLAN['appRevision'])):
        got = {str(shared[key](i)) for i, _ in inputs.values()}
        out.val(f'payment {key} equals plan', 'yes' if got == {expect} else f'no: {sorted(got)}', [PLAN_MD] + srcs[:1], 'yes', PLAN_MD)
    for label in AGENTS:
        de, db = inputs[(label, 'E')][0]['driver'], inputs[(label, 'B')][0]['driver']
        want_cli = PLAN['omp'] if label == 'Haiku' else PLAN['codex']
        ok = de == db and de.get('model') == MODEL_OF[label] and de.get('cliVersion') == want_cli
        out.val(f'payment {label} driver (E and B journals)', f'{de.get("driver")} {de.get("cliVersion")} {de.get("model")}',
                [inputs[(label, 'E')][1], inputs[(label, 'B')][1]], status='ok' if ok else 'MISMATCH: driver differs from plan or between E and B')
        rows = data[label]
        models = Counter(m for r in rows for m in (r['models'] or ['<none>']))
        out.val(f'payment {label} models reported per run', json.dumps(dict(models)), sorted({r['source'] for r in rows}),
                status='ok' if set(models) == {MODEL_OF[label]} else 'MISMATCH: model other than the plan')
        out.val(f'payment {label} runs with modelVerified true', frac(sum(r['modelVerified'] is True for r in rows), len(rows)),
                sorted({r['source'] for r in rows}), frac(len(rows), len(rows)), 'all runs')
        parsers = Counter(r['parser'] for r in rows)
        out.val(f'payment {label} verdict parser version per run', json.dumps({str(k): v for k, v in parsers.items()}),
                sorted({r['source'] for r in rows}), json.dumps({'2': len(rows)}), 'parser v2 on every run')
    coded = data['coded']
    sha = {rev: sorted({(r['implementationSHA'] or '')[:8] for r in coded if r['revision'] == rev}) for rev in ('v0', 'v1', 'v2')}
    out.val('payment coded step code per revision (implementationSHA)', json.dumps(sha), sorted({r['source'] for r in coded}))
    out.val('payment coded runner verdict equals recorded reportedStatus',
            frac(sum(r['status'] == r['reportedStatus'] for r in coded), len(coded)), sorted({r['source'] for r in coded}), frac(len(coded), len(coded)), 'payment.runs assertion')
    out.val('payment host', None, srcs[:1])
    out.note(f'payment journals and trial records do not record the host; e-single-set/pay/README.md and b-change1-faults/README.md '
             f'state {PLAN["host"]} (x86_64, WSL2). Playwright, @playwright/mcp and bubblewrap versions are not recorded in the payment '
             f'journals; the source pins (package-lock.json hash) are equal across the campaigns.')

    # Moodle E ledger.
    if moodle_trials_:
        src = MOODLE_SRC
        envs = [t['e'].get('env') for t in moodle_trials_]
        envs = [json.loads(e) if isinstance(e, str) else (e or {}) for e in envs]
        fields = {'host': lambda e: e.get('host'), 'harness commit': lambda e: e.get('studyRepoHead'),
                  'Codex CLI': lambda e: (e.get('cli') or {}).get('codex'), 'omp': lambda e: (e.get('cli') or {}).get('omp'),
                  'Node': lambda e: (e.get('cli') or {}).get('node'), 'Playwright': lambda e: (e.get('cli') or {}).get('playwright'),
                  '@playwright/mcp': lambda e: (e.get('cli') or {}).get('playwrightMcp'), 'bubblewrap': lambda e: (e.get('cli') or {}).get('bwrap'),
                  'Moodle commit': lambda e: e.get('moodleCommit'), 'PHP': lambda e: (e.get('version') or {}).get('phpMinor'),
                  'Postgres': lambda e: (e.get('version') or {}).get('dbVersionMinor'),
                  'limits': lambda e: None if e.get('limits') is None else json.dumps(e.get('limits'), sort_keys=True)}
        plan_key = {'host': 'host', 'harness commit': 'harnessCommit', 'Codex CLI': 'codex', 'omp': 'omp', 'Node': 'node',
                    'Playwright': 'playwright', '@playwright/mcp': 'playwrightMcp', 'bubblewrap': 'bwrap', 'Moodle commit': 'moodleCommit',
                    'PHP': 'php', 'Postgres': 'postgres'}
        for name, fn in fields.items():
            # Arm A (Behat) records carry no agent fields; distinct non-null values must be one, and the coverage is shown.
            got = [fn(e) for e in envs]
            vals = Counter(str(v) for v in got if v is not None)
            covered = f' ({sum(v is not None for v in got)}/{len(got)} runs record it)'
            if len(vals) > 1:
                out.fail(f'moodle E runs share {name}', json.dumps(dict(vals)), src, 'runs differ')
                continue
            if not vals:
                out.val(f'moodle E {name}', None, src)
                continue
            v = next(iter(vals))
            if v in ('<host>', '<home>'):
                # Redacted for release (as in the v1.1.0 package); the plan value cannot be confirmed from the redacted record.
                out.val(f'moodle E {name}', f'{v} (redacted in the ledger)', src + covered)
                continue
            if name in plan_key:
                out.val(f'moodle E {name}', v, [src + covered, PLAN_MD], str(PLAN[plan_key[name]]), PLAN_MD)
            else:
                out.val(f'moodle E {name}', v, src + covered)
        reported = Counter(f'{t["model"]}: {json.dumps((t["e"].get("process") or {}).get("models"))}' for t in moodle_trials_ if t['arm'] == 'C')
        out.val('moodle E models reported by the CLI per agent run', json.dumps(dict(reported)), src)
        parsers = Counter((t['e'].get('verdict') or {}).get('verdictParserVersion') if isinstance(t['e'].get('verdict'), dict) else None
                          for t in moodle_trials_ if t['arm'] == 'C')
        out.val('moodle E verdict parser version per agent run', json.dumps({str(k): v for k, v in parsers.items()}), src)
    else:
        out.val('moodle E versions', 'PENDING', f'{E_MOODLE}/data/ledger/trials.jsonl', status='PENDING')

    # Replay D ledger.
    if replay_runs:
        src = f'{D_STREAM}/data/ledger/trials.jsonl'
        envs = [r['end'].get('env') for r in replay_runs]
        envs = [json.loads(e) if isinstance(e, str) else (e or {}) for e in envs]
        heads = Counter(str(e.get('studyRepoHead')) for e in envs)
        out.val('replay D harness commit (studyRepoHead) per run', json.dumps(dict(heads)), src,
                json.dumps({PLAN['harnessCommit']: len(envs)}), PLAN_MD)
        clis = Counter(json.dumps(e.get('cli')) for e in envs)
        out.val('replay D Codex CLI / omp / host per run', None if clis == Counter({'null': len(envs)}) else json.dumps(dict(clis)), src)
        out.note('stream D trial records carry no CLI versions or host (env has no cli/host fields); d-moodle-replay/plan.md states '
                 'Codex CLI 0.169.0 and omp 18.20.2 on the same host. Not confirmed from per-trial records.')
        agent = [r['end'] for r in replay_runs if r['arm'] == 'C']
        parsers = Counter(str((e.get('verdict') or {}).get('verdictParserVersion')) if isinstance(e.get('verdict'), dict) else 'none' for e in agent)
        out.val('replay D verdict parser version per agent run', json.dumps(dict(parsers)), src)
        reported = Counter(json.dumps((e.get('process') or {}).get('models')) for e in agent)
        out.val('replay D models reported by the CLI per agent run', json.dumps(dict(reported)), src)
    else:
        out.val('replay D versions', 'PENDING', f'{D_STREAM}/data/ledger/trials.jsonl', status='PENDING')


def _h(obj):
    import hashlib
    return hashlib.sha256(json.dumps(obj, sort_keys=True).encode()).hexdigest()[:16] if obj is not None else None


# ---------------------------------------------------------------------------------------------------- main

def build(argv=()):
    argv = list(argv)
    ledger_arg = argv[argv.index('--moodle-ledger') + 1] if '--moodle-ledger' in argv else None
    out = Out()
    out.note('Single set: status exploratory-owner-directed, gatePassExists false; post hoc (e-single-set/plan.md).')
    target = targets()
    data = {}
    for label in ARMS:
        e = load_runs(e_dir(label), label)
        b = load_runs(b_dir(label), label)
        assert {r['revision'] for r in e} == {'v0', 'v2'} and {r['revision'] for r in b} == {'v1'}, label
        assert len(e) == 96 and len(b) == 36, (label, len(e), len(b))
        data[label] = e + b
    payment_section(out, data, target)
    change1_section(out, data, target)
    cm = import_path(f'{E_MOODLE}/scripts/count_moodle.py', 'count_moodle')
    m_trials = moodle_section(out, ledger_arg)
    payment_cost_section(out, data)
    moodle_cost_section(out, m_trials, cm)
    cost_summary_section(out)
    r_runs = replay_section(out)
    versions_section(out, data, m_trials, r_runs)
    trace_audit_section(out, data, target, m_trials)
    paper_support_section(out, data, target, m_trials, r_runs)
    return out


def main():
    out = build(sys.argv[1:])
    text = out.render()
    print(text)
    if '--no-write' not in sys.argv and '--moodle-ledger' not in sys.argv:
        (ROOT / 'results/counts-single-set.txt').write_text(text.lstrip('\n') + '\n', 'utf-8')
        (ROOT / 'results/counts-single-set.json').write_text(json.dumps(out.rows, indent=1) + '\n', 'utf-8')
    pending = sum(r['type'] == 'row' and r['status'] == 'PENDING' for r in out.rows)
    print(f'\n{sum(r["type"] == "row" for r in out.rows)} values; {pending} pending; {len(out.failures)} mismatch(es)', file=sys.stderr)
    if out.failures:
        for r in out.failures:
            print(f'  {r["quantity"]}: {r["value"]} (stream {r["expected"]}) {r["status"]}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
