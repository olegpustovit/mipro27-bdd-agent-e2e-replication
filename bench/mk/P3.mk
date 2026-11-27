.PHONY: run verify test-p3

run:
	./runner/run-item $(RUN_ARGS)

verify:
	./tools/verify-ledger $(VERIFY_ARGS)

test-p3:
	./runner/test-p3 $(TEST_P3_ARGS)
