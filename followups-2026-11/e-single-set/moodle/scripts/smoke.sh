#!/usr/bin/env bash
# Technical smoke check (not measured; separate ledger data/smoke-ledger): arm A on B04.S041 healthy + faulty, one faulty
# B04.S041 run per agent model. Each job holds the shared run lock while it runs, as measured jobs do.
set -u
cd "$(dirname "$0")/.."
job() { local label=$1; shift
  echo "$(date -u +%FT%TZ) WAIT $label" >> logs/smoke.log
  flock /tmp/mipro-next/run.lock bash -c "echo \"\$(date -u +%FT%TZ) START $label\" >> logs/smoke.log; node scripts/single-run.mjs --smoke $*" >> "logs/smoke-${label}.log" 2>&1
  echo "$(date -u +%FT%TZ) END $label exit=$?" >> logs/smoke.log; }
job A --arm A --cases B04.S041 --states healthy,fault
for M in gpt-6-luna gpt-5.6-terra claude-haiku-5-5; do job C-$M --arm C --model $M --cases B04.S041 --states fault --reps 1; done
echo "$(date -u +%FT%TZ) DONE" >> logs/smoke.log
