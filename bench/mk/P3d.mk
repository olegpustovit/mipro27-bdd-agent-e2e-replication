.PHONY: dashboard-sync dashboard-batch

dashboard-sync:
	./sync/dashboard $(SYNC_ARGS)

dashboard-batch:
	./sync/dashboard $(SYNC_ARGS) --batch $(RUN_ARGS)
