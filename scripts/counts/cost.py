# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Estimated cost of one serial suite run: mean cost per valid execution x number of scenarios.

Payment app (x12): every healthy and faulty run; record.elapsedMs and input + output tokens
from data/campaigns. Step definitions use all 108 runs of the maintained arm of campaign A,
including the two runs graded infrastructure-invalid: they started and exited 1, and count as
failed runs in the outcome rule (payment.py), so they count in the cost mean too.
Moodle (x16): browser agents use whole-trial wall time and input + output tokens of every valid
healthy and faulty run in results/moodle-resources.txt (setup-invalid runs left out).
Developers' current definitions use the arm A wall mean; updated definitions the mean of the
three arm B per-model wall means.
Cache-read share = cached input tokens / input tokens, summed over the same runs.
"""
import re
from statistics import fmean

from common import ROOT, Checker, main, read_jsonl
from moodle import SETUP_CAUSE, parse

PAYMENT = {'Luna': 'campaign-b-20261101-02f4758', 'Terra': 'campaign-c-20261101-f7857ea', 'Haiku': 'campaign-d-20261101-2b2589f'}
MOODLE_MODELS = {'gpt-6-luna': 'Luna', 'gpt-5.6-terra': 'Terra', 'claude-haiku-5-5': 'Haiku'}
EXPECTED = {
    'payment_coded_min': '1.5',
    'payment': {'Luna': ('1.55', '5.0'), 'Terra': ('2.70', '10.3'), 'Haiku': ('4.49', '12.0')},
    'moodle': {'Luna': ('4.88', '12.7'), 'Terra': ('7.18', '19.9'), 'Haiku': ('9.66', '15.3')},
    'moodle_current_min': '4.4',
    'moodle_updated_min': '3.5',
}
SUMMARY = re.compile(r'^campaign arm ([AB]) (\S+): (\d+) trials; .*?wall mean (\d+) ms')
AGENT = re.compile(r'^campaign [0-9a-f]+/(B\d+\.S\d+)/(healthy|fault:X\d+)/C/(\S+)/r(\d+): '
                   r'in (\d+|null) cached (\d+|null) out (\d+|null); wall (\d+) ms')


def run(ck: Checker):
    ck.section('Cost per suite: payment app (x12 scenarios)')
    coded = [r['record'] for r in read_jsonl('data/campaigns/campaign-20261101-04d8551/trials.jsonl.zst')
             if r['record']['trial']['arm'] == 'maintained']
    assert len(coded) == 108, len(coded)
    ck.check('coded step definitions, minutes', fmean(r['elapsedMs'] for r in coded) * 12 / 60000, EXPECTED['payment_coded_min'])
    ck.note('coded mean covers all 108 runs, incl. the 2 infrastructure-invalid runs that exited 1 (failed runs, as in the outcome rule)')
    for label, campaign in PAYMENT.items():
        records = [r['record'] for r in read_jsonl(f'data/campaigns/{campaign}/trials.jsonl.zst') if r['result'] == 'recorded']
        assert len(records) == 108
        usage = [r['agent']['usage'] for r in records]
        tokens, minutes = EXPECTED['payment'][label]
        ck.check(f'{label} agent, million tokens', fmean(u['input_tokens'] + u['output_tokens'] for u in usage) * 12 / 1e6, tokens)
        ck.check(f'{label} agent, minutes', fmean(r['elapsedMs'] for r in records) * 12 / 60000, minutes)
        ck.check(f'{label} agent, cache-read share of input', sum(u['cached_input_tokens'] for u in usage) / sum(u['input_tokens'] for u in usage))

    ck.section('Cost per suite: Moodle (x16 scenarios)')
    _, causes = parse()
    walls, agents = {}, {}
    for line in (ROOT / 'results/moodle-resources.txt').read_text('utf-8').splitlines():
        if m := SUMMARY.match(line):
            walls[(m[1], m[2])] = int(m[4])
        elif m := AGENT.match(line):
            case, kind, model, rep = m[1], 'healthy' if m[2] == 'healthy' else 'faulty', m[3], int(m[4])
            assert (case, kind, model, rep) not in agents
            agents[(case, kind, model, rep)] = m
    assert len(agents) == 192, len(agents)
    ck.check("developers' current coded, minutes", walls[('A', 'none')] * 16 / 60000, EXPECTED['moodle_current_min'])
    updated = fmean(walls[('B', model)] for model in MOODLE_MODELS)
    ck.check('updated coded (mean of model means), minutes', updated * 16 / 60000, EXPECTED['moodle_updated_min'])
    for model, label in MOODLE_MODELS.items():
        valid = []
        for (case, kind, m_model, rep), m in agents.items():
            if m_model != model:
                continue
            if causes.get((case, kind, 'C', model, rep), '').startswith(SETUP_CAUSE):
                assert m[5] == 'null'
                continue
            valid.append(m)
        assert len(valid) == 56, (model, len(valid))
        tokens, minutes = EXPECTED['moodle'][label]
        ck.check(f'{label} agent, million tokens', fmean(int(m[5]) + int(m[7]) for m in valid) * 16 / 1e6, tokens)
        ck.check(f'{label} agent, minutes', fmean(int(m[8]) for m in valid) * 16 / 60000, minutes)
        ck.check(f'{label} agent, cache-read share of input', sum(int(m[6]) for m in valid) / sum(int(m[5]) for m in valid))


if __name__ == '__main__':
    main(run)
