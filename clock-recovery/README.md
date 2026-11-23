# Offline recovery of Cypress traces

These derived records accompany the unchanged original Sol and Opus journals in
`moodle-ledger/runs/`. The records in this directory were reconstructed after
replacing a cross-document renderer-clock comparison with host sequence checks.
The original runner did not persist the final receipt after the clock-order
rejection. Each recovery record identifies the terminal UI sample used to infer
that boundary, the original campaign, and the original record digest.

The two judgment files per derived campaign cover 16 Sol traces and 20 Opus
traces. Match Terra by trial ID and Sonnet by the opaque ID derived from the
derived campaign and trial ID. Retain the judgments separately. The two sets
agree on all 16 Sol traces and 19 of 20 Opus traces in this directory. The
remaining 72 initial Sol failures were outside the recovery.

Verify the six JSONL files from this directory with `sha256sum -c SHA256SUMS`.
