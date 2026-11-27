#!/usr/bin/env bash
# Scheduling change (2026-11-27 03:18 UTC, approved by the coordinator, task t_ddd9c1f45dee036c): the remaining jobs of
# scripts/run-plan.sh run in the same order, but the shared run lock is held per group instead of per job.
# Trials, order, rules, token guard and cut-off are unchanged; the ledger skips trials that already ended.
set -u
cd "$(dirname "$0")/.."
DEADLINE=$(date -u -d 2026-11-28T12:00:00Z +%s)
MODELS="gpt-6-luna gpt-5.6-terra claude-haiku-5-5"
if [ "${1:-}" = "--inner" ]; then
  shift; GROUP=$1
  job() { local label=$1; shift
    if [ "$(date -u +%s)" -ge "$DEADLINE" ]; then echo "$(date -u +%FT%TZ) SKIP-deadline $label" >> logs/run-plan.log; return; fi
    echo "$(date -u +%FT%TZ) START $label (group $GROUP, lock held)" >> logs/run-plan.log
    node scripts/replay-run.mjs "$@" >> "logs/job-${label}.log" 2>&1
    echo "$(date -u +%FT%TZ) END $label exit=$?" >> logs/run-plan.log; }
  c() { local label=$1 build=$2 st=$3 r=$4; for M in $MODELS; do job "$label-C-$M-r$r" --build $build --arm C --model $M --states $st --reps 2 --rep $r; done; }
  case $GROUP in
    g1) # P4 rep 1 remainder (A1 order): B28 post agents, B29 pre and post
        c P4-B28-post B28:post healthy 1
        job P4-B29-pre-A --build B29:pre --arm A --states healthy; c P4-B29-pre B29:pre healthy 1
        job P4-B29-post-A --build B29:post --arm A --states healthy; c P4-B29-post B29:post healthy 1 ;;
    g2) # A2 (a)-(c): P4 rep 2 B28; P5 rep 1 B28, B25; P5 rep 2 B28
        c P4-B28-pre B28:pre healthy 2; c P4-B28-post B28:post healthy 2
        job P5-B28-post-A --build B28:post --arm A --states fault; c P5-B28-post B28:post fault 1
        job P5-B25-post-A --build B25:post --arm A --states fault; c P5-B25-post B25:post fault 1
        c P5-B28-post B28:post fault 2 ;;
    g3) # A2 (d), cut first: P4 rep 2 B25, B29; P5 rep 2 B25
        c P4-B25-pre B25:pre healthy 2; c P4-B25-post B25:post healthy 2
        c P4-B29-pre B29:pre healthy 2; c P4-B29-post B29:post healthy 2
        c P5-B25-post B25:post fault 2 ;;
  esac
  exit 0
fi
for G in g1 g2 g3; do
  if [ "$(date -u +%s)" -ge "$DEADLINE" ]; then echo "$(date -u +%FT%TZ) SKIP-deadline group $G" >> logs/run-plan.log; continue; fi
  echo "$(date -u +%FT%TZ) WAIT group $G" >> logs/run-plan.log
  flock /tmp/mipro-next/run.lock "$0" --inner $G
  echo "$(date -u +%FT%TZ) END group $G exit=$?" >> logs/run-plan.log
done
echo "$(date -u +%FT%TZ) DONE grouped" >> logs/run-plan.log
