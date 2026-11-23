# Cucumber scenarios: maintained steps and MCP execution

> **Exploratory campaigns of 2026-11-01:** the data, analysis and full reproduction steps are in
> [REPRODUCE.md](REPRODUCE.md). `npm run analyze` recomputes every reported number from `data/`.
> Parts of the text below describe an earlier, superseded design (see "Executable comparison").

Implementation repository for the controlled comparison tracked in
the author's private research tracker.
The protocol, approvals, evidence and findings live there. Repository preparation
does not indicate that measured experiments have run or passed review.

The application fixture is Cypress Real-World App, an MIT-licensed educational
full-stack payment application. It represents selected application workflows;
it is not a deployed production system. Only its synthetic seed data is used.

## Local setup

Requires Node 24 and Git. From this directory:

```sh
npm ci
npm run bootstrap
npm run app
```

The browser opens `http://localhost:3000`; the API uses port 3001. Both processes
bind to loopback. Keep this terminal running. In another terminal, reset the
synthetic data with `npm run reset`. Use a fresh browser context for each case.

Bootstrap pins upstream commit `0729f68ac220f7cda4ad09c5693dba11d7c532c6`,
checks its MIT licence and applies only a loopback binding patch. The upstream
checkout and dependencies are excluded from this repository. Its licence and
copyright notices remain intact in that checkout.

## Executable comparison

The runner remains disabled while measurement-validity repairs are in progress.
The condition-independent implementation described below is a superseded disabled
prototype, not the revised cumulative maintenance experiment. Current decisions
and independent review findings are in Foundry. Its 288-row plan must not be
reported as the proposed 216-trial trajectory/probe design or as measured data.

`study/scenarios.feature` is the identical acceptance specification for both arms:
12 scenarios across authentication, profile, banking, transfers, social interaction
and transaction feeds. The email case tests rejection of invalid input. The retained
arm uses actual Cucumber.js definitions, shared UI action functions, semantic
locators and fixed assertions. The runtime arm receives the selected Gherkin and
browser UI tools, without executable definitions, source, mutation labels or oracles.

The four conditions are reference, benign UI redesign, a case-specific behavior
fault, and their combination. UI changes preserve input names, test IDs, commands
and destinations while changing ordinary wording and spacing. Every behavior
fault affects a UI-observable contract. Exact source anchors and compiled-module
markers prevent accidental or stale variants. Only declared source changes and the
bootstrap loopback patch are applied to the excluded upstream checkout; each
variant is restored in `finally`. An unexpected source edit stops execution.
This is a condition with resilient test hooks: commands, destinations, input names
and test IDs stay stable while wording and spacing change. It does not represent
comprehensive UI evolution. The retained arm may need zero maintenance. Its ledger
records per-condition triage/repair effort, including zero; diagnosing an injected
product defect is diagnostic cost and does not establish that a test repair was
necessary. No broad maintenance-superiority claim follows from this condition.

`study/manifest.mjs` fixes limits, model, cases, pairing and repetitions. Three
repetitions give 144 paired cells: 144 runtime-agent executions and 144 initial
scripted Cucumber executions. The retained arm invokes no model when its initial
run passes. A failed run permits a separately recorded repair phase, at most two
accepted implementation edits and two further scripted runs. Both action functions
and locators can be repaired; scenario text and assertions remain immutable.
Repairs start from the same retained implementation independently in every cell;
they do not accumulate across conditions or repetitions.

`scripts/ui-revisions.mjs` contains the candidate replacement revision catalog.
V1 changes control copy and public test-hook values in selected components. V2
inherits those changes and adds an Account menu plus a bank-deletion confirmation
dialog. The same declared defects compose with each version; source anchors,
AST-based hook edits and compiled-module markers guard the transformations.
These are constructed changes, not observations of industrial change frequency.
Calibration captures for all 12 healthy and 12 faulty cases per revision are
stored in Foundry. Versioned mappings, calibration evidence and the cumulative
execution driver still need independent review before measured use.
`scripts/ui-revision-compile.integration.mjs` runs five
excluded browser smoke cases; it does not establish complete behavioral fidelity.

## Verification and operation

With the application running, use:

```sh
npm test
npm run technical-check
npm run calibrate
npm run plan
npm run pilot
npm run check:attempts
npm run check:phases
npm run check:timeout
npm run check:session
```

The private UI recorder samples after DOM changes, before UI actions and every
200 ms. It records observed states, not every transient state or an agent's
internal reasoning. Both arms acknowledge pending observations before actions;
this adds observation latency to their measured execution. Document-local
sequence checks reject missing delivery through those boundaries. Samples after
a document's last acknowledged boundary remain raw audit evidence and must not
be silently used as complete phase evidence. Projection CPU telemetry excludes
event delivery, scheduling and action logging, so it is not total observer cost.
The phase evaluator is provisional and the revised maintenance sequence remains pending.
Native MCP console counts, console-log links and HTTP status metadata are retained
privately and withheld from the UI-only actor response; action errors and visible
page snapshots remain available.

