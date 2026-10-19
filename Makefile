.PHONY: install test lint demo api web evidence contract seed-data clean
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

# live status+shape diff between two running backends (BASELINE vs CANDIDATE, both on fresh DBs; see server/scripts/contract_diff.ts)
contract:
	cd $(SERVER) && npm run contract

# regenerate the SYNTHETIC seed data in data/ (deterministic; byte-stable)
seed-data:
	cd $(SERVER) && npm run seed-data

clean:
	rm -rf $(SERVER)/dist $(SERVER)/setu.db
