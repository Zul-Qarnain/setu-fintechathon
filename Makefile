.PHONY: install test lint demo api web evidence contract seed-data clean legacy-test
SERVER=server

install:
	cd $(SERVER) && npm ci
	@if [ -f web/package.json ]; then cd web && npm install; fi

lint:
	cd $(SERVER) && npm run lint && npm run typecheck

test:
	cd $(SERVER) && npm test

api:
	cd $(SERVER) && DEMO_MODE=true npm start

web:
	cd web && npm run dev

demo:
	cd $(SERVER) && npm run demo

evidence: test
	cd $(SERVER) && npm run demo && npm run evidence
	@echo "evidence/ regenerated (sandbox_logs.jsonl, audit_export.json, demo_summary.json, eval_report.md, security_report.md)"

# live status+shape diff against the legacy Python backend (start both on fresh DBs first, see server/scripts/contract_diff.ts)
contract:
	cd $(SERVER) && npm run contract

seed-data:
	python3 data/generate_data.py

# the original Python implementation (kept for reference / differential vectors)
legacy-test:
	cd legacy/backend-py && SETU_DATA_DIR=../../data uv run pytest

clean:
	rm -rf $(SERVER)/dist $(SERVER)/setu.db
