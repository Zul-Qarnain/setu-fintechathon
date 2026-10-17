import pytest
import yaml

from eval.run_eval import TASKS, run_task

TASK_LIST = yaml.safe_load(TASKS.read_text(encoding="utf-8"))["tasks"]


def test_at_least_fifteen_golden_tasks():
    assert len(TASK_LIST) >= 15


@pytest.mark.parametrize("task", TASK_LIST, ids=[t["id"] for t in TASK_LIST])
def test_golden_task(task):
    r = run_task(task)
    failed = [f"{n}: {d}" for n, ok, d in r.checks if not ok]
    assert r.passed, f"{r.id} {r.title}\nreply: {r.reply}\n" + "\n".join(failed)
