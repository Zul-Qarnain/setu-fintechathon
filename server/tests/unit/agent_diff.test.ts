import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkMessage, scanText } from '../../src/agents/guardian.js';
import { detectLanguage, parseNotice } from '../../src/agents/intake.js';

interface Vec {
  text: string;
  parsed: Record<string, string | null>;
  guardian: { verdict: string; score: number; flags: [string, string][] };
  message: { verdict: string; score: number; flags: string[] };
  lang: string;
}
const vecs = JSON.parse(
  readFileSync(new URL('../fixtures/agent_vectors.json', import.meta.url), 'utf-8')
) as Vec[];

const iso = (d: unknown): string | null =>
  d === null || d === undefined
    ? null
    : d instanceof Date
      ? d.toISOString().slice(0, 10)
      : String(d);

describe('guardian/intake differential vs real Python (555 vectors: regex-sampled, corpus, label/format fuzz)', () => {
  it('parse_notice fields identical', () => {
    const bad: unknown[] = [];
    for (const v of vecs) {
      const p = parseNotice(v.text);
      const got = {
        amount_cny: p.amount_cny === null ? null : p.amount_cny.toFixed(),
        due_date: iso(p.due_date),
        payee_name: p.payee_name,
        account_number: p.account_number,
        account_raw: p.account_raw,
        reference: p.reference,
        item: p.item,
        issuer: p.issuer,
        language: p.language,
      };
      const exp = {
        ...v.parsed,
        amount_cny: v.parsed.amount_cny === null ? null : String(v.parsed.amount_cny),
      };
      // compare amounts numerically-normalised (Python str(Decimal) keeps trailing zeros)
      const norm = (o: Record<string, unknown>) => ({
        ...o,
        amount_cny: o.amount_cny === null ? null : String(Number(o.amount_cny)),
      });
      if (JSON.stringify(norm(got)) !== JSON.stringify(norm(exp)))
        bad.push({ text: v.text.slice(0, 200), got, exp });
    }
    expect(bad.slice(0, 3)).toEqual([]);
    expect(bad.length).toBe(0);
  });
  it('scan_text verdict, score and flags identical', () => {
    const bad: unknown[] = [];
    for (const v of vecs) {
      const g = scanText(v.text, parseNotice(v.text));
      const got = {
        verdict: g.verdict,
        score: g.score,
        flags: g.flags.map((f) => [f.code, f.severity]),
      };
      if (JSON.stringify(got) !== JSON.stringify(v.guardian))
        bad.push({ text: v.text.slice(0, 160), got, exp: v.guardian });
    }
    expect(bad.slice(0, 3)).toEqual([]);
    expect(bad.length).toBe(0);
  });
  it('check_message + detect_language identical', () => {
    const bad: unknown[] = [];
    for (const v of vecs) {
      const m = checkMessage(v.text);
      const got = { verdict: m.verdict, score: m.score, flags: m.flags.map((f) => f.code) };
      if (JSON.stringify(got) !== JSON.stringify(v.message) || detectLanguage(v.text) !== v.lang)
        bad.push({ text: v.text.slice(0, 160), got, exp: v.message });
    }
    expect(bad.slice(0, 3)).toEqual([]);
    expect(bad.length).toBe(0);
  });
});
