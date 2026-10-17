/** Deterministic cost / BDT-needed computation. Port of backend/app/domain/costs.py. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FxService } from './fx.js';
import { Decimal, quantizeMoney } from './money.js';

export const DEFAULT_CHANNEL = 'Sandbox licensed partner A';
export interface ChannelParams {
  fixed_fee_usd: Decimal;
  fx_margin_pct: Decimal;
  pct: Decimal;
}
const D = (s: string) => new Decimal(s);
const BUILTIN: Record<string, ChannelParams> = {
  'Sandbox licensed partner A': {
    fixed_fee_usd: D('3.00'),
    fx_margin_pct: D('0.40'),
    pct: D('0.00'),
  },
  'Sandbox bank wire': { fixed_fee_usd: D('15.00'), fx_margin_pct: D('1.50'), pct: D('0.00') },
};

export interface FeeLine {
  label: string;
  amount_cny: Decimal;
}
export interface CostBreakdown {
  channel: string;
  amount_cny: Decimal;
  fx_rate: Decimal;
  fx_source: string;
  fees: FeeLine[];
  total_fees_cny: Decimal;
  fee_pct: Decimal;
  total_cny: Decimal;
  bdt_needed: Decimal;
  notes: string[];
}

/** Minimal RFC-4180 CSV parser (quoted fields, commas, CRLF). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      cur = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur !== '' || row.length) {
    row.push(cur);
    rows.push(row);
  }
  const [head, ...rest] = rows;
  if (!head) return [];
  return rest.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

export function loadChannels(dataDir: string): Record<string, ChannelParams> {
  const out: Record<string, ChannelParams> = {};
  try {
    for (const row of parseCsv(readFileSync(join(dataDir, 'channel_costs.csv'), 'utf8'))) {
      const name = row['channel'] ?? '';
      if (!name.startsWith('Sandbox')) continue; // only sandbox channels are offered
      try {
        out[name] = {
          fixed_fee_usd: D(row['fixed_fee_usd'] || '0'),
          fx_margin_pct: D(row['fx_margin_pct'] || '0'),
          pct: D('0'),
        };
      } catch {
        /* skip malformed row */
      }
    }
  } catch {
    /* missing file -> builtin */
  }
  return Object.keys(out).length ? out : { ...BUILTIN };
}

export async function computeCosts(
  amountCny: Decimal,
  fx: FxService,
  opts: { channel?: string; toCurrency?: string; channels?: Record<string, ChannelParams> } = {}
): Promise<CostBreakdown> {
  const channel = opts.channel ?? DEFAULT_CHANNEL;
  if (amountCny.lte(0)) throw new Error('amount must be positive');
  const chans = opts.channels ?? BUILTIN;
  const params = chans[channel] ?? chans[DEFAULT_CHANNEL] ?? Object.values(chans)[0];
  if (!params) throw new Error('no channels configured');
  const usdCny = await fx.getRate('USD', 'CNY');
  const fixed = quantizeMoney(params.fixed_fee_usd.mul(usdCny.rate));
  const margin = quantizeMoney(amountCny.mul(params.fx_margin_pct).div(100));
  const totalFees = fixed.plus(margin);
  const total = amountCny.plus(totalFees);
  const rate = await fx.getRate('CNY', opts.toCurrency ?? 'BDT');
  const notes = ['Setu never holds funds; licensed partners move money (sandbox only).'];
  if (!rate.is_live) notes.push('FX rate is a SAMPLE fixture, not live.');
  return {
    channel: channel in chans ? channel : DEFAULT_CHANNEL,
    amount_cny: quantizeMoney(amountCny),
    fx_rate: rate.rate,
    fx_source: rate.source,
    fees: [
      { label: 'Partner transfer fee', amount_cny: fixed },
      { label: 'FX margin (est.)', amount_cny: margin },
    ],
    total_fees_cny: totalFees,
    fee_pct: totalFees.div(amountCny).mul(100).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN),
    total_cny: quantizeMoney(total),
    bdt_needed: quantizeMoney(total.mul(rate.rate)),
    notes,
  };
}

/** Whole days between two ISO dates (YYYY-MM-DD). */
export const daysUntil = (due: string, today: string): number =>
  Math.round((Date.parse(due + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
