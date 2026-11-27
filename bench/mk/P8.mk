.PHONY: p8-check-practice p8-check-hash

p8-check-practice:
	@node prompt/check-practice.mjs

p8-check-hash:
	@observed=$$(./tools/lock-check --print-prompt-sha256) && \
	pinned=$$(node -p 'require("./env.lock.json").promptSha256') && \
	if [ "$$pinned" != "$$observed" ]; then \
		echo "Prompt SHA-256 mismatch (pinned $$pinned, observed $$observed)" >&2; exit 1; \
	fi && echo "Prompt SHA-256 matches: $$observed"
