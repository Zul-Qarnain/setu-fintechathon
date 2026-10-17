import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { FxError, FxService } from '../../src/domain/fx.js';
import { DEFAULT_CHANNEL, computeCosts, daysUntil, loadChannels } from '../../src/domain/costs.js';
import { monthlySavingNeeded, summarize, totalDueBy } from '../../src/domain/budget.js';
import { Decimal } from '../../src/domain/money.js';

const DATA = resolve(import.meta.dirname, '../../../data');
const D = (s: string) => new Decimal(s);
class Clock {
  t = new Date('2026-10-17T00:00:00Z');
  now = () => this.t;
}
const svc = (mode: 'fixture' | 'live' = 'fixture', clock = new Clock(), liveFetcher?: (b: string) => Promise<{ rates: Record<string, unknown> }>) =>
  new FxService({ mode, clock: clock.now, dataDir: DATA, ...(liveFetcher ? { liveFetcher } : {}) });

describe('fx', () => {
  it('fixture rate is labelled sample', async () => {
    const r = await svc().getRate('CNY', 'BDT');
    expect(r.rate.eq('17.2000') && r.source === 'fixture-sample' && !r.is_live).toBe(true);
    expect(r.disclaimer).toContain('SAMPLE');
  });
  it('cross and identity rates', async () => {
    expect((await svc().getRate('USD', 'CNY')).rate.toFixed(4)).toBe('7.1429');
    expect((await svc().getRate('CNY', 'CNY')).rate.toFixed(4)).toBe('1.0000');
  });
  it('unsupported pair', async () => {
    await expect(svc().getRate('CNY', 'XXX')).rejects.toThrow(FxError);
  });
  it('24h cache then refresh', async () => {
    const c = new Clock();
    const calls: string[] = [];
    const s = svc('live', c, async (b) => (calls.push(b), { rates: { BDT: 18.5 } }));
    const r1 = await s.getRate('CNY', 'BDT');
    const r2 = await s.getRate('CNY', 'BDT');
    expect(r1.is_live && r1.rate.toFixed(4) === '18.5000' && !r1.cached && r2.cached && calls).toEqual(['CNY']);
    c.t = new Date(c.t.getTime() + (23 * 60 + 59) * 60000);
    expect((await s.getRate('CNY', 'BDT')).cached).toBe(true);
    c.t = new Date(c.t.getTime() + 2 * 60000);
    expect((await s.getRate('CNY', 'BDT')).cached).toBe(false);
    expect(calls).toHaveLength(2);
  });
  it('live failure falls back to labelled fixture', async () => {
    const r = await svc('live', new Clock(), async () => { throw new Error('network down'); }).getRate('CNY', 'BDT');
    expect(r.source).toBe('fixture-sample');
    expect(r.is_live).toBe(false);
  });
  it('convert quantizes half-up', async () => {
    const [amt, r] = await svc().convert(D('100.005'), 'CNY', 'BDT');
    expect(amt.toFixed(2)).toBe('1720.09');
    expect(r.quote).toBe('BDT');
  });
});

describe('costs', () => {
  const channels = loadChannels(DATA);
  it('known values (Python-verified)', async () => {
    const c = await computeCosts(D('18500'), svc(), { channels });
    expect(c.fees.map((f) => f.amount_cny.toFixed(2))).toEqual(['21.43', '74.00']);
    expect(c.total_fees_cny.toFixed(2)).toBe('95.43');
    expect(c.fee_pct.toFixed(2)).toBe('0.52');
    expect(c.bdt_needed.toFixed(2)).toBe('319841.40');
    expect(c.fx_source).toBe('fixture-sample');
    expect(c.notes.some((n) => n.includes('SAMPLE'))).toBe(true);
  });
  it('rejects non-positive', async () => {
    for (const bad of ['0', '-5']) await expect(computeCosts(D(bad), svc(), { channels })).rejects.toThrow();
  });
  it('other channel costs more; unknown channel defaults', async () => {
    const wire = await computeCosts(D('1000'), svc(), { channel: 'Sandbox bank wire', channels });
    expect(wire.total_fees_cny.gt((await computeCosts(D('1000'), svc(), { channels })).total_fees_cny)).toBe(true);
    expect((await computeCosts(D('1000'), svc(), { channel: 'Nonexistent', channels })).channel).toBe(DEFAULT_CHANNEL);
  });
  it('load_channels only sandbox rows', () => {
    expect(Object.keys(channels).length).toBeGreaterThan(0);
    expect(Object.keys(channels).every((k) => k.startsWith('Sandbox'))).toBe(true);
  });
  it('days_until', () => expect(daysUntil('2027-03-01', '2027-02-01')).toBe(28));
});

describe('budget', () => {
  it('summary and due', () => {
    const b = summarize(D('3500'), D('1240.50'));
    expect(b.remaining_cny.toFixed(2)).toBe('2259.50');
    expect(b.over_budget).toBe(false);
    expect(summarize(D('100'), D('150')).over_budget).toBe(true);
    const obs = [{ amount_cny: D('10'), due_date: '2026-11-01' }, { amount_cny: D('20'), due_date: '2027-01-01' }];
    expect(totalDueBy(obs, '2026-12-31').toFixed(2)).toBe('10.00');
    expect(totalDueBy(obs, '2027-01-01').toFixed(2)).toBe('30.00');
  });
  it('monthly saving needed', () => {
    expect(monthlySavingNeeded(D('1200'), '2026-10-17', '2027-02-01').toFixed(2)).toBe('300.00');
    expect(monthlySavingNeeded(D('100'), '2026-10-01', '2026-10-20').toFixed(2)).toBe('100.00');
  });
});
