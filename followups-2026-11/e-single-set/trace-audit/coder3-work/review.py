import json
import re
import sys
from pathlib import Path

WORK = Path(__file__).resolve().parent
sys.path.insert(0, str(WORK.parent))
import trace_view as tv

units = dict(enumerate(tv.units(), 1))

PAY = {
    'auth-login': r'Username or password is invalid|heading "Sign in"|textbox "Username"|@Heath93',
    'auth-logout': r'Page URL: |Logout|Sign Out|Log out|Sign in',
    'profile-name': r'textbox "First Name"|heading "(?:Ted|Study) P"|invalid',
    'profile-email': r'textbox "Email"|valid email|button "(?:Save|Apply changes)',
    'bank-create': r'Altered Bank|Study Credit Union',
    'bank-delete': r"Waters, King and O'Reilly Bank|button \"(?:Delete|Remove|Archive)|\(Deleted\)",
    'transfer-pay': r'Paid \$1[23]|\$13\.00|Study payment',
    'transfer-request': r'Paid \$12|Study request|Ted Parisian (?:paid|requested) Kristian',
    'social-like': r'Page URL: .*transaction|Like|like|Transaction Detail|data-test=transaction-like',
    'social-comment': r'Page URL: .*transaction|Altered comment|Study comment|Transaction Detail',
    'feed-personal': r'Page URL: .*\b(?:contacts|personal|public)\b|tab "[^"]*" \[selected\]',
    'feed-friends': r'Page URL: .*\b(?:contacts|personal|public)\b|tab "[^"]*" \[selected\]',
}
MOODLE = {
    'X014': r'button "Mark |Make a choice|Completion requirements',
    'X010': r'frog|searchbanner|Display search information|Changes saved|Section error|No search',
    'X025': r'Block|Cannot send|Student [12]|Teacher [12]|no results',
    'X026': r'Content bank|Navigation block|admin|configuration',
    'X018': r'Criterion|Changes saved|Save as draft|Marking guide|No assignment|No courses',
    'X021': r'Activity results|configure|Add a block|drawer|Turn editing',
    'X020': r'Delete submission|Change phase|assessment|allocate|Submit|Workshop',
    'X022': r'Logged in user|Teacher One|teacher1|Add a block',
}
ERR = r'Error: |ERROR|maximum (?:number|tool)|TimeoutError|tool call limit|Error code|No courses were found|not found'
def trace(u):
    steps, messages, raw, _ = (tv.payment_trace(u) if u['app'] == 'payment' else tv.moodle_trace(u))
    label = None
    call_labels = {}
    message_index = 0
    for kind, num, name, body in steps:
        if kind == 'call':
            label = f'#{num} {name}'
            if ' <' in name:
                call_labels['<' + name.split(' <', 1)[1]] = label
            yield 'C', label, body
        elif kind == 'result':
            yield 'T', 'tool result ' + str(call_labels.get(name, label)), body
        elif kind == 'msg':
            message_index += 1
            yield 'M', f'trace message {message_index} ' + body.split(']',1)[0] + ']', body.partition('] ')[2]
    for k, body in enumerate(messages, 1):
        yield 'M', f'agent event log message {k} ' + body.split(']',1)[0] + ']', body.partition('] ')[2]
    if raw:
        for match in re.finditer(r'\{', raw):
            try:
                obj, _ = json.JSONDecoder().raw_decode(raw[match.start():])
            except ValueError:
                continue
            if isinstance(obj, dict) and isinstance(obj.get('reason'), str) and 'status' in obj:
                yield 'V', ('record.agent.rawResponse, reason' if u['app'] == 'payment' else 'final trace message, reason'), obj['reason']
        yield 'V', ('record.agent.rawResponse' if u['app'] == 'payment' else 'final agent message in trace blob'), raw

def one(s):
    return s.splitlines()[0][:190] if s else ''

def review(n, pattern=None, tail=3, detailed=False):
    u = units[n]
    print(f'{n} {u["unit_id"]} [{u["build_type"]} {u["reported_failing_step_number"]}/{u["target_step_numbers"]}]')
    pattern = pattern or PAY.get(u['scenario']) or MOODLE.get(u['fault_id']) or '|'.join(re.escape(w) for w in tv.words_for(u))
    pat = re.compile(pattern + '|' + ERR, re.I)
    calls, hits, messages = [], {}, []
    for kind, label, body in trace(u):
        if kind == 'C':
            calls.append((label, body))
        elif kind == 'T':
            ls = list(dict.fromkeys(x.strip() for x in body.splitlines() if pat.search(x)))
            if ls:
                hits[label] = ls[:16 if detailed else 4]
        elif kind == 'M':
            if body and not body.startswith('{"verdict"'):
                messages.append(one(body))
    if detailed:
        for s in u['scenario_steps']:
            print(' ',s)
        print(' ',u['fault_change'])
    print(' C', ' / '.join(label.split(' <')[0].split(' ')[0] + ' ' + body[:110] for label,body in (calls if detailed else calls[-tail:])))
    for label, ls in list(hits.items())[-(100 if detailed else 4):]:
        print(' ', label.split(' ')[2], ' / '.join(x[:180] for x in ls))
    print(' R', (u['reported_reason'] or '')[-(1000 if detailed else 250):])
    if detailed or not u['reported_reason']:
        print(' M', ' / '.join(messages[-(8 if detailed else 2):]))
    if u.get('run_error'):
        print(' E', one(u['run_error']))

def batch():
    codes = dict(c='CORRECT', w='WRONG-REASON', u='UNCLEAR', a='AGENT-ERROR', e='ENVIRONMENT',
                 s='SCENARIO-AMBIGUOUS', b='APP-BEHAVIOUR')
    levels = dict(h='high', m='medium', l='low')
    rows = []
    for line in sys.stdin:
        if not line.strip() or line.startswith('#'):
            continue
        nums, spec, selector, *notes = line.rstrip('\n').split('|', 3)
        for n in map(int, nums.split()):
            u = units[n]
            kind = selector[0]
            needle = selector[1:]
            opts = [(label, body) for k, label, body in trace(u) if k in kind]
            # On demand, copy the reported reason only when located verbatim in trace.
            if needle == 'R':
                needle = u['reported_reason']
                if needle and len(needle) > 185:
                    needle = needle[:185]
            assert needle, (n,selector,opts[-2:])
            matches = [(label, ln, ln.index(needle)) for label, body in opts
                       for ln in body.splitlines() if needle in ln and (kind != 'T' or needle != ': "0"' or 'Page URL: http://localhost:3000/transaction/1xfcAhNDZK4' in body)]
            assert matches, (n,selector,[(label,one(b)) for label,b in opts[-3:]])
            pointer, ln, pos = matches[-1]
            evidence = ln.strip() if len(ln.strip()) <= 220 and '\t' not in ln else needle
            assert '\t' not in evidence
            rows.append('\t'.join([u['unit_id'], codes[spec[0]], levels[spec[1]], pointer, evidence, *notes]))
    print('\n'.join(rows))

if __name__ == '__main__':
    args = sys.argv[1:]
    if args[0] == 'batch':
        batch()
    elif args[0] == 'index':
        for n,u in units.items():
            print(n, u['run_set'], u['build_type'], u['scenario'], u['unit_id'])
    elif args[0].isdigit():
        for n in args:
            review(int(n), detailed=True)
    else:
        app, scenario, *typ = args
        for n,u in units.items():
            if (app in (u['app'],u['run_set']) and scenario in ('all',u['scenario'],u['fault_id'])
                and (not typ or u['build_type'] == typ[0])):
                review(n)
