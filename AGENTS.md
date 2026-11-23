# Cucumber/MCP study implementation

This repository contains executable study code, not unpublished manuscript drafts.
Research Foundry is the source and sink for decisions, protocol versions, run evidence,
results and analysis. Piece: mipro27-bdd-agent-e2e. Never use client/employer material.

Preserve the same feature scenarios and browser-visible information in both arms.
The baseline uses real Cucumber step definitions; the runtime arm interprets feature
scenarios through Playwright MCP without maintained executable steps.
Keep oracles, mutation labels and baseline implementations inaccessible to the runtime
agent. Never weaken assertions, repair an injected product defect, or discard valid
failures to improve a result. Technical smoke checks are not measured study trials.
Do not start a measured campaign before Direction and Evidence plan gates permit it.
Record exact source/tool/model versions, reset state and keep bounded timeouts.
No unbounded model retries or claim of human time saved from all-agent work.

Owner decision, 2026-11-01: run the measured campaign today in `exploratory-owner-directed` mode even though the
Evidence gate is STOP ("please complete finish experiment ... we are submitting today ... this is critical"). This is
an owner decision, not a gate pass. The gate verdict stays as recorded and must not be edited, forged or bypassed in
`verifyApproval`. Every result records `status: exploratory-owner-directed` and `gatePassExists: false`, and any report
of these results says they were run without a gate pass. All other rules in this file still apply. The normal
approved campaign path stays disabled.

Owner correction, 2026-11-15: the experiment console is for localhost access from the owner's
VMs/machines using port forwarding. Bind 127.0.0.1:7878; no Tailscale identity/login requirement,
no Tailscale Serve setup, and no public listener. Human answers use the local-owner rater.
This overrides the original console proposal's Tailscale deployment instructions.

Owner correction, 2026-11-18: the gate-status reporting requirement applies to internal
reports and run provenance. Describe the paper as an exploratory case study, state which
analyses were fixed before measured runs, and label post-hoc analyses. Keep gate and
instrument development history in the replication package. For Case 1 browser-agent
results use the final-tool campaigns B through F. Retain campaign A step-definition
data and keep its discarded browser-agent records in the package. State the defective
reload exclusion once in Threats. Give the seeded fault count in the table and state once
in Design that a coding agent implemented the fault specifications and that each fault
was verified to break the expected scenario behaviour.

Owner correction, 2026-11-18: give the owner a direct, owner-only Tailscale review URL
while retaining the application's localhost listener. Guide each review from the expected
check to recorded evidence, the human grade, and a comparison with both AI reviewers.
Keep the original scenario and trace available and reveal the AI grades only after saving.
