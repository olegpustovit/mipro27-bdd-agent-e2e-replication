.PHONY: p0-auth-smoke p0-secret-scan p0-scan-fixture p0-scan-smoke p0-container-check

p0-auth-smoke:
	node tools/p0-auth-smoke.mjs

p0-secret-scan:
	tools/secret-scan

p0-scan-fixture:
	@set -eu; \
	fixture=$$(mktemp); \
	trap 'rm -f "$$fixture"' EXIT; \
	printf 'fake %s:%s\n' 123456789 AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA > "$$fixture"; \
	code=0; tools/secret-scan "$$fixture" || code=$$?; \
	test "$$code" -eq 1

p0-scan-smoke:
	@set -eu; umask 077; \
	log=$$(mktemp); \
	trap 'rm -f "$$log"' EXIT; \
	smoke=0; node agent/smoke.mjs > "$$log" 2>&1 || smoke=$$?; \
	out=$$(sed -n 's|^Trace directory \(/tmp/p3c-smoke-[[:alnum:]]*\)$$|\1|p' "$$log"); \
	printf 'Agent smoke exit=%s\n' "$$smoke"; \
	test -n "$$out"; \
	tools/secret-scan ledger "$$out" "$$log"; \
	test "$$smoke" -eq 0

p0-container-check:
	@set -eu; \
	test -n "$$APP_IMAGE" && test -n "$$BROWSER_IMAGE" || \
	  { printf 'Set APP_IMAGE and BROWSER_IMAGE to local image references.\n'; exit 2; }; \
	for image in "$$APP_IMAGE" "$$BROWSER_IMAGE"; do \
	  docker run --rm --pull=never --network none --user 0 --entrypoint /bin/sh "$$image" \
	    -ec 'found=$$(find / -name auth.json -print -quit); test -z "$$found"'; \
	  printf '%s auth.json absent\n' "$$image"; \
	done
