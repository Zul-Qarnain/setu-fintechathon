/** FX rates: offline SAMPLE fixture (default) + optional live adapter. Port of backend/app/domain/fx.py. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Decimal, quantizeMoney, quantizeRate } from './money.js';

export const SAMPLE_SOURCE = 'fixture-sample';
export const LIVE_SOURCE = 'live-open.er-api.com';
export const DISCLAIMER_SAMPLE = 'SAMPLE rate from offline fixture. Not a live market rate.';
export const DISCLAIMER_LIVE = 'Indicative mid-market rate from open.er-api.com. Not a bank quote.';
const LIVE_URL = (base: string) => `https://open.er-api.com/v6/latest/${base}`;

export interface Fixture {
  as_of: string;
  base: string;
  rates: Record<string, string>;
}
const BUILTIN_SAMPLE: Fixture = {
  as_of: '2026-10-01T00:00:00Z',
  base: 'CNY',
  rates: { BDT: '17.2000', USD: '0.1400', INR: '11.6000', PKR: '39.5000', LKR: '42.0000', NPR: '19.5000', EUR: '0.1200' },
};

export class FxError extends Error {}

export interface Rate {
  base: string;
  quote: string;
  rate: Decimal;
  source: string;
  as_of: Date;
  cached: boolean;
  is_live: boolean;
  disclaimer: string;
}
const mkRate = (base: string, quote: string, rate: Decimal, source: string, as_of: Date, cached = false): Rate => ({
  base, quote, rate, source, as_of, cached,
  is_live: source === LIVE_SOURCE,
  disclaimer: source === LIVE_SOURCE ? DISCLAIMER_LIVE : DISCLAIMER_SAMPLE,
});

export function loadFixture(dataDir: string): Fixture {
  try {
    return JSON.parse(readFileSync(join(dataDir, 'fx_rates_sample.json'), 'utf8')) as Fixture;
  } catch {
    return BUILTIN_SAMPLE;
  }
}

export type LiveFetcher = (base: string) => Promise<{ rates: Record<string, unknown> }>;
export const defaultLiveFetcher: LiveFetcher = async (base) => {
  const r = await fetch(LIVE_URL(base), { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as { rates: Record<string, unknown> };
};

export interface FxOptions {
  mode?: 'fixture' | 'live';
  ttlSeconds?: number;
  clock?: () => Date;
  fixture?: Fixture;
  dataDir?: string;
  liveFetcher?: LiveFetcher;
}

export class FxService {
  readonly mode: string;
  private ttlMs: number;
  private clock: () => Date;
  private fixture: Fixture | undefined;
  private dataDir: string;
  private live: LiveFetcher;
  private cache = new Map<string, { at: Date; rate: Rate }>();

  constructor(o: FxOptions = {}) {
    this.mode = o.mode ?? 'fixture';
    this.ttlMs = (o.ttlSeconds ?? 86400) * 1000;
    this.clock = o.clock ?? (() => new Date());
    this.fixture = o.fixture;
    this.dataDir = o.dataDir ?? '';
    this.live = o.liveFetcher ?? defaultLiveFetcher;
  }

  private fix(): Fixture {
    this.fixture ??= loadFixture(this.dataDir);
    return this.fixture;
  }

  private fromFixture(base: string, quote: string): Rate {
    const fx = this.fix();
    const rates: Record<string, Decimal> = Object.fromEntries(Object.entries(fx.rates).map(([k, v]) => [k, new Decimal(v)]));
    rates[fx.base] = new Decimal(1);
    const b = rates[base];
    const q = rates[quote];
    if (b === undefined || q === undefined) throw new FxError(`unsupported pair ${base}/${quote}`);
    return mkRate(base, quote, quantizeRate(q.div(b)), SAMPLE_SOURCE, new Date(fx.as_of));
  }

  async getRate(base = 'CNY', quote = 'BDT'): Promise<Rate> {
    base = base.toUpperCase();
    quote = quote.toUpperCase();
    const now = this.clock();
    const k = `${base}/${quote}`;
    const hit = this.cache.get(k);
    if (hit && now.getTime() - hit.at.getTime() < this.ttlMs) return { ...hit.rate, cached: true };
    let rate: Rate;
    if (this.mode === 'live') {
      try {
        const data = await this.live(base);
        const raw = data.rates[quote];
        if (raw === undefined) throw new Error('missing quote');
        rate = mkRate(base, quote, quantizeRate(new Decimal(String(raw))), LIVE_SOURCE, now);
      } catch {
        rate = this.fromFixture(base, quote); // network/parse failure -> labelled fixture fallback
      }
    } else rate = this.fromFixture(base, quote);
    this.cache.set(k, { at: now, rate });
    return rate;
  }

  async convert(amount: Decimal, base = 'CNY', quote = 'BDT'): Promise<[Decimal, Rate]> {
    const r = await this.getRate(base, quote);
    return [quantizeMoney(amount.mul(r.rate)), r];
  }
}