`scripts/scenario-evaluation.mjs` is the provisional ordered phase evaluator with
private versioned UI mappings. It checks all 39 public Then occurrences across the 12
scenarios using acknowledged action/state evidence. It validates submit-time
UI values, ordered pre/post-reload checks, clocks and attempt ownership. The v4
capture binds profile actions and outcomes to actual document-local form/control
identities; duplicate visible mapped forms or fields remain unknown. Older v3
captures are retained as historical evidence and cannot be relabelled v4. A negative
sample is retained for independent review; it cannot automatically establish a
product defect. Trial classification rejects provisional evidence until that
review is complete. Actor-visible failure adjudication, independent review of
revised mappings and the cumulative revision driver remain unfinished, so the measured campaign
stays disabled.

`study/ui-contract.mjs` defines business terms identically for both arms and all
versions. Pay/Request and Mine/Friends identify operations and feeds, not fixed
control labels. Result text, values, URLs, counts, ordering and persistence remain
unchanged; feed selection by expected destination is disallowed. Private
`scripts/revision-calibration.mjs` bindings validate the fixture and are never
provided as measured repair artifacts or to either testing agent.

`study/cumulative-plan.mjs` specifies the disabled candidate 216-trial sequence:
120 healthy and 96 fault executions, with two shared maintenance transitions and
frozen implementations during probes. Its budget is conditional on driver-enforced
execution, fixture, maintenance and finalization bounds. The original absolute
deadline is never reset. A plan module is not an implemented campaign driver.

At submission, recorded fields mean visible, form-associated UI control values
at that event. They are not native FormData, Formik state or request payloads.
Disabled controls are identified, not silently treated as sent values; hidden
values are excluded from this UI evidence. A mapping error from the displayed
amount or recipient into the persisted result remains a possible product defect.

`scripts/calibration-capture.mjs` streams excluded, model-free UI captures. Its
state dictionary is lossless and each record pins its source hashes. Use the
bounded `scripts/evidence-buffer.mjs` transport and attach evidence through
Research Foundry before acknowledging or closing that transport. The pure
`scripts/adverse-replay.mjs` checks counterfactual alterations of a healthy
capture supplied in process memory; these are validation controls, not study
trials or regenerated application executions.

The default technical check covers the first three fixed cases on the reference
app. Calibration checks all 48 case/condition variants against a separate
post-execution browser/state observer. Its intermediate-check and visibility
coverage is incomplete. These are technical checks excluded from study data;
passing them does not establish complete measurement validity. The attempts and
timeout checks use no language model; the session check invokes the pinned agent
once and verifies private audit completion, with its execution excluded from study.
The fixed excluded pilot contains three paired cells: valid sign-in/reference,
invalid-email rejection/fault, and bank creation/UI redesign. Its six executions
and their order are printed by `npm run plan` before any pilot begins.
Read the full 288-execution plan with `node scripts/runner.mjs --plan --campaign`;
this read-only operation does not enable or launch the campaign.
No scenario may be replaced or mutation revised based on measured outcomes.

The measured campaign is disabled in code until an independent Evidence gate
passes in Research Foundry. Enabling it requires a reviewed code change and a
clean committed checkout. Set `STUDY_DEADLINE_UTC` to the original absolute deadline
recorded in Foundry; restarting cannot reset the one-day budget. The runner also
enforces a 24-hour ceiling from its start and refuses a cell without four minutes
remaining. `npm run campaign` then executes the frozen full plan;
there is no automatic retry or replacement of an infrastructure failure. A single
exclusive lock prevents concurrent resets. Remove a stale `/tmp/cucumber-mcp-study-exclusive.lock`
only after confirming that its previous owner has stopped.

Every execution resets and verifies the exact synthetic seed and gets a fresh
Chromium process. Before a variant runs, Vite must serve its current compiled
markers. Browser traffic is limited to the local application and its backend.
The runtime MCP exposes browser interaction tools, with arbitrary evaluation,
filesystem, direct HTTP, resources, application source and fixture controls unavailable.
The proxy adds a generic `browser_reload` UI action to both arms because the
pinned native MCP tool inventory has no reload action and headless keyboard
shortcuts do not provide one. It reloads the open application page and returns
the native MCP snapshot, without checking a scenario or revealing private data.
Both arms also receive the same restricted `browser_inspect` tool. A current MCP
element reference selects a visible element and up to three visible ancestors;
the tool returns a fixed allowlist of ordinary locator attributes, with bounded
values. All allowlisted attribute contents are public inspection data, including
on ancestors; the tool does not redact secrets arbitrarily encoded in them.
Private instrumentation must not put its state into these attributes. Visibility
follows Playwright layout dimensions and CSS display/visibility, rather than
opacity or screenshot occlusion. The fixed function does not read input values,
child text, private globals, arbitrary code or scenario verdicts. This supports discovery of changed
UI hooks during maintenance. It is not a scenario-specific step implementation.
The extension and its setup/inspection costs must be disclosed in the methods.
The testing agent cannot inspect the independent post-run state oracle. Private
database consistency is audit evidence; it cannot silently add a scored obligation
absent from the common browser-visible contract. Input/click witnesses are scoped
to an execution attempt. A required reload needs a new document after the relevant
action, a reload navigation entry and a non-BFCache page show; ordinary navigation
or an earlier load is insufficient. Witnesses exclude passwords. Complete
intermediate-state and executing-arm check attribution still require repair.

