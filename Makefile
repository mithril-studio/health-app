.PHONY: test test-backend test-web test-worker test-ops build-web smoke

test: test-backend test-web test-worker test-ops

test-backend:
	cd backend && .venv/bin/pytest -q

test-web:
	cd web && npm test && npm run typecheck

test-worker:
	cd worker && npm test

test-ops:
	python3 -m unittest discover -s ops/tests -v

build-web:
	cd web && npm run build

smoke:
	python3 deploy/smoke.py
