# /// script
# requires-python = ">=3.14"
# dependencies = ["pyyaml"]
# ///
"""Stream C (post-hoc analysis, no runs): Moodle case-selection funnel, dropout and seeded-fault summary.

Usage (from the repository root):  uv run followups-2026-11/c-moodle-selection/selection_counts.py

Inputs (all already in the package; nothing is written outside stdout):
  manifests/moodle.yaml                    breaks (mined interface changes), seeded faults X*, mined candidates C*, F*
  results/moodle-v1-reproduction.jsonl     model-free reproduction with the developers' step definitions (break, fault, pair rows)
  results/moodle-campaign.txt              measured campaign: per-pair rows and invalid executions
  scripts/mutations.mjs                    the 12 payment-app fault mutations
  data/campaigns/*/trials.jsonl.zst        payment-app target checks (via scripts/counts/verified.py)

The pair selection is re-implemented from scripts/moodle/v1-report.mjs (selectPairs, orderOk) and checked against the
16 cases of the measured campaign. The fault types and the payment-app visibility classes are a manual, post-hoc coding
(TYPE and PAY_VISIBLE below; the rule is in faults.md). The script checks that the coding covers exactly the faults in the
data and recounts it. Any check that fails stops the script with an AssertionError.
"""
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/counts'))

# ---------------------------------------------------------------- coded data (post-hoc), see faults.md for the rule
# NAV wrong navigation; VAL validation removed or inverted; NOSAVE action has no effect / change not saved;
# WRONGDATA wrong data submitted or saved; GUARD wrong show/allow condition; DISPLAY wrong value displayed.
TYPE_ORDER = ['NAV', 'VAL', 'NOSAVE', 'WRONGDATA', 'GUARD', 'DISPLAY']
TYPE_NAME = {'NAV': 'wrong navigation', 'VAL': 'validation removed or inverted', 'NOSAVE': 'action has no effect / change not saved',
             'WRONGDATA': 'wrong data submitted or saved', 'GUARD': 'wrong show/allow condition', 'DISPLAY': 'wrong value displayed'}
PAY_TYPE = {
    'auth-login': 'NOSAVE',        # altered password is submitted, the server rejects the sign-in: the user stays signed out
    'auth-logout': 'NOSAVE',       # sign-out handler replaced by a no-op
    'profile-name': 'NOSAVE',      # submitted first name overwritten with the stored one: the change is not saved
    'profile-email': 'VAL',        # e-mail format validation removed
    'bank-create': 'WRONGDATA',    # account saved with bank name "Altered Bank"
    'bank-delete': 'NOSAVE',       # delete call replaced by a no-op
    'transfer-pay': 'WRONGDATA',   # amount + 1 saved
    'transfer-request': 'WRONGDATA',  # request saved as a payment
    'social-like': 'NOSAVE',       # like handler replaced by a no-op
    'social-comment': 'WRONGDATA', # comment saved as "Altered comment"
    'feed-personal': 'NAV',        # Mine tab links to /contacts
    'feed-friends': 'NAV',         # Friends tab links to /personal
}
MOODLE_TYPE = {
    'X001': 'DISPLAY', 'X002': 'NOSAVE', 'X003': 'GUARD', 'X004': 'DISPLAY', 'X005': 'DISPLAY', 'X006': 'GUARD',
    'X007': 'GUARD', 'X008': 'NOSAVE', 'X009': 'NOSAVE', 'X010': 'GUARD', 'X011': 'DISPLAY', 'X012': 'GUARD',
    'X013': 'DISPLAY', 'X014': 'GUARD', 'X015': 'GUARD', 'X016': 'WRONGDATA', 'X017': 'NOSAVE', 'X018': 'VAL',
    'X019': 'NOSAVE', 'X020': 'GUARD', 'X021': 'GUARD', 'X022': 'DISPLAY', 'X023': 'GUARD', 'X024': 'WRONGDATA',
    'X025': 'GUARD', 'X026': 'GUARD',
}
# What the targeted check observes on the faulty build (payment app; from the scenario text and the mutation).
PAY_VISIBLE = {
    'auth-login': 'page or URL', 'auth-logout': 'page or URL', 'feed-personal': 'page or URL', 'feed-friends': 'page or URL',
    'profile-name': 'text present/absent/changed', 'profile-email': 'text present/absent/changed', 'bank-create': 'text present/absent/changed',
    'bank-delete': 'text present/absent/changed', 'transfer-pay': 'text present/absent/changed',
    'transfer-request': 'text present/absent/changed', 'social-comment': 'text present/absent/changed',
    'social-like': 'number and control state',
}

