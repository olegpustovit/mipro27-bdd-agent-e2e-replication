#!/usr/bin/env bash
# Stream B measured runs: faulty change-1 (v1) builds, plus a post-hoc healthy-v1 environment check.
# Four campaigns, one per arm, run one after another; each is wrapped in the shared run lock.
# Coded arm: campaign A's frozen v1 step definitions (1e4d5280...), restored from its events, no maintenance session.
# Usage: scripts/launch-campaigns.sh [arm ...]   (default: coded luna terra haiku)
set -u
here=$(cd "$(dirname "$0")/.." && pwd)
cd "$here"
source_campaign=campaign-20261101-04d8551
deadline=2026-11-28T12:00:00Z
log=data/logs/campaigns.log
arms=("$@"); [ ${#arms[@]} -eq 0 ] && arms=(coded luna terra haiku)
for arm in "${arms[@]}"; do
  case $arm in
    coded) model=gpt-6-luna;        which=maintained ;;  # model unused by the coded arm; recorded by the runner's frozen inputs
    luna)  model=gpt-6-luna;        which=runtime ;;
    terra) model=gpt-5.6-terra;     which=runtime ;;
    haiku) model=claude-haiku-5-5;  which=runtime ;;
    *) echo "unknown arm $arm" >&2; exit 2 ;;
  esac
  id=campaign-g-20261126-v1faults-$arm
  echo "$(date -u +%FT%TZ) start $id arms=$which model=$model" >> "$log"
  flock /tmp/mipro-next/run.lock env \
    STUDY_RUNTIME_RERUN_FROM=$source_campaign STUDY_ARMS=$which STUDY_MODEL=$model \
    STUDY_ORDER_SEED=b-change1-20261126-$arm \
    node scripts/run-v1-faults.mjs --campaign-id "$id" --deadline "$deadline" >> "data/logs/$id.out" 2>&1
  echo "$(date -u +%FT%TZ) end $id exit $?" >> "$log"
done
