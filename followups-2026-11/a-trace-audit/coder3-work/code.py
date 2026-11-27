# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
import json
import re
import sys
from collections import Counter
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import trace_view as v

payment_wrong = {11,12,23,24,43,44,55,56,69,70,81,82,98,99,110,137,158,169,170}
payment_ambiguous = {1,2,27,28,29,30,31,33,34,59,60,85,86,88,89,116,141,142,144,148}
payment_app = {114,143,145,147,173,174,200,220}
payment_env = {257}
moodle_correct = {
    'X014': (set(range(271,277)) | {292,293,295,300,303,305,310,312,313,314,315,318}, r'button.*Mark (?:Test choice manual as done|Music history as done|as done)(?!.*disabled)'),
    'X010': ({280,319,323,336,341}, r'The search currently only finds frog-related content'),
    'X025': ({332,351,353}, r"can't block Student 2"),
    'X021': ({320,360,361,381,382}, r'activity selected uses a grading method'),
    'X022': ({324,362,365}, r'(?:link|paragraph|heading|text|generic).*[:"]\s*teacher1(?:["\s]|$)'),
    'X018': ({306,307,352,378,379}, r'Criterion max score can not be empty'),
}
moodle_confirm = {333,355,357}
moodle_empty_alert = {283,321,337,345}
moodle_unclear = {308,375}
moodle_ambiguous = {289,290,299,301,302,304,344,346,347,348,369,373}
moodle_agent = {278,279,284,291,316,325,327,329,331,338,356,358,359}
moodle_app = {
    277:r'Page URL: .*course/view',
    311:r'Criterion max score can not be empty|textbox "Name".*Marking guide 1',
    317:r'Criterion max score can not be empty|textbox "Name".*Marking guide 1',
    335:r'text: Student 2',
    370:r'heading "Add a block"',
    371:r'heading "Add a block"',
}
moodle_env = {374,376,380,385,386}

payment_pattern = {
    'auth-login':r'Username or password is invalid',
    'auth-logout':r'heading "@Heath93"',
    'profile-name':r'textbox "First Name".*: Ted$|heading "Ted P"',
    'profile-email':r'textbox "Email".*: invalid-email$',
    'bank-create':r'Altered Bank',
    'bank-delete':r'paragraph.*Waters, King and O.Reilly Bank(?!.*Deleted)',
    'transfer-pay':r'(?:heading.*Paid \$13\.00 for Study payment|generic.*-\$13\.00)',
    'transfer-request':r'heading.*Paid \$12\.00 for Study request|paragraph.*Ted Parisian paid Kristian Bradtke',
    'social-comment':r'generic.*Altered comment',
    'social-like':r'generic.*: "0"$',
    'feed-friends':r'Page URL: .*/personal$',
    'feed-personal':r'Page URL: .*/contacts$',
}

