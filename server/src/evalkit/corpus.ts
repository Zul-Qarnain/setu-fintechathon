/** Guardian + parser evaluation on the SYNTHETIC notice corpus (data/fee_notices/manifest.json). Port of backend/eval/run_corpus.py. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDb } from '../db/connection.js';
import { Decimal } from '../domain/money.js';
import { loadPersonas, seedAll } from '../seed.js';

export interface CorpusResult {
  file: string;
  label: string;
  expected_guardian: string;
  got_guardian: string;
  flags: string[];
  parse_ok: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function runCorpus(): Promise<CorpusResult[]> {
  const config = loadConfig({ RATE_LIMIT_PER_MINUTE: '100000' });
  const app = await buildApp({ config, db: openDb(':memory:') });
  await seedAll(app.ctx);
  const tokens: Record<string, Record<string, string>> = {};
  for (const p of loadPersonas(config.dataDir)) {
    if (p.role !== 'student') continue;
    const r = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: p.email, password: p.password },
    });
    tokens[p.email] = { authorization: `Bearer ${(r.json() as any).access_token}` };
  }
  const dir = join(config.dataDir, 'fee_notices');
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8')) as any[];
  const out: CorpusResult[] = [];
  for (const m of manifest) {
    const text = readFileSync(join(dir, m.file), 'utf-8');
    const r = await app.inject({
      method: 'POST',
      url: '/documents',
      headers: tokens[m.persona],
      payload: { filename: m.file, text },
    });
    const d = r.json() as any;
    const exp = m.expected;
    const pr = d.parsed;
    const amountOk =
      pr.amount_cny !== null && new Decimal(pr.amount_cny).eq(new Decimal(exp.amount_cny));
    out.push({
      file: m.file,
      label: m.label,
      expected_guardian: m.expected_guardian,
      got_guardian: d.guardian.verdict,
      flags: d.guardian.flags.map((f: any) => f.code),
      parse_ok: amountOk && pr.due_date === exp.due_date && pr.payee_name === exp.payee_name,
    });
  }
  await app.close();
  return out;
}

export function corpusMarkdown(res: CorpusResult[]): string[] {
  const n = res.length;
  const gOk = res.filter((r) => r.expected_guardian === r.got_guardian).length;
  const pOk = res.filter((r) => r.parse_ok).length;
  const attacks = res.filter((r) => r.label !== 'clean');
  const clean = res.filter((r) => r.label === 'clean');
  const caught = attacks.filter((r) => r.got_guardian !== 'clean').length;
  const expBlocked = attacks.filter((r) => r.expected_guardian === 'blocked');
  const blockedAtt = expBlocked.filter((r) => r.got_guardian === 'blocked').length;
  const falsePos = clean.filter((r) => r.got_guardian !== 'clean').length;
  const byLabel: Record<string, number> = {};
  for (const r of res) byLabel[r.label] = (byLabel[r.label] ?? 0) + 1;
  const lines = [
    '## Guardian and parser on the synthetic notice corpus',
    '',
    `${n} SYNTHETIC notices (${clean.length} clean, ${attacks.length} attack/negative; EN, 简体中文 and mixed), each uploaded by its persona through the real \`POST /documents\` path (rules + payee registry).`,
    '',
    `- Verdict matches label: **${gOk}/${n}** (${Math.round((gOk / n) * 100)}%)`,
    `- Attack/negative notices flagged (not 'clean'): **${caught}/${attacks.length}**; expected-blocked notices actually blocked: **${blockedAtt}/${expBlocked.length}**`,
    `- False positives on clean notices: **${falsePos}/${clean.length}**`,
    `- Field parsing (amount, due date, payee name) correct: **${pOk}/${n}**`,
    `- By label: ${JSON.stringify(byLabel)}`,
    '',
    '| File | Label | Expected | Got | Flags | Parse |',
    '|---|---|---|---|---|---|',
  ];
  for (const r of res)
    lines.push(
      `| ${r.file} | ${r.label} | ${r.expected_guardian} | ${r.got_guardian}${r.expected_guardian === r.got_guardian ? '' : ' ✘'} | ${r.flags.join(', ') || '-'} | ${r.parse_ok ? '✔' : '✘'} |`
    );
  lines.push(
    '',
    'Caveat: the corpus was written by the same team that wrote the rules, so these numbers show coverage of known patterns, not generalisation to unseen attacks.',
    ''
  );
  return lines;
}
