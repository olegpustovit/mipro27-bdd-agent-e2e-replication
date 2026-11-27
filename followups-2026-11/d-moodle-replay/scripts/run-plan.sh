#!/usr/bin/env bash
# Runs plan.md (P1, P2) and amendment A1 (P4, P5) in the fixed order. Each job holds the shared run lock only while it runs.
# A job that fails is logged and the sequence goes on (its trials stay on the ledger; nothing is re-run except by the ledger's attempt rule).
set -u
cd "$(dirname "$0")/.."
DEADLINE=$(date -u -d 2026-11-28T12:00:00Z +%s)
MODELS="gpt-6-luna gpt-5.6-terra claude-haiku-5-5"
job() { # $1 label, rest = runner args
  local label=$1; shift
  if [ "$(date -u +%s)" -ge "$DEADLINE" ]; then echo "$(date -u +%FT%TZ) SKIP-deadline $label" >> logs/run-plan.log; return; fi
  echo "$(date -u +%FT%TZ) WAIT $label" >> logs/run-plan.log
  flock /tmp/mipro-next/run.lock bash -c "echo \"\$(date -u +%FT%TZ) START $label\" >> logs/run-plan.log; node scripts/replay-run.mjs $*" >> "logs/job-${label}.log" 2>&1
  echo "$(date -u +%FT%TZ) END $label exit=$?" >> logs/run-plan.log
}
PHASE=${1:-all}
if [[ $PHASE == all || $PHASE == p1 ]]; then
for B in B04 B07 B15; do for BU in pre post; do
  job "P1-$B-$BU-A" --build $B:$BU --arm A --states healthy
  for M in $MODELS; do job "P1-$B-$BU-C-$M" --build $B:$BU --arm C --model $M --states healthy --reps 2; done
done; done; fi
if [[ $PHASE == all || $PHASE == p2 ]]; then
for B in B04 B07 B15; do
  job "P2-$B-post-A" --build $B:post --arm A --states fault
  for M in $MODELS; do job "P2-$B-post-C-$M" --build $B:post --arm C --model $M --states fault --reps 2; done
done; fi
# P4 rep 1 (A1), then the A2 order: (a) P4 r2 B28, (b) P5 r1 B28, B25, (c) P5 r2 B28, (d) P4 r2 B25, B29, P5 r2 B25.
p4() { local R=$1 B=$2; for BU in pre post; do
  [ $R = 1 ] && job "P4-$B-$BU-A" --build $B:$BU --arm A --states healthy
  [ $B = B27 ] && continue
  for M in $MODELS; do job "P4-$B-$BU-C-$M-r$R" --build $B:$BU --arm C --model $M --states healthy --reps 2 --rep $R; done
done; }
p5() { local R=$1 B=$2
  [ $R = 1 ] && job "P5-$B-post-A" --build $B:post --arm A --states fault
  for M in $MODELS; do job "P5-$B-post-C-$M-r$R" --build $B:post --arm C --model $M --states fault --reps 2 --rep $R; done; }
if [[ $PHASE == all || $PHASE == p4 ]]; then for B in B25 B27 B28 B29; do p4 1 $B; done; fi
if [[ $PHASE == all || $PHASE == p45 ]]; then
  p4 2 B28; p5 1 B28; p5 1 B25; p5 2 B28
  p4 2 B25; p4 2 B29; p5 2 B25
fi
echo "$(date -u +%FT%TZ) DONE phase=$PHASE" >> logs/run-plan.log
