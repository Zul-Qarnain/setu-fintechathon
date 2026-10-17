import { describe, expect, it } from 'vitest';
import { ATTACKS } from '../../src/evalkit/attacks.js';

describe('adversarial scenarios (port of the 17 Python attacks; each runs against the real app)', () => {
  it('has 17 attacks', () => expect(ATTACKS.length).toBe(17));
  ATTACKS.forEach((run, i) => {
    it(`A${String(i + 1).padStart(2, '0')} is blocked`, { timeout: 60000 }, async () => {
      const r = await run();
      expect(r.id).toBe(`A${String(i + 1).padStart(2, '0')}`);
      expect(r.evidence.length).toBeGreaterThan(0);
      expect(r.evidence.join('\n')).not.toMatch(/MONEY MOVED|ACCEPTED|executor ran/);
      expect(r.blocked, r.evidence.join('\n')).toBe(true);
    });
  });
});
