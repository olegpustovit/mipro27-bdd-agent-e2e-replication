# /// script
# requires-python = ">=3.14"
# ///
"""Coder 2: flag omp traces where two state-changing browser actions ran concurrently and the later-issued one finished first."""
import json, sys
import digest as D
from overlap import omp_execs, U, unit_events
ACT = {'fill_form', 'click', 'type', 'press_key', 'select_option', 'navigate', 'reload', 'navigate_back', 'hover'}
def flags(idx):
    u = U[idx]
    evs = unit_events(u)
    ex = omp_execs(evs); out = []
    for n, (nm, s, e, a) in enumerate(ex, 1):
        for m, (nm2, s2, e2, a2) in enumerate(ex[:n-1], 1):
            if nm in ACT and nm2 in ACT and e2 and s and e and e2 > s and e < e2:
                out.append(f'#{m} {nm2} {a2[:60]} || #{n} {nm} {a[:60]} (#{n} ended first)')
    return out
if __name__ == '__main__':
    for idx in map(int, sys.argv[1:]):
        f = flags(idx)
        print(idx, U[idx]['scenario'], U[idx]['build_type'], len(f)); [print('   ', x) for x in f]