SETUP_CAUSE = 'Scenario has no leading data steps'
PAIR = re.compile(r'^(B\d+)\.(S\d+)\s+(X\d+)\s+([ABC])\s+(\S+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+) \(target \d+\)$')
INVALID = re.compile(r'^  [0-9a-f]+/(B\d+)\.(S\d+)/(healthy|fault:X\d+)/([ABC])/(\S+)/r(\d+): (.+)$')

out = []
def p(*a):
    out.append(' '.join(str(x) for x in a))


def load():
    m = yaml.load((ROOT / 'manifests/moodle.yaml').read_text('utf-8'), Loader=getattr(yaml, 'CSafeLoader', yaml.SafeLoader))
    rec = [json.loads(l) for l in (ROOT / 'results/moodle-v1-reproduction.jsonl').read_text('utf-8').splitlines() if l.strip()]
    return m, rec


def campaign():
    pairs, invalid = [], []
    for line in (ROOT / 'results/moodle-campaign.txt').read_text('utf-8').splitlines():
        if mm := PAIR.match(line):
            pairs.append(dict(zip(['change', 'scen', 'fault', 'arm', 'model', 'rep', 'outcome', 'healthy', 'faulty'], mm.groups())))
        elif mm := INVALID.match(line):
            invalid.append(dict(zip(['change', 'scen', 'side', 'arm', 'model', 'rep', 'cause'], mm.groups())))
    return pairs, invalid


# ---------------------------------------------------------------- selection, re-implemented from scripts/moodle/v1-report.mjs
def order_ok(pr):
    t, b = pr.get('target_step_index'), pr.get('observed_break_failing_step')
    return t is None or b is None or t >= b


def select_pairs(pairs, breaks, total=16, per_i=3, per_ii=2):
    brk = {b['break']: b for b in breaks}
    order = lambda b: ('0' if brk[b]['reproduced_strict'] else '1') + b
    valid = [x for x in pairs if x['valid_strict'] or x['valid_core']]
    srt = sorted(valid, key=lambda x: (-int(x['valid_strict']), order(x['break']), x['fault'], x['scenario']))
    ordered = [x for x in srt if order_ok(x)]

    def prefer(lst):
        by = defaultdict(list)
        for x in lst:
            by[x['fault']].append(x)
        lists, res, r = list(by.values()), [], 0
        while any(len(l) > r for l in lists):
            res += [l[r] for l in lists if len(l) > r]
            r += 1
        return res

    def breaks_of(cls):
        return sorted({x['break'] for x in ordered if brk[x['break']]['class'] == cls}, key=order)

    taken, selected, why = set(), [], {}
    key = lambda x: (x['fault'], x['scenario'])
    for b in breaks_of('i'):
        for x in prefer([y for y in ordered if y['break'] == b]):
            if sum(q['break'] == b for q in selected) >= per_i:
                why[(b, key(x))] = 'per-change limit'
                continue
            if total - len(selected) <= 0:
                why[(b, key(x))] = 'total of 16 reached'
                continue
            if key(x) in taken:
                why[(b, key(x))] = 'same fault and scenario already selected under an earlier change'
                continue
            taken.add(key(x))
            selected.append(x)
    assert not breaks_of('ii'), 'class (ii) pairs present: extend this re-implementation'
    return valid, ordered, selected, why


