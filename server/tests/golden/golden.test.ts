import { describe, expect, it } from 'vitest';
import { loadTasks, runTask } from '../../src/evalkit/golden.js';

const tasks = loadTasks();

describe('golden tasks (data-driven from eval/tasks.yaml)', () => {
  it('has the 25 tasks', () => expect(tasks.length).toBe(25));
  for (const t of tasks) {
    it(`${t.id} ${t.title}`, async () => {
      const r = await runTask(t);
      expect(r.checks.filter((c) => !c[1])).toEqual([]);
      expect(r.passed).toBe(true);
    });
  }
});
