.PHONY: smoke
smoke:
	./smoke/run

.PHONY: smoke-bad-login
smoke-bad-login:
	./smoke/bad-login $(SMOKE_LOGIN_ARGS)
