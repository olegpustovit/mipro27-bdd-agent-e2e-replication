# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
import sys
import re
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import trace_view as v

for idx,u in enumerate(v.units(),1):
    if sys.argv[1] != u['run_set']:
        continue
    if len(sys.argv)>2 and idx not in set(map(int,sys.argv[2:])):
        continue
    steps,msgs,raw,_ = v.payment_trace(u) if u['app']=='payment' else v.moodle_trace(u)
    print(idx,u['build_type'][0],u['scenario'],u['fault_id'],u['reported_failing_step_number'],u['reported_reason'] or u['run_error'])
    if u['app']=='moodle' and u['fault_id']:
        print(' INTENT',u['fault_change'])
    pat=v.SYMPTOM.get(u['scenario'],'')
    if u['scenario']=='social-like':
        pat=r'button ".*?(?:like|React).*?"[^\n]*|Page URL: \S*/transaction/\S+'
    if u['scenario']=='auth-login':
        pat += r'|Page URL: \S*/signin|(?:password|username)[^\n]*(?:required|invalid)'
    if u['scenario']=='profile-email':
        pat += r'|button "Apply changes"[^\n]*'
    if u['app']=='moodle':
        words = [re.escape(x) for x in v.words_for(u) if x]
        pat = '|'.join(words + [r'disabled|Error|Page URL|not found|Permission|heading'])
    results=[]
    calls=[]
    n=0
    last=''
    call=''
    for kind,num,name,body in steps:
        if kind=='call':
            n=num
            call=name.split()[0]+' '+body
            calls.append((n,call))
        if kind=='result':
            hit=[]
            for line in body.splitlines():
                line=line.strip()
                if re.search(pat,line,re.I) and not line.startswith(('- await','await','|', 'at ')):
                    if line not in hit:
                        hit.append(line[:160])
            s=' | '.join(hit[:16 if len(sys.argv)>2 else 7])
            if s and (s!=last or len(sys.argv)>2):
                results.append((n,call,s))
                last=s
    for n,c,s in results[-(100 if len(sys.argv)>2 else (4 if u['app']=='moodle' else 2)):]:
        print(f' #{n}',c[:140] if len(sys.argv)>2 else '',s[:340] if len(sys.argv)==2 else s)
    if not raw:
        print(' NO FINAL', (msgs[-1][:270] if msgs else ''))