Retained repair functions are checked against a UI-only syntax/member policy and
executed from temporary copies under Node 24 filesystem permissions with a minimal
environment. Read access covers only copied baseline files, dependencies and
specific public OS identification files. Assertions are copied from the frozen
repository and cannot be edited through MCP. This is an experiment access-control
design, not a claim of an adversarial JavaScript security sandbox.
Mutating repair calls must return one UI primitive per awaited `World.act`
callback. Delegation and indirect calls are rejected so repairs cannot bypass
or concurrently cross the private observation boundaries.

All run records, CLI events, tool observations, edits, provider-reported model IDs,
token usage and elapsed time are emitted as newline-delimited JSON on stdout.
The runner writes no local result/analysis/trace files. Temporary workspaces contain
only code and socket/configuration state and are removed. Send stdout evidence to
Research Foundry using its MCP; do not redirect research results into this repo.
Missing CLI usage or a mismatched actual model is recorded explicitly. Initial
shared engineering/model usage is incomplete and must never be imputed as zero.
Costs describe this all-agent implementation/repair comparison, not human labor,
lifecycle break-even or production-wide reliability.

The optional `scripts/evidence-buffer.mjs -- command ...` transport retains exact
stdout/stderr bytes in bounded RAM (16 MiB by default), with ordered hash
acknowledgements after MCP persistence. It holds no Foundry credentials and writes
no evidence files. A controller can persist in-progress stream segments through
evidence-only workflow subtasks; completing a byte checkpoint does not complete a
measured execution batch. Preserve the ordered chunk index across all attachments.

Outcome fields keep unjustified passes, passes in fault conditions, witnessed false
passes, false alarms, action failures, timeouts and invalid trials distinct. A failure
becomes a `detectionCandidate` only with an independently witnessed relevant action,
a contract violation, and assertion-failure evidence. Every candidate requires
independent trace adjudication in Foundry; the runner does not report confirmed
detections. Runtime failures must identify an exact frozen assertion. No aggregate
accuracy with an empty denominator is generated by this runner.

Verdict parser version 1 accepts an exact-schema JSON object, either as the whole
response or inside one JSON/unlabelled fence with explanatory prose. It rejects
multiple fences, extra structured verdicts, duplicate keys and malformed schemas.
It retains the original response and assertion text and removes only an optional
initial `Then`/`And` when matching a frozen assertion. Ordinary prose is not assigned
a semantic verdict. Malformed output stays unresolved. Replay preserved original
stdout through `node scripts/replay-verdicts.mjs` on stdin to emit separate derived
records; replay changes decoding/classification only and runs no browser or model.
Preserve both original and replay records through Foundry MCP before freezing.

## 2026-11-01 Codex preflight stop

The owner requested a prospective 120-execution sequence ending by 18:00 UTC,
replacing the proposed 216 executions. It has **not** been implemented, frozen,
reviewed or launched. The current cumulative plan remains the disabled historical
216-execution candidate. No Evidence approval is implied by preserving that code.

Run `node scripts/codex-isolation-check.mjs` for the excluded, model-free boundary
diagnostic (expected exit 1 when isolation is not established). It sends requests
only to its loopback synthetic provider and an MCP stub; it reads no auth and
starts no application or browser. It preserves the actual offered tool inventory
and CLI events, including rejected synthetic shell calls. A second diagnostic
changes local model metadata; it is not an approved study launcher.

With the installed 0.159.3 model metadata, tested feature flags leave patch and
collaboration tools exposed. Diagnostic metadata changes remove those tools but
leave native MCP resource/discovery tools. The browser-proxy-only boundary has
not been established. The CLI JSON event schema also supplies tokens without a
model identity; requested model configuration is not verified provider identity.
Measured execution stopped before launch under the owner's fail-closed instruction.
Claude launchers remain historical disabled code, not the requested Codex treatment.
Detailed evidence and the owner instruction are saved through Research Foundry.

Local trace viewer and fixed-sample human check: `npm run console`, then open
http://localhost:7878 (see the Console section in `REPRODUCE.md` for SSH forwarding).
