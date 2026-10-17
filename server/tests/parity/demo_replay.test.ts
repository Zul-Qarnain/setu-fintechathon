import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runDemo } from '../../src/demo.js';

type Step = Record<string, unknown> & { step: string };
const py = (
  JSON.parse(
    readFileSync(new URL('../fixtures/py_demo_summary.json', import.meta.url), 'utf-8')
  ) as { steps: Step[] }
).steps;

/** Shape-parity (not byte-parity) replay of the Python demo transcript against the TS backend. */
describe('TS demo vs Python demo transcript', () => {
  it('same steps, same decisions, same key fields', { timeout: 60000 }, async () => {
    const ts = (await runDemo(false)).steps as Step[];
    expect(ts.map((s) => s.step)).toEqual(py.map((s) => s.step));
    // fields that must match exactly (decisions, tiers, states, error codes); ids/hashes/timestamps are volatile and excluded
    const stable = [
      'status',
      'guardian',
      'amount',
      'blocked',
      'intent',
      'tier',
      'required',
      'still_required',
      'state',
      'flags',
      'doc_status',
      'why',
      'failure',
      'replay',
      'file',
      'approve_attempt',
      'ok',
      'checked',
      'broken_at_seq',
      'reason',
      'reply_validated',
      'users',
      'obligations',
      'amount',
    ];
    const diffs: unknown[] = [];
    py.forEach((p, i) => {
      for (const k of stable) {
        if (k in p && JSON.stringify((ts[i] as Step)[k]) !== JSON.stringify(p[k]))
          diffs.push({ i, step: p.step, key: k, py: p[k], ts: (ts[i] as Step)[k] });
      }
    });
    expect(diffs).toEqual([]);
  });
});
