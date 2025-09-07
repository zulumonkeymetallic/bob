test-e2e:
	npx playwright test

test-e2e-headed:
	npx playwright test --headed

test-e2e-ci:
	npx playwright test --reporter=line,junit

