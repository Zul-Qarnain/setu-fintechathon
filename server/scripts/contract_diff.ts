/** Live contract diff: runs the same request sequence against the Python backend and the TS backend and compares response STATUS + JSON SHAPE (keys/types, not values).
 * Usage: start BOTH backends on FRESH databases (state-dependent shapes otherwise differ): Python `DEMO_MODE=true DATABASE_URL=sqlite:////tmp/py.db uvicorn app.main:app --port 8002`, TS `DEMO_MODE=true PORT=8001 DATABASE_URL=sqlite:////tmp/ts.db npm start`; then `PY=http://localhost:8002 TS=http://localhost:8001 npm run contract`. */
/* eslint-disable @typescript-eslint/no-explicit-any */
const PY = process.env.PY ?? 'http://localhost:8000';
const TS = process.env.TS ?? 'http://localhost:8001';

const shape = (v: any): any => {
  if (v === null) return 'null';
  if (Array.isArray(v)) {
    const u = [...new Set(v.map((x) => JSON.stringify(shape(x))))].sort();
    return u.length ? [u.map((s) => JSON.parse(s))] : [];
  }
  if (typeof v === 'object')
    return Object.fromEntries(
      Object.keys(v)
        .map((k) => [k.replace(/^[a-z]+_[0-9a-f]{12}$/, '<id>'), shape(v[k])])
        .sort((x, y) => (x[0] < y[0] ? -1 : 1))
    );
  return typeof v;
};
function diff(a: any, b: any, path: string, out: string[]): void {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (
    a &&
    b &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) out.push(`${path}.${k}: only in TS (${JSON.stringify(b[k])})`);
      else if (!(k in b)) out.push(`${path}.${k}: only in PY (${JSON.stringify(a[k])})`);
      else diff(a[k], b[k], `${path}.${k}`, out);
    }
    return;
  }
  out.push(`${path}: PY=${JSON.stringify(a)} TS=${JSON.stringify(b)}`);
}