def code_unit(i,u):
    pay=u['app']=='payment'
    steps,msgs,raw,rec = v.payment_trace(u) if pay else v.moodle_trace(u)
    hits=[]
    call=0
    for kind,n,name,body in steps:
        if kind=='call':
            call=n
        elif kind=='result':
            for line in body.splitlines():
                line=line.strip()
                if line.startswith(('- await', 'await', '|', '\x1b')) or not line:
                    continue
                hits.append((call,line))
    trace='ledger tool result' if pay else 'Moodle event-stream tool result'
    verdict='rawResponse' if pay else 'Moodle final agent message'
    evidence = u['reported_reason'] or raw or u.get('run_error') or ''
    pointer=verdict
    note=''
    confidence='medium'
    def quote(pattern, require_next=None):
        nonlocal evidence,pointer
        options=[(j,line) for j,(n,line) in enumerate(hits) if re.search(pattern,line,re.I) and (not require_next or any(n2==n and re.search(require_next,s,re.I) for n2,s in hits[j+1:j+4]))]
        if options:
            j,evidence=options[-1]
            pointer=f'{trace} after call #{hits[j][0]}'
            return True
        return False
    if pay and u['build_type']=='faulty':
        if i in payment_wrong:
            code='WRONG-REASON'
            confidence='high'
            note='Stopped before performing the targeted transaction action.'
        elif i==117:
            code='UNCLEAR'
            note='The final raw observer UI state shows the invalid-credentials alert, but the agent attributes the failure to the form staying filled and never cites the alert.'
            assert any(a['text']=='Username or password is invalid' for a in rec['witness']['states'][-1]['alerts'])
            quote(r'Page URL: .*/signin$')
        else:
            found=quote(payment_pattern[u['scenario']])
            code='CORRECT' if found else 'UNCLEAR'
            confidence='high' if found else 'low'
            if u['scenario']=='profile-name':
                confidence='medium'
                note='The old displayed name persisted after submission.'
            if u['scenario']=='social-like':
                confidence='medium'
                note='Compare the count and adjacent button before and after the click.'
            if not found:
                note='The reported effect could not be confirmed in a matching browser snapshot.'
    elif pay:
        if i in payment_ambiguous:
            code='SCENARIO-AMBIGUOUS'
            note='Read “When I open transaction [ID]” with “Use only the visible application UI.” The feed did not label visible entries by ID.'
        elif i in payment_app:
            code='APP-BEHAVIOUR'
            patterns = {
                'profile-name':r'heading "Ted P"',
                'social-like':r'generic.*: "0"$',
                'social-comment':r'(?:heading|generic).*Comments',
                'auth-logout':r'heading "@Heath93"',
                'bank-delete':r'paragraph.*Waters, King and O.Reilly Bank',
                'auth-login':r'Page URL: .*/signin$',
            }
            quote(patterns.get(u['scenario'],r'Page URL: .*/signin$'))
        elif i in payment_env:
            code='ENVIRONMENT'
            evidence=u['run_error'] or u['reported_reason']
            pointer='unit run error, corroborated by rawResponse'
        else:
            code='AGENT-ERROR'
            if i==87:
                quote(r'generic.*: "1"$', r'button \[disabled\]')
                note='The click beside the comment input activated Like. Its count increased and the button became disabled. The comment was not submitted.'
                confidence='high'
            elif i==146:
                quote(r'Page URL: http://localhost:3000/$')
                assert rec['witness']['states'][-1]['identity']['text']=='@Heath93'
                note='The last click reached the home URL. The final raw observer UI state shows visible @Heath93 on that page.'
            elif i in range(213,220):
                note='The raw reply reports pass but wraps its JSON in prose. The verdict parser rejects the response format.'
                evidence=raw
                confidence='high'
    elif u['build_type']=='faulty':
        group,pattern=moodle_correct.get(u['fault_id'],(set(),None))
        if i in (306,307):
            pattern=r'textbox "Name".*: Marking guide 1'
            note='The post-save editor snapshot retains the guide name but shows no criterion-name validation.'
        if i in moodle_confirm:
            pattern=r'Are you sure you want to block Teacher 1'
        if i in moodle_empty_alert:
            pattern=r'(?:^- alert(?: \[ref=[^\]]+\])?:?$|dismiss notification)'
        if i in group or i in moodle_confirm or i in moodle_empty_alert:
            found=quote(pattern)
            code='CORRECT' if found else 'UNCLEAR'
            if not found:
                note='Could not confirm the cited output in the tool-result lines.'
            elif u['fault_id']=='X014':
                confidence='high'
        elif i in moodle_unclear:
            code='UNCLEAR'
            quote(r'Criterion name can not be empty')
            note='The message is consistent with the mutation or a remaining empty criterion, and the verdict also gives another cause.'
        else:
            code='WRONG-REASON'
            confidence='high'
            if i==350:
                quote(r'(?:Name.*invalid|Required)')
                note='Name itself was marked Required. The targeted criterion validation was not reached.'
            else:
                note='Stopped at a prerequisite or reported a failure before the targeted observable effect.'
    else:
        if i in moodle_ambiguous:
            code='SCENARIO-AMBIGUOUS'
            if i in (289,290):
                note='The step specifies “Block” as a “link” in “header-container”, while the UI offers a “Block user” menu item.'
                quote(r'menuitem "Block user"')
            else:
                step=next((s for s in u['scenario_steps'] if 'unaddableblocks' in s),'')
                note=f'Step “{step}” requires admin configuration. Only teacher sessions were available under the UI constraints.'
        elif i in moodle_app:
            code='APP-BEHAVIOUR'
            quote(moodle_app[i])
        elif i in moodle_env:
            code='ENVIRONMENT'
            note='The run reached its tool-call limit while still executing the scenario.'
        else:
            assert i in moodle_agent, i
            code='AGENT-ERROR'
            if i==291:
                quote(r'paragraph.*Cannot send messages')
                note='The plural on-screen phrase contains the requested text.'
            elif i==284:
                quote(r'button "Open block drawer"')
                note='Saved the new block but did not reopen the drawer to inspect the block contents.'
            elif i==316:
                quote(r'row .*Click to edit criterion name')
                note='The snapshot offers editable criterion cells despite the failed exact-text lookup.'
            elif i in (338,358,359):
                note='Repeated lookups, snapshots or waits consumed the available calls before the required actions were complete.'
            elif i==278:
                quote(r'Mark.*as done.*disabled')
                note='The final message acknowledges the last assertion passed.'
    evidence=' '.join(evidence.split())[:380]
    assert evidence, (i,u['unit_id'])
    return dict(unit_id=u['unit_id'],code=code,evidence=evidence,pointer=pointer,confidence=confidence,note=note)

def main():
    records=[]
    counts=Counter()
    for i,u in enumerate(v.units(),1):
        record=code_unit(i,u)
        records.append(record)
        counts[u['build_type'],record['code']]+=1
    assert len({r['unit_id'] for r in records})==386
    Path('codes-coder3.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in records))
    for k,count in sorted(counts.items()):
        print(*k,count)

if __name__=='__main__':
    main()
