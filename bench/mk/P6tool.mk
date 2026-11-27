P6TOOL_ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/../..)

.PHONY: test-p6tool
test-p6tool:
	node --test "$(P6TOOL_ROOT)/bench/tools/diff-check.test.mjs"
