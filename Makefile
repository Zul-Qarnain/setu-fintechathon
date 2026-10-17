.PHONY: install test lint demo api web evidence api-docs clean
BACKEND=backend
UV=cd $(BACKEND) && uv run

install:
	cd $(BACKEND) && uv sync
	@if [ -f web/package.json ]; then cd web && npm install; fi

lint:
	$(UV) ruff check . && $(UV) ruff format --check . && $(UV) mypy app

test:
	$(UV) pytest

api:
	$(UV) uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

web:
	cd web && npm run dev

api-docs:
	cd $(BACKEND) && PYTHONPATH=. uv run python scripts/gen_api_md.py ../docs/API.md

demo:
	cd $(BACKEND) && PYTHONPATH=. uv run python -m app.demo

evidence: test demo
	cd $(BACKEND) && PYTHONPATH=. uv run python -m eval.run_eval
	@echo "evidence/ regenerated"

clean:
	rm -rf $(BACKEND)/.pytest_cache $(BACKEND)/.mypy_cache $(BACKEND)/.ruff_cache $(BACKEND)/setu.db
