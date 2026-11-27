.PHONY: p3c-test p3c-smoke

p3c-test:
	node --test agent/*.test.mjs

p3c-smoke:
	node agent/smoke.mjs
