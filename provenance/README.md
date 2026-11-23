# Provenance

Records of how the 2026-11-01 exploratory campaigns were run and judged. Nothing here is executed by
`npm run analyze` except `orchestration/analyze.mjs` and `orchestration/derived.mjs`.

## adjudication/

One fresh Codex session (`gpt-5.6-terra`, reasoning effort high, Codex CLI 0.159.3) per campaign.

- `<campaign>.prompt.md`: the exact task text the adjudicator received. The repository's `AGENTS.md` was
  also injected by Codex as standing instructions.
- `<campaign>.codex-rollout.jsonl.zst`: the full session, copied from `~/.codex/sessions/2026/11/01/` on
  host `main`. It holds every command it ran and every file edit, including the lost `/tmp` summaries.
  In the replication package the two provider account identifiers in each session header read
  `<redacted>`, and the author's home-directory prefix reads `<home>`.

| Campaign | Session file |
|---|---|
| A `campaign-20261101-04d8551` | `rollout-2026-11-01T13-32-04-01a19718-716d-7d53-9dec-d32a94fc3b77.jsonl` |
| B `campaign-b-20261101-02f4758` | `rollout-2026-11-01T14-19-06-01a19743-7f10-78a0-80d1-99ab73a6e484.jsonl` |
| C `campaign-c-20261101-f7857ea` | `rollout-2026-11-01T17-08-27-01a197de-8c46-7f70-9aa7-32a7addb9f4e.jsonl` |
| D `campaign-d-20261101-2b2589f` | `rollout-2026-11-01T19-00-26-01a19845-0f6b-7462-9ed2-9f6132b10cf3.jsonl` |

## orchestration/

Recovered on 2026-11-15 from the Claude Code session that ran the campaigns
(`~/.claude/projects/-<home>-agents-researcher/60a06e62-f1e8-4a87-9d99-9000adbb9c32.jsonl` on `main`).
The scripts lived in that session's `/tmp` scratchpad, which no longer exists. Each file is the exact content
of the session's last `Write` to that path. Hard-coded paths are left as they were.

- `analyze.mjs`, `derived.mjs`: per-campaign counts and derived estimates (used by `npm run analyze`).
- `brief-adjudicate.md`: adjudicator prompt template (`CAMPAIGN_ID` placeholder).
- `adjb.sh`, `campaignc.sh`, `relaunch.sh`, `takeover.sh`, `release041.sh`: launchers for adjudication and campaigns.
- `minute*.sh`: progress monitors (no effect on data).
- `patch-b.mjs`: the campaign B `browser_reload` change, as applied before commit `02f4758`.
- `cucumber-resume-test.sh`, `cucumber-smoke4.mjs`: excluded pre-campaign checks.
- `brief-experiment*.md`: briefs given to the Codex session that prepared the runner.
- `launch-and-patch-commands.log` was planned to hold every shell command from that session that launched
  a campaign or adjudicator, or patched files. It was not preserved and is not in the replication package.
