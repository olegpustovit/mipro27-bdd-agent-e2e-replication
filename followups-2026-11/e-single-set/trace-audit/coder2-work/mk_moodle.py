# Coder 2 helper: turn moodle-decisions.tsv (Mxxx code conf pointer evidence note) into a batch with full unit ids.
import sys
ids = {}
for l in open('moodle-list.txt'):
    if l.startswith('M'):
        p = l.split('\t'); ids[p[0]] = p[1]
src = sys.argv[1]
for l in open(src):
    l = l.rstrip('\n')
    if not l.strip() or l.startswith('#'): continue
    c = l.split('\t'); c[0] = ids[c[0]]
    print('\t'.join(c))
