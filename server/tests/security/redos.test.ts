/** ReDoS tests for guardian/intake regex-driven functions. Each must finish < 250ms on 100KB adversarial strings. */
import { describe, it, expect } from 'vitest';
import { scanText, checkMessage } from '../../src/agents/guardian.js';
import { parseNotice, detectLanguage } from '../../src/agents/intake.js';
import * as tokenize from '../../src/domain/tokenize.js';

const MS_LIMIT = 250;

function measureTime(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

describe('ReDoS Security Tests', () => {
  // Build large adversarial inputs (100KB)
  const a100k = 'a'.repeat(100_000);
  const s100k = ' '.repeat(100_000);
  const d100k = '1 '.repeat(33_333).trim();
  const c100k = '\u4e00'.repeat(100_000); // CJK

  it('guardian scanText: a* repeat finishes < ' + MS_LIMIT + 'ms', async () => {
    const t = measureTime(() => scanText(a100k));
    expect(t).toBeLessThan(MS_LIMIT);
  });

  it('guardian scanText: space* repeat finishes < ' + MS_LIMIT + 'ms', async () => {
    const t = measureTime(() => scanText(s100k));
    expect(t).toBeLessThan(MS_LIMIT);
  });

  it('guardian scanText: digit+space repeat finishes < ' + MS_LIMIT + 'ms', async () => {
    const t = measureTime(() => scanText(d100k));
    expect(t).toBeLessThan(MS_LIMIT);
  });

  it('guardian scanText: CJK repeat finishes < ' + MS_LIMIT + 'ms', async () => {
    const t = measureTime(() => scanText(c100k));
    expect(t).toBeLessThan(MS_LIMIT);
  });

  it('intake parseNotice: a* repeat finishes < ' + MS_LIMIT + 'ms', async () => {
    const t = measureTime(() => parseNotice(a100k));
    expect(t).toBeLessThan(MS_LIMIT);
  });

  it('intake detectLanguage: a* repeat finishes < ' + MS_LIMIT + 'ms', async () => {
    const t = measureTime(() => detectLanguage(a100k));
    expect(t).toBeLessThan(MS_LIMIT);
  });

  it('guardian checkMessage: separator repeat finishes < ' + MS_LIMIT + 'ms', async () => {
    // Separator patterns from intake.ts
    const sep100k = ':'.repeat(33_333);
    const t = measureTime(() => checkMessage(sep100k));
    expect(t).toBeLessThan(MS_LIMIT);
  });

  // Test tokenize functions with long homoglyph runs
  it('tokenize isValidAccount: 24-digit run finishes instantly', async () => {
    const longAcct = '123456789012345678901234';
    const t = measureTime(() => tokenize.isValidAccount(longAcct));
    expect(t).toBeLessThan(10);
  });

  it('tokenize hasHomoglyphs: long Cyrillic run finishes < ' + MS_LIMIT + 'ms', async () => {
    const t = measureTime(() => tokenize.hasHomoglyphs(c100k));
    expect(t).toBeLessThan(MS_LIMIT);
  });
});
