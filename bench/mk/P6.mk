.PHONY: gate test-p6

gate:
	./runner/run-gate

test-p6:
	node --test runner/gate.test.mjs
