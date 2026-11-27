# Coder 1: trace audit of the single-set browser-agent failures

You are coder 1. Work only in this folder (`coder1-work/`). Run commands from the repository root
(`~/projects/mipro27-bdd-agent-e2e-replication`). Post-hoc analysis: no runs, no model calls, no changes to data.

1. Start only when `../UNITS_READY` exists. Check the unit files first:
   `(cd followups-2026-11/e-single-set/trace-audit && sha256sum -c units.SHA256SUMS)`.
2. Read `../coding-rule.md` in full. It is the stream A1 rule, copied unchanged. Two things differ here, and they are
   facts about the unit set, not changes to the rule:
   - The rule text says "386 units" and "campaigns B to D". This set has its own unit count (`../units.jsonl`). The
     payment app's agent messages are in `paths.log` (`events.jsonl.zst`) for every payment unit.
   - Payment run sets are `pay-Luna`, `pay-Terra` and `pay-Haiku` (v0 and v2 from stream E-pay, v1 from stream B).
     Moodle run sets are `moodle-Luna`, `moodle-Terra` and `moodle-Haiku`.
3. Code **every** unit in `../units.jsonl`, blind, from its recorded trace (`paths.trace`, and `paths.log` for agent
   messages). Use the unit fields allowed by the rule. Use the observer samples (`record.witness`) only as the rule's
   supporting evidence, and say so in the note.
4. Write your codes only through `add_codes.py`. It appends to `coder1-work/codes-coder1.jsonl`:
   ```sh
   uv run followups-2026-11/e-single-set/trace-audit/add_codes.py --coder 1 < followups-2026-11/e-single-set/trace-audit/coder1-work/batch.tsv
   ```
   The input is tab-separated: `unit  code  confidence  pointer  evidence  [note]` (see the script's docstring). It
   refuses wrong code families and re-coding. Keep your working notes and batches in this folder.
   Reading aid: `uv run followups-2026-11/e-single-set/trace-audit/trace_view.py --unit '<unit_id>' --full 999`
   (also `--set`, `--type`, `--brief`, `--line`, `--grep`). It only reformats recorded traces.
   Check your file: `uv run followups-2026-11/e-single-set/trace-audit/summarize.py followups-2026-11/e-single-set/trace-audit/coder1-work/codes-coder1.jsonl`.
5. **Never open:**
   - the other coder folders (`coder1-work/`, `coder2-work/`, `coder3-work/`, apart from your own);
   - automated grades or verdict-rule outputs: `adjudication.jsonl`, `second-grader.jsonl`, clock-recovery grades,
     `record.observation` (`defectObserved`, `violatedPredicates`, check `status`), the records' `failedAssertionVerified` /
     `normalizedFailedAssertion` / `analysisStatus`, and the Moodle records' `failingStepVerified` / `behatStepIndex`;
   - count outputs and outcome classes: any `results/` folder (`e-single-set/pay/results/`, `e-single-set/moodle/`
     results and README, `b-change1-faults/results/` and README, the repository's `results/`);
   - earlier codes: everything in `followups-2026-11/a-trace-audit/` (codes, results and coder folders);
   - the paper (manuscript) and Research Foundry.
6. When every unit is coded, say so to the coordinator with the line count and the sha256 of `codes-coder1.jsonl`.
