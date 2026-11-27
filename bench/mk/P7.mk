.PHONY: p7-lint p7-payment p7-moodle p7-summary

p7-lint:
	node bugs/formal-check.mjs lint

p7-payment:
	node bugs/formal-check.mjs payment

p7-moodle:
	node bugs/formal-check.mjs moodle

p7-summary:
	node bugs/formal-check.mjs summary
