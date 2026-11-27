#!/usr/bin/env bash
# Stream E-pay measured runs: payment-app cells of the single set (healthy-v0-1, fault-v0-1/2, healthy-v2-1/2/3,
# fault-v2-1/2; 96 runs per arm). Copy of b-change1-faults/scripts/launch-campaigns.sh; changes marked FOLLOWUP-E.
# Four campaigns, one per arm, run one after another; each is wrapped in the shared run lock.
# Coded arm: campaign A's frozen step code (v0 = original b907e925..., v2 = e4daecf8...), no maintenance session.
# Usage: scripts/launch-campaigns.sh [arm ...]   (default: coded luna terra haiku)
set -u
here=$(cd "$(dirname "$0")/.." && pwd)
cd "$here"
source_campaign=campaign-20261101-04d8551
deadline=2026-11-28T12:00:00Z
log=logs/campaigns.log  # FOLLOWUP-E: logs/ in the stream folder
mkdir -p /tmp/mipro-next  # FOLLOWUP-E
arms=("$@"); [ ${#arms[@]} -eq 0 ] && arms=(coded luna terra haiku)
for arm in "${arms[@]}"; do
  case $arm in
    coded) model=gpt-6-luna;        which=maintained ;;  # model unused by the coded arm; recorded by the runner's frozen inputs
    luna)  model=gpt-6-luna;        which=runtime ;;
    terra) model=gpt-5.6-terra;     which=runtime ;;
    haiku) model=claude-haiku-5-5;  which=runtime ;;
    *) echo "unknown arm $arm" >&2; exit 2 ;;
  esac
  # FOLLOWUP-E: token guard (stop starting agent runs once measured agent tokens exceed 70M) and stop file.
  if [ -e logs/STOP ]; then echo "$(date -u +%FT%TZ) skip $arm: logs/STOP present" >> "$log"; break; fi
  if [ "$which" = runtime ]; then
    used=$(uv run --quiet scripts/token_total.py)
    if [ "$used" -gt 70000000 ]; then echo "$(date -u +%FT%TZ) skip $arm: token guard, measured agent tokens $used > 70M" >> "$log"; break; fi
  fi
  id=campaign-h-20261127-single-$arm  # FOLLOWUP-E
  echo "$(date -u +%FT%TZ) waiting for run lock $id" >> "$log"  # FOLLOWUP-E
  flock /tmp/mipro-next/run.lock bash -c 'echo "$(date -u +%FT%TZ) start $0 arms=$1 model=$2 (lock held)" >> "$3"; exec env \
    STUDY_RUNTIME_RERUN_FROM=$4 STUDY_ARMS=$1 STUDY_MODEL=$2 STUDY_ORDER_SEED=e-single-20261127-$5 \
    node scripts/run-single-pay.mjs --campaign-id "$0" --deadline "$6"' \
    "$id" "$which" "$model" "$log" "$source_campaign" "$arm" "$deadline" >> "logs/$id.out" 2>&1
  echo "$(date -u +%FT%TZ) end $id exit $?" >> "$log"
done
