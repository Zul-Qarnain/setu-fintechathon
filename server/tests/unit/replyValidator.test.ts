import { describe, expect, it } from 'vitest';
import { validateReply, numbersIn } from '../../src/agents/replyValidator.js';

// Expected values produced by the real Python validator.
const cases: [string, unknown[], string, boolean, string[]][] = [
  [
    'Pay 1,234.50 CNY, fee 21.43 by T3 ACCT_7f3a91c2e0',
    [{ a: '1234.5', f: '21.43' }],
    '',
    true,
    [],
  ],
  ['Need 319,841.40 BDT in 28 days', [{ bdt: '319841.40' }], '28 days', true, []],
  ['Total 99 and 007.50', [{ x: 7.5 }], '', false, ['99']],
  ['层级 T3 级 and 3 级', [{}], '3', true, []],
  ['rate 17.2000', [{ r: '17.20' }], '', true, []],
];

describe('reply validator (matches Python)', () => {
  it.each(cases)('%s', (reply, tools, user, ok, bad) => {
    expect(validateReply(reply, tools, user)).toEqual({ ok, unsupported: bad });
  });
  it('ignores tier labels and ids; canonicalises numbers', () => {
    expect([...numbersIn('T3 Tier 2 ACCT_7f3a 1,000.50 0012')].sort()).toEqual(['1000.5', '12']);
  });
  it('rejects hallucinated figures', () => {
    expect(validateReply('You owe 5000', [{ amount: '4000.00' }]).ok).toBe(false);
  });
});
