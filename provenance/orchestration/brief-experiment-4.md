Continue piece `mipro27-bdd-agent-e2e` in ~/projects/cms-int. Owner decisions of 2026-11-18 (after 16:00 UTC)
change the rescue plan as below; everything else in AGENTS.md and the earlier briefs still applies.
Submission is due 29 Nov. Keep token use low: no re-runs for a better answer, estimate before each batch.

## 1. Human grading is dropped
- Stop the human-review step. Do not block on `data/human-sample.json` (0 of 70 graded). Keep the console and
  queue code; remove the human check from the plan, fact sheet and manuscript.
- The manuscript reports the two independent automated graders (first: `gpt-5.6-terra` high; second: Sonnet)
  and their agreement, and states plainly that no human check of the grades was done. Never imply one.

## 2. Fix the harness defect first (no new runs)
Campaign F (Opus, 36 runs) lost 20/36 and campaign E (`gpt-6.2-sol`) lost most of its 108 to one check,
`Private document clocks contradict acknowledged navigation order` (`scripts/witness.mjs:85`). These are not
model failures. Measured in all 20 invalid F runs: the old document's `document-barrier` event carries a
`browserTime` 0.96 to 3.16 s *later* than the new document's first `ui-state`. Every one is
`document-barrier -> ui-state`. So the barrier's timestamp is not the time the old page stopped; the rule
compares the wrong pair of events.
1. Find why the barrier is stamped late (emission on pagehide or host acknowledgment, bfcache restore on
   `browser_navigate_back`, timeOrigin difference between renderer processes). Fix the rule so it checks
   real ordering (for example host sequence order, or the last non-barrier sample of the old document),
   and keep the checks that do catch lost or reordered evidence.
2. Add a regression test built from the recorded F pattern, and keep the existing witness tests passing.
3. Recompute validity offline for every frozen campaign (A to F) with the fixed rule. Report old and new
   validity side by side per campaign. A recovered run still needs both graders: grade only recovered runs
   with `rescue-grade.sh` rules. Disclose the post-hoc validity change in one plain sentence.
4. Cold review of the fix (fresh session, told to reject, 15 min max) before step 3 results are used.

## 3. Model comparison on one harness commit
Owner question: is the runtime agent weak because of the model? Haiku (campaign D) visibly struggled to find
transactions; Opus in F did well where its runs counted (6 correct passes, 9 caught faults, 1 unresolved, no
false alarms), but on a different commit and too few valid runs to compare.
- Cells: the same 36 as F (`healthy-v0-1`, `healthy-v2-1`, `fault-v2-1` x 12 cases), one repetition, runtime
  arm only. Same commit, same prompt (`study/ui-contract.mjs` after 361357b, which gives the direct
  transaction route), same observer and fixed witness rule for every arm.
- Arms, in this order (cheapest first, stop and report if the harness invalidates more than 3 of the first
  12 runs of any arm):
  1. `claude-haiku-5-5` through omp (as D).
  2. `gpt-6-luna` medium through Codex (as A/B).
  3. `claude-sonnet-5-5` through Claude Code.
  4. `claude-opus-5-5` through Claude Code.
- Claude Code needs a new driver `scripts/drivers/claude-code.mjs` behind the existing driver interface:
  `claude -p --output-format stream-json --model <id>`, only the study MCP (`--strict-mcp-config`), only the
  study browser tools allowed, no user settings, memory, CLAUDE.md, hooks, skills or web tools, inside the
  same bwrap boundary as the other drivers. Record CLI version, requested and actual model from the stream,
  request ids and token usage. Prove the boundary with one excluded smoke run, as for Codex.
- Opus via omp cost $5.40 for 36 runs (about 53 s each). Estimate all four arms before starting, and
  record the estimate. Run under `systemd-run --user`, resumable, as in brief 2.
- Grade every arm with both automated graders. Report per arm: valid runs, true pass, false alarm, caught
  fault, action failure, no opportunity, unresolved, tokens, cost and time. Counts, not percentages of
  anything beyond the observed denominators. CLI differs between arms; state that model and CLI are
  confounded for the Claude Code and omp arms.
- Cold review of this frozen plan (15 min max) before the first measured run, per AGENTS.md (2026-11-01).

## 4. Paper and records
- Update `results/paper-numbers.txt`, the fact sheet and `paper/main.tex` (6 pages) from the new data;
  keep internal process out of the manuscript (owner correction 2026-11-18).
- Save stage records and the comparison to Foundry through the MCP. Commit to `dev` and push.
- Final report: what the defect was, how many runs it recovered per campaign, the per-arm table, cost, and
  anything left open.
