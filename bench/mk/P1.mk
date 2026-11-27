.PHONY: lock-check lock-check-test

lock-check:
	@./tools/lock-check

lock-check-test:
	@node --test tools/lock-check.test.mjs
