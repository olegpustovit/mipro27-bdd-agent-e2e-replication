.PHONY: p4-calibrate-pay p4-test-moodle
p4-calibrate-pay:
	node stepdefs/pay/v0/calibrate.mjs

p4-test-moodle:
	node --test runner/moodle/handoff.test.mjs