def main():
    m, rec = load()
    vb = {r['break']: r for r in rec if r['type'] == 'break'}
    vpairs = [r for r in rec if r['type'] == 'pair']
    mb = {b['id']: b for b in m['breaks']}
    cands = m['fault_candidates'] + m.get('fault_cross_runs', [])
    seeded = {c['id']: c for c in m['fault_candidates'] if c['id'].startswith('X')}
    cpairs, invalid = campaign()

    # ------------------------------------------------ campaign cases
    cases = sorted({(x['change'], x['scen'], x['fault']) for x in cpairs})
    setup = [i for i in invalid if i['cause'].startswith(SETUP_CAUSE)]
    setup_cases = sorted({(i['change'], i['scen']) for i in setup})
    c_rows = [x for x in cpairs if x['arm'] == 'C']
    # a case is lost for the agents when every arm C execution of it (both sides) is setup-invalid
    c_exec = Counter((x['change'], x['scen']) for x in c_rows)
    lost = [cs for cs in setup_cases if sum((i['change'], i['scen']) == cs for i in setup) == 2 * c_exec[cs]]
    agent_cases = [c for c in cases if (c[0], c[1]) not in lost]
    sel_changes = sorted({c[0] for c in cases})

    # ------------------------------------------------ change-level funnel
    valid, ordered, selected, why = select_pairs(vpairs, list(vb.values()))
    assert sorted((x['break'], x['scenario'], x['fault']) for x in selected) == cases, 'selection re-implementation differs from the campaign cases'
    p('== A. Change-level funnel (whole manifest) ==')
    p('mined interface changes (manifest breaks):', len(mb))
    unusable = {b: vb[b] for b in vb if not vb[b]['usable']}
    def ureason(note):
        for pat, lab in [('not a distinct break', 'bites only scenarios of a lower-numbered change (not distinct)'),
                         ('does not bite', 'start state passed in every probed scenario'),
                         ('no probe scenario', 'no scenario uses the changed step definitions at the pin'),
                         ('repaired step is not used', 'repaired step used by no scenario at the pin')]:
            if pat in note:
                return lab
        return 'OTHER: ' + note
    ur = Counter(ureason(mb[b].get('notes') or vb[b].get('note') or '') for b in unusable)
    p('  not usable:', len(unusable), dict(ur))
    usable = [b for b in vb if vb[b]['usable']]
    bite = [b for b in usable if vb[b]['n_core'] > 0]
    p('usable:', len(usable), '; bite in arm B start state (core):', len(bite), '; strict:', sum(vb[b]['n_strict'] > 0 for b in usable))
    p('  usable but no scenario fails in the start state:', sorted(set(usable) - set(bite)))
    vchg = sorted({x['break'] for x in valid})
    p('changes with >=1 valid pair (exact rule):', len(vchg), vchg, '; valid pairs:', len(valid),
      '(strict', sum(x['valid_strict'] for x in valid), ')')
    noval = sorted(set(bite) - set(vchg))
    for b in noval:
        core = {s['scenario'] for s in vb[b]['scenarios'] if s['core']}
        aimed = Counter()
        for c in cands:
            if (set(c.get('probe_scenarios') or []) | set(c.get('screened_on') or [])) & core:
                aimed[('seeded' if c['id'].startswith('X') else 'mined') + ' ' + c['status']] += 1
        p(f'  {b}: bites {sorted(core)}; faults aimed at these scenarios: {dict(aimed) or "none"}')
    ochg = sorted({x['break'] for x in ordered})
    p('valid pairs passing the ordering criterion (target step >= bite step):', len(ordered), 'over', len(ochg), 'changes')
    for x in valid:
        if not order_ok(x):
            p(f"  ordering-excluded: {x['break']}.{x['fault']}@{x['scenario']} target {x['target_step_index']} < bite {x['observed_break_failing_step']}")
    p('  changes losing every pair to the ordering criterion:', sorted(set(vchg) - set(ochg)))
    p('selected pairs:', len(selected), 'over', len({x['break'] for x in selected}), 'changes')
    for (b, k), r in sorted(why.items()):
        p(f'  not selected: {b}.{k[0]}@{k[1]}: {r}')
    p('  changes with eligible pairs but none selected:', sorted(set(ochg) - {x['break'] for x in selected}))

    # ------------------------------------------------ per-change table for the 8
    p()
    p('== B. The 8 selected changes ==')
    p('change cls static-scen probed bitten | seeded aimed (acc/rej) | mined aimed (acc/rej-screen/rej-static/pending) | valid ordered selected | agent cases')
    tot = Counter()
    mined_union = {}
    for b in sel_changes:
        core = {s['scenario'] for s in vb[b]['scenarios'] if s['core']}
        probed = [s for s in mb[b]['affected_scenarios'] if any(x['scenario'] == s for x in vb[b]['scenarios'])]
        sa, sr = [], []
        mined = Counter()
        for c in cands:
            if (set(c.get('probe_scenarios') or []) | set(c.get('screened_on') or [])) & core:
                if c['id'].startswith('X'):
                    (sa if c['status'] == 'accepted' else sr).append(c['id'])
                else:
                    rr = c.get('rejection_reason') or ''
                    k = c['status'] if c['status'] != 'rejected' else ('rej-static' if rr.startswith('static') else 'rej-screen')
                    mined[k] += 1
                    mined_union[c['id']] = k
        nv = sum(x['break'] == b for x in valid); no = sum(x['break'] == b for x in ordered); ns = sum(x['break'] == b for x in selected)
        na = sum(c[0] == b for c in agent_cases)
        p(f"{b}  {mb[b]['class']}  {mb[b]['affected_total']:>4} {len(probed):>3} {len(core):>3} | {','.join(sa)} ({len(sa)}/{len(sr)}) | "
          f"{mined['accepted']}/{mined['rej-screen']}/{mined['rej-static']}/{mined['pending']} | {nv} {no} {ns} | {na}")
        tot.update(static=mb[b]['affected_total'], probed=len(probed), bitten=len(core), sacc=len(sa), srej=len(sr), valid=nv, ordered=no, selected=ns, agent=na)
    p('totals:', dict(tot))
    p('mined candidates aimed at the bitten scenarios of the 8 changes (distinct):', len(mined_union), dict(Counter(mined_union.values())))
    case_faults = sorted({c[2] for c in cases}); agent_faults = sorted({c[2] for c in agent_cases})
    p('case faults:', len(case_faults), case_faults)

    # ------------------------------------------------ fault verification (all seeded, all mined)
    p()
    p('== C. Fault sources and verification ==')
    st = Counter(c['status'] for c in seeded.values())
    p('seeded faults written:', len(seeded), dict(st))
    for c in seeded.values():
        if c['status'] != 'accepted':
            tgt = c['seeded']['expected_failing_step']['scenario']
            chg = sorted(b for b in vb if any(s['scenario'] == tgt and s['core'] for s in vb[b]['scenarios']))
            p(f"  {c['id']} rejected (aimed at {tgt}, change(s) {chg}): {c['rejection_reason'][:160]}")
    cm = [c for c in cands if not c['id'].startswith('X')]
    def mk(c):
        if c['status'] != 'rejected':
            return c['status']
        r = c.get('rejection_reason') or ''
        return 'rejected: ' + ('revert does not apply at the pin' if r.startswith('static') else
                               'faulted build passed every probe' if 'passed every' in r else r[:50])
    p('mined candidates (C*, cross-runs):', len(cm), dict(Counter(mk(c) for c in cm)))
    pf = [r for r in rec if r['type'] == 'fault' and not r['alt']]
    p('original mined faults F*:', len(pf), 'reproduced', sum(r['reproduced'] for r in pf))
    p('valid pairs by fault origin:', dict(Counter(x.get('origin') for x in valid)), '; after ordering:', dict(Counter(x.get('origin') for x in ordered)),
      '; selected:', dict(Counter(x.get('origin') for x in selected)))

    # ------------------------------------------------ selection requires the coded tests to catch the fault
    p()
    p('== D. Does selection require the coded (developers\') tests to catch the fault? ==')
    ok = 0
    for x in selected:
        c = seeded[x['fault']]
        conf = c['confirm'][x['scenario']]
        tgt = next(t for t in c['targets'] if t['scenario'] == x['scenario'])
        healthy = next(s for s in vb[x['break']]['scenarios'] if s['scenario'] == x['scenario'])['adapted']
        good = conf['status'] == 'failed' and conf['class'] == 'at' and healthy == 'passed' and x['fault_step_vs_target'] == 'at'
        ok += good
        assert 'first failing step of the screening run' in next(s for s in c['screen_targets'] if s['scenario'] == x['scenario'])['source']
        assert tgt['behat_step_index'] == x['target_step_index']
    p(f'selected pairs whose developers\' Behat run failed at the target on the faulted pin and passed on the healthy pin: {ok}/{len(selected)}')
    p('target step of every selected pair = first failing step of the developers\' Behat screening run (manifest screen_targets.source): yes')
    a = [x for x in cpairs if x['arm'] == 'A']
    p('measured arm A (developers\' current step definitions):', Counter(x['outcome'] for x in a))

    # ------------------------------------------------ campaign dropout
    p()
    p('== E. Campaign cases and dropout ==')
    p('cases (scenario + fault):', len(cases), 'over', len(sel_changes), 'changes;', 'faults', len(case_faults))
    p('setup-invalid arm C executions:', len(setup), 'over cases', setup_cases)
    p('cases the agents could run:', len(agent_cases), 'over', len({c[0] for c in agent_cases}), 'changes; faults', len(agent_faults))
    for cs in lost:
        p(f'  lost for the agents: {cs[0]}.{cs[1]} (all {2 * c_exec[cs]} arm C executions: "{SETUP_CAUSE} ...", adapters/moodle/handoff.mjs:46)')
    p('arm A and arm B pairs per case:', Counter(x['arm'] for x in cpairs))

    # ------------------------------------------------ faults: types and visibility
    p()
    p('== F. Fault types (post-hoc coding, rule in faults.md) ==')
    src = (ROOT / 'scripts/mutations.mjs').read_text('utf-8')
    pay = re.findall(r"^\s+'([a-z-]+)': \[component\(", src.split('export const faults')[1].split('};')[0], re.M)
    assert sorted(pay) == sorted(PAY_TYPE) == sorted(PAY_VISIBLE), (pay, sorted(PAY_TYPE))
    assert sorted(MOODLE_TYPE) == sorted(seeded)
    def row(lbl, types):
        cnt = Counter(types)
        p(f'{lbl:<44}', ' '.join(f'{t}={cnt[t]}' for t in TYPE_ORDER), f'total={len(types)}')
    row('payment app: faults (= cases)', [PAY_TYPE[k] for k in pay])
    row('Moodle: seeded faults written', [MOODLE_TYPE[k] for k in seeded])
    row('Moodle: seeded faults verified (accepted)', [MOODLE_TYPE[k] for k, c in seeded.items() if c['status'] == 'accepted'])
    row('Moodle: faults in the 16 cases', [MOODLE_TYPE[k] for k in case_faults])
    row('Moodle: the 16 cases', [MOODLE_TYPE[c[2]] for c in cases])
    row('Moodle: the 14 cases the agents ran', [MOODLE_TYPE[c[2]] for c in agent_cases])
    p('author labels (manifest semantic_change) of the 10 case faults:', dict(Counter(seeded[k]['semantic_change'] for k in case_faults)))
    p('author labels of all 26 seeded:', dict(Counter(c['semantic_change'] for c in seeded.values())))

    p()
    p('== G. Is the fault visible in the UI at the targeted check? ==')
    def mvis(err):
        if 'attribute "disabled"' in err:
            return 'control state (disabled attribute)'
        if 'does not appear after' in err:
            return 'order of listed items'
        if re.search(r'text was (not )?found|exists in the current page|not found', err):
            return 'text or element present/absent'
        return 'NOT VISIBLE / OTHER: ' + err[:60]
    mv = {}
    for (b, s, f) in cases:
        t = next(t for t in seeded[f]['screen_targets'] if t['scenario'] == s)
        mv[(b, s, f)] = mvis(t['error'])
        p(f'  {b}.{s} {f} {MOODLE_TYPE[f]:<8} target step {t["behat_step_index"]:>2} "{t["step_text"][:60]}" -> {mv[(b, s, f)]}')
    p('Moodle 16 cases:', dict(Counter(mv.values())), '; 14 agent cases:', dict(Counter(mv[c] for c in agent_cases)))
    try:
        import payment, verified
        ca = verified.failed_assertions('coded')
        tg = defaultdict(set)
        for r in payment.runs('coded')[1]:
            if r['kind'] == 'fault':
                tg[r['caseId']].add(ca[r['trialId']])
        for k in pay:
            assert len(tg[k]) == 1
            p(f'  {k:<17} {PAY_TYPE[k]:<9} target check "{next(iter(tg[k]))[:70]}" -> {PAY_VISIBLE[k]}')
    except ImportError as e:
        p('  payment target checks not read:', e)
    p('payment 12 cases:', dict(Counter(PAY_VISIBLE.values())))

    # ------------------------------------------------ checks against the numbers in the brief and the reports
    for got, exp, what in [(len(mb), 47, 'mined changes'), (len(valid), 29, 'valid pairs (v1 report)'), (len(valid) - len(ordered), 4, 'ordering-excluded'),
                           (len(selected), 16, 'cases'), (len(sel_changes), 8, 'changes'), (len(agent_cases), 14, 'agent cases'), (len(setup), 24, 'setup-invalid runs'),
                           (len(lost), 2, 'cases lost to setup'), (st['accepted'], 24, 'seeded accepted')]:
        assert got == exp, (what, got, exp)
    p()
    p('all checks passed')
    print('\n'.join(out))


if __name__ == '__main__':
    main()
