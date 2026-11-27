# /// script
# requires-python = ">=3.14"
# ///
"""Coder 1: turn a compact decision file into add_codes.py TSV. Decision lines:
short_id <TAB> code <TAB> conf [<TAB> evidence-spec [<TAB> note]]; evidence-spec defaults per scenario for CORRECT, @reason otherwise."""
import sys
DEF = {
 'auth-login': ('@re', r'@re:Username or password is invalid', 'verdict cites the invalid-credentials alert and staying on sign-in'),
 'auth-logout': ('@hit', '@hit', 'verdict cites Logout leaving the authenticated home, not /signin'),
 'profile-name': ('@re', r'@re:heading "Ted P"[^\n]*', 'verdict cites displayed name staying Ted P / first name not Study'),
 'profile-email': ('@re', r'@re:button "(?:Save|Apply changes)"[^\n]*', 'Save/Apply enabled with invalid-email entered, no "Must contain a valid email" text in the results; verdict cites missing error / enabled Save'),
 'bank-create': ('@re', r'@re:[^\n]*Altered Bank[^\n]*', 'verdict cites Altered Bank listed, Study Credit Union absent'),
 'bank-delete': ('@hit', '@hit', 'verdict cites the bank still listed, not marked deleted'),
 'transfer-pay': ('@re', r'@re:[^\n]*\$13\.00[^\n]*', 'verdict cites $13.00 instead of $12.00'),
 'transfer-request': ('@re', r'@re:[^\n]*(?:Paid \$12\.00 for Study request|paid Kristian)[^\n]*', 'verdict cites the request recorded/confirmed as paid'),
 'social-like': ('@re', r'@re:- generic \[ref=\w+\][^:\n]*: "\d+"', 'count unchanged after clicking like; verdict cites no increment / Like not disabled'),
 'social-comment': ('@re', r'@re:[^\n]*Altered comment[^\n]*', 'verdict cites Altered comment shown instead of Study comment'),
 'feed-personal': ('@hit', '@hit', 'verdict cites Mine/My activity opening /contacts'),
 'feed-friends': ('@hit', '@hit', 'verdict cites Friends/People I know opening /personal'),
}
for raw in sys.stdin.read().splitlines():
    if not raw.strip() or raw.startswith('#'):
        continue
    c = raw.split('\t')
    sid, code, conf = c[:3]
    ev = c[3] if len(c) > 3 and c[3] else None
    note = c[4] if len(c) > 4 else None
    scen = sid.split('/')[-1] if not sid.startswith('moodle') else None
    if ev is None:
        if code == 'CORRECT' and scen in DEF:
            ev = DEF[scen][1]
            note = note if note is not None else DEF[scen][2]
        else:
            ev = '@reason'
    if ev.startswith('!'):
        pointer, ev = ev[1:].split('|', 1)
        print('\t'.join([sid, code, conf, pointer, ev, note or '']))
        continue
    pointer = '@hit' if ev.startswith('@hit') else '@re' if ev.startswith('@re:') else '@reason' if ev.startswith('@reason') else 'see note'
    print('\t'.join([sid, code, conf, pointer, ev, note or '']))
