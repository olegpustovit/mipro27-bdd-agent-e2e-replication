# /// script
# requires-python = ">=3.14"
# ///
"""Coder 2: locate candidate symptom evidence in payment faulty-unit traces (agent-visible tool results only).
Prints per unit: first tool result showing the case's faulty behaviour (if any) and whether the verdict/messages cite it.
Final codes are assigned by hand after reading this and, where needed, the full digest."""
import json, re, sys
from items import items, D

def url(t):
    m = re.search(r'Page URL: (\S+)', t); return m.group(1) if m else None

def find(its, pred, after=None):
    started = after is None
    for k, n, t in its:
        if not started:
            if k == 'CALL' and after(t): started = True
            continue
        if k == 'RESULT':
            r = pred(t)
            if r: return n, r
    return None

def line_with(t, pat):
    for l in t.splitlines():
        if re.search(pat, l): return l.strip()[:200]
    return None

def ev(u, its):
    s = u['scenario']
    if s == 'auth-login':
        r = find(its, lambda t: line_with(t, 'Username or password is invalid'))
        if r: return r
        return find(its, lambda t: (url(t) or '').endswith('/signin') and 'Page URL: ' + url(t), after=lambda c: re.search(r'click|press_key', c) and re.search(r'Sign In|Continue|Enter|submit', c, re.I))
    if s == 'auth-logout':
        return find(its, lambda t: url(t) and not url(t).endswith('/signin') and ('@Heath93' in t or url(t).rstrip('/').endswith('3000')) and ('Page URL: ' + url(t) + (' | @Heath93 visible' if '@Heath93' in t else '')), after=lambda c: 'click' in c and 'Logout' in c or ('press_key' in c and 'Enter' in c and False))
    if s == 'profile-name':
        return find(its, lambda t: line_with(t, r'heading "Ted P"|textbox "First Name".*: Ted\b|"First Name"[^\n]*Ted$'), after=lambda c: 'click' in c and re.search(r'Save|Apply', c, re.I))
    if s == 'profile-email':
        return find(its, lambda t: 'Must contain a valid email' not in t and line_with(t, r'button "(Save|Apply changes)"(?!.*disabled)'), after=lambda c: 'click' in c and re.search(r'Save|Apply', c, re.I))
    if s == 'bank-create':
        return find(its, lambda t: line_with(t, 'Altered Bank'))
    if s == 'bank-delete':
        return find(its, lambda t: (line_with(t, r"Waters, King and O'Reilly Bank(?! \(Deleted\))") if "Deleted)" not in t.split("Waters, King")[-1][:40] else None), after=lambda c: 'click' in c and 'Delete' in c)
    if s == 'transfer-pay':
        return find(its, lambda t: line_with(t, r'\$13\.00|13\.00'))
    if s == 'transfer-request':
        return find(its, lambda t: line_with(t, r'Paid \$12|paid Kristian|Study request.*paid|-\$12\.00'), after=lambda c: re.search(r'Request', c))
    if s == 'social-comment':
        return find(its, lambda t: line_with(t, 'Altered comment'))
    if s == 'feed-personal':
        return find(its, lambda t: (url(t) or '').endswith('/contacts') and 'Page URL: ' + url(t) + (' | heading Contacts' if 'Contacts' in t else ''), after=lambda c: 'click' in c)
    if s == 'feed-friends':
        return find(its, lambda t: (url(t) or '').endswith('/personal') and 'Page URL: ' + url(t) + (' | Personal' if 'Personal' in t else ''), after=lambda c: 'click' in c)
    if s == 'social-like':
        return None
    return None

if __name__ == '__main__':
    U = [json.loads(l) for l in open(D.HERE.parent / 'units.jsonl')]
    sel = sys.argv[1:]
    for i, u in enumerate(U):
        if u['app'] != 'payment' or u['build_type'] != 'faulty': continue
        if sel and u['scenario'] not in sel: continue
        its, raw = items(u)
        e = ev(u, its)
        ncalls = sum(1 for k, n, t in its if k == 'CALL')
        print(f"{i:03d} {u['run_set']:9} {u['scenario']:16} {u['reported_status'][:4]} calls{ncalls:>3} EV {e}")
