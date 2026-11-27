#!/usr/bin/env bash
# Measured jobs in the fixed order of the brief: arm A (16 cases x {healthy, faulty} x 1), then Luna, Terra, Haiku
# (14 cases x {healthy, faulty} x 2). One job per model x state x repetition (the clean-stop unit), order r1 healthy, r1 faulty,
# r2 healthy, r2 faulty. Waits until stream E-pay has finished (pay/README.md exists) or the coordinator's go file data/GO exists.
# Each job holds /tmp/mipro-next/run.lock only while it runs. A failed job is logged and the sequence goes on (its trials stay on
# the ledger; nothing is re-run except by the ledger's own attempt rule). No unit starts after the deadline or when it could not
# end before it (45 min margin).
set -u
cd "$(dirname "$0")/.."
mkdir -p /tmp/mipro-next logs
DEADLINE=$(date -u -d 2026-11-28T18:00:00Z +%s)
until [ -f ../pay/README.md ] || [ -f data/GO ]; do sleep 60; done
echo "$(date -u +%FT%TZ) GO pay-readme=$([ -f ../pay/README.md ] && echo yes || echo no) go-file=$([ -f data/GO ] && echo yes || echo no)" >> logs/run-plan.log
job() { local label=$1; shift
  if [ $(( $(date -u +%s) + 2700 )) -ge "$DEADLINE" ]; then echo "$(date -u +%FT%TZ) SKIP-deadline $label" >> logs/run-plan.log; return; fi
  echo "$(date -u +%FT%TZ) WAIT $label" >> logs/run-plan.log
  flock /tmp/mipro-next/run.lock bash -c "echo \"\$(date -u +%FT%TZ) START $label\" >> logs/run-plan.log; node scripts/single-run.mjs $*" >> "logs/job-${label}.log" 2>&1
  echo "$(date -u +%FT%TZ) END $label exit=$?" >> logs/run-plan.log; }
job A-healthy --arm A --states healthy
job A-fault --arm A --states fault
for M in gpt-6-luna gpt-5.6-terra claude-haiku-5-5; do for R in 1 2; do for S in healthy fault; do
  job "C-$M-$S-r$R" --arm C --model $M --states $S --reps 2 --rep $R
done; done; done
echo "$(date -u +%FT%TZ) DONE" >> logs/run-plan.log