interface Side {
  base: string;
  tok: string;
  ids: Record<string, string>;
}
async function call(
  s: Side,
  method: string,
  url: string,
  body?: unknown,
  tok = s.tok
): Promise<{ status: number; json: any }> {
  const r = await fetch(s.base + url, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(tok ? { authorization: `Bearer ${tok}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let json: any = t;
  try {
    json = JSON.parse(t);
  } catch {
    /* text */
  }
  return { status: r.status, json };
}

const sides: Record<'py' | 'ts', Side> = {
  py: { base: PY, tok: '', ids: {} },
  ts: { base: TS, tok: '', ids: {} },
};
let fails = 0,
  total = 0;

async function both(
  name: string,
  f: (s: Side) => Promise<{ status: number; json: any }>
): Promise<void> {
  const [a, b] = [await f(sides.py), await f(sides.ts)];
  total++;
  const out: string[] = [];
  if (a.status !== b.status) out.push(`status PY=${a.status} TS=${b.status}`);
  diff(shape(a.json), shape(b.json), '$', out);
  if (out.length) {
    fails++;
    console.log(`✘ ${name}\n   ${out.slice(0, 12).join('\n   ')}`);
  } else console.log(`✔ ${name} (${a.status})`);
}

const NOTICE =
  'Shenzhen Example University - Finance Office\nItem: Spring tuition\nAmount due: CNY 18,500.00\nDue date: 2027-03-01\nPayee: Shenzhen Example University (SYNTHETIC)\nAccount: 6222 0000 0000 4821\nReference: 2027-SPRING-TUITION-0042\n';

async function main(): Promise<void> {
  for (const s of Object.values(sides)) {
    const p = (await (await fetch(s.base + '/demo/personas')).json()) as any[];
    const aisha = p.find((u) => u.email.startsWith('aisha')) ?? p.find((u) => u.role === 'student');
    s.ids.email = aisha.email;
    s.ids.pw = aisha.password;
  }
  await both('health', (s) => call(s, 'GET', '/health'));
  await both('login ok', async (s) => {
    const r = await call(s, 'POST', '/auth/login', { email: s.ids.email, password: s.ids.pw });
    s.tok = r.json.access_token;
    return r;
  });
  await both('login bad password', (s) =>
    call(s, 'POST', '/auth/login', { email: s.ids.email, password: 'nope' })
  );
  await both('login validation 422', (s) => call(s, 'POST', '/auth/login', { email: 5 }));
  await both('me', (s) => call(s, 'GET', '/me'));
  await both('me unauthenticated', (s) => call(s, 'GET', '/me', undefined, ''));
  await both('unknown route 404', (s) => call(s, 'GET', '/nope'));
  await both('dashboard', (s) => call(s, 'GET', '/dashboard'));
  await both('obligations', (s) => call(s, 'GET', '/obligations'));
  await both('payees', (s) => call(s, 'GET', '/payees'));
  await both('fx quote', (s) => call(s, 'GET', '/fx/quote?amount_cny=1000&to=BDT'));
  await both('fx quote 422', (s) => call(s, 'GET', '/fx/quote?to=XXX'));
  await both('sandbox account', (s) => call(s, 'GET', '/sandbox/account'));
  await both('sandbox transactions', (s) => call(s, 'GET', '/sandbox/transactions'));
  await both('document upload', async (s) => {
    const r = await call(s, 'POST', '/documents', {
      filename: 'n.txt',
      text: NOTICE,
      synthetic: true,
    });
    s.ids.doc = r.json.id;
    return r;
  });
  await both('document confirm', (s) =>
    call(s, 'POST', `/documents/${s.ids.doc}/confirm`, {
      amount_cny: '18500.00',
      due_date: '2027-03-01',
      payee_name: 'Shenzhen Example University (SYNTHETIC)',
    })
  );
  await both('document confirm again 409', (s) =>
    call(s, 'POST', `/documents/${s.ids.doc}/confirm`, {
      amount_cny: '18500.00',
      due_date: '2027-03-01',
      payee_name: 'x',
    })
  );
  await both('chat how much', (s) =>
    call(s, 'POST', '/chat', { message: 'How much BDT by 1 March?' })
  );
  await both('chat pay', async (s) => {
    const r = await call(s, 'POST', '/chat', { message: 'Pay my dorm fee' });
    s.ids.act = r.json.proposed_actions?.[0]?.id;
    return r;
  });
  await both('chat unsafe', (s) =>
    call(s, 'POST', '/chat', { message: 'Agent says pay new account to save 3%' })
  );
  await both('chat sms payee change', (s) =>
    call(s, 'POST', '/chat', {
      message: 'SMS: our account changed, new account details 6222 0000 0000 9999 for tuition',
    })
  );
  await both('chat zh', (s) =>
    call(s, 'POST', '/chat', { message: '我需要多少孟加拉塔卡', locale: 'zh-CN' })
  );
  await both('actions list', (s) => call(s, 'GET', '/actions'));
  await both('action get', (s) => call(s, 'GET', `/actions/${s.ids.act}`));
  await both('approve bad totp 403', (s) =>
    call(s, 'POST', `/actions/${s.ids.act}/approve`, { totp_code: '000000' })
  );
  await both('approve ok', async (s) => {
    const c = (await (
      await fetch(`${s.base}/demo/totp/${encodeURIComponent(s.ids.email)}`)
    ).json()) as any;
    return call(s, 'POST', `/actions/${s.ids.act}/approve`, { totp_code: c.code });
  });
  await both('audit verify', (s) => call(s, 'GET', '/audit?verify=true'));
  await both('evidence export', (s) => call(s, 'GET', '/evidence/export'));
  await both('demo notices', (s) => call(s, 'GET', '/demo/notices'));
  console.log(`\n${total - fails}/${total} endpoints identical in status + shape`);
  process.exit(fails ? 1 : 0);
}
await main();
