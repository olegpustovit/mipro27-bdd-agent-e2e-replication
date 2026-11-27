# Shared rules for the mipro27-bdd-agent-e2e follow-up work (2026-11-26; restored after a host restart at 21:45 UTC)

Study: a test suite run in two ways on the same Gherkin scenarios. Coded Cucumber step definitions are compared with
an LLM browser agent (Playwright MCP) that interprets the scenarios. There are two applications: the Cypress Real
World App (the payment app, with our two interface changes) and Moodle (real scenarios and step definitions, plus 8
real past interface changes). The code and data are in ~/projects/mipro27-bdd-agent-e2e-replication. Read its
AGENTS.md, README.md and REPRODUCE.md first, then scripts/counts/*.py and results/counts-v1.1.4.txt for the current
numbers.

The paper is 6 pages, and its last reject-minded reviews were weak rejects. These are the objections we are answering
with new work:
- the agent-reported failing steps and false alarms were never checked against the run traces;
- there are no faulty-build runs after change 1;
- real Moodle changes were not replayed for the agents;
- Moodle case selection and dropout are not reported, and the faults are not summarised.

## Hard rules
- Never invent, round in your favour, or drop a number. Keep every run, including failures and invalid runs, and
  give the reason for any exclusion. A null or adverse result is a valid result; report it plainly.
- Keep oracles, fault labels and step definitions inaccessible to the browser agent. Never weaken an assertion,
  repair an injected fault, or rerun a run to get a better outcome. Retry an infrastructure failure only when the
  harness already does, and record each attempt.
- Use the same harness, models, prompts, budgets and timeouts as the original campaigns unless your stream says
  otherwise. Record exact versions (git commits, model IDs, tool versions).
- Label new runs `status: exploratory-owner-directed`, and label any analysis decided after the original runs as
  post-hoc.
- Outcomes are what a test reader expects. On a faulty build the test failed (caught) or did not (missed); on a
  healthy build a failure is a false alarm. Use the runner's or agent's own pass/fail; trace coding only refines it.
- Client and employer material never enters this work.
- Do not edit the manuscript or anything in Research Foundry. Do not git commit or push; the coordinating session
  commits. Write only inside your stream folder: ~/projects/mipro27-bdd-agent-e2e-replication/followups-2026-11/<stream>/.
  Put any new scripts there as well (Python through `uv run` with inline script metadata; Node as the repo already
  uses it).
- Host limits: no swap. Measured browser/Moodle runs from different streams must not overlap. Wrap every measured
  campaign command in `flock /tmp/mipro-next/run.lock <command>`. Analysis-only work needs no lock. Keep durable
  state in your stream folder, not /tmp: the host restarted once already.
- Deadline: results by 2026-11-28 18:00 UTC. If something cannot finish by then, stop at a clean point and report
  what is done.

## Report back (your final message)
1. What you ran or coded, with exact counts and denominators, and where the data and scripts are.
2. A results table in plain numbers.
3. Each limitation, and anything that went wrong.
4. One or two plain sentences the paper could use. No venue-flattering phrasing, and no claims beyond the data.
