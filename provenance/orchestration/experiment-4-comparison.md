# Experiment 4 selected Cypress model comparison

Compare the as-configured runtime workflows on the same 36 selected cells. The software, browser, fixture, prompt, observer, evaluation rule, and cell ordering are shared. The CLI and model together define an arm.

| Order | Requested model | CLI |
|---|---|---|
| 1 | claude-haiku-5-5 | omp |
| 2 | gpt-6-luna, medium effort | Codex |
| 3 | claude-sonnet-5-5 | Claude Code |
| 4 | claude-opus-5-5 | Claude Code |

Each arm uses all 12 cases in healthy-v0-1, healthy-v2-1, and fault-v2-1, one repetition each, runtime arm only. Use the same order seed `mipro-exp4-20261118` and frozen maintenance source campaign `campaign-20261101-04d8551`. Record the exact CLI build, requested and provider-observed model, prompt/source and fixture digests, study ledger identity, and absolute deadline at freeze. Report CLI confounding. Exclude the boundary smoke and carry forward no trial from the recovery audit into this comparison.

Launch the arms serially under the study task service with resumable journals. If more than three of the first 12 terminal executions in an arm are infrastructure-invalid, end the comparison and retain the results to that point. Never repeat a terminal trial. A deadline, unsafe cleanup or incomplete grader prevents the missing cell from counting as a result. Classifications come from the two existing automated procedures. Retain their results separately and report their agreement on shared evaluated rows. Human grades are outside the analysis.

## Planning estimate

Prior Cypress healthy-run suite estimates in the manuscript imply roughly 0.37M tokens per Haiku scenario and 0.13M per Luna scenario. At 36 each that is about 13.5M and 4.7M tokens, conditional on comparable starting and stopping behavior. Earlier Opus through omp used 6.27M metered tokens and $5.40 across 36 attempts, including infrastructure-invalid attempts. Provision 6–14M tokens per Claude Code arm as a rough envelope using the earlier Opus and Haiku rates. No same-driver cost or token measurement exists yet for Sonnet or Opus. For an initial spend estimate, $5.40 per Claude Code arm is an Opus-through-omp reference, with an allowance of up to twice that because the CLI and reached steps may differ. Dollar amounts for Haiku and Luna require their recorded usage prices or CLI cost, and actual cost remains separate from the estimate.

## Release checks

Run a single excluded Claude Code smoke to verify the driver reports the requested model, exposes only the study browser MCP, retains trace evidence, and produces metering. Verify the same harness commit and configuration before any measured trial. A fresh reader must challenge the frozen plan. No measured arm can start until both checks are complete.

Historical selected-cell estimates calculated before launch from the same 36 cells: Haiku D used 13,247,461 tokens, $0.326 reported and 37.3 minutes of aggregate trial wall time. Luna B used 4,995,945 tokens and 16.0 minutes, with no reported dollar cost. The excluded Sonnet auth-login smoke ran in 10.44 seconds, used 36,876 tokens and cost $0.0482. This simple smoke establishes the CLI integration and is not representative enough to multiply over the suite. Reserve the frozen trial timeout for execution planning.

Excluded smoke on driver commit a76dafb printed only the thirteen study MCP browser tools, zero skills, and one MCP server named study. It recorded the exact requested Sonnet model, five request/response identifiers, a completed private audit, and the final 94-event document acknowledgment. The driver cannot attest an unavailable base system-prompt hash; the study prompt and data contract are source-pinned.
