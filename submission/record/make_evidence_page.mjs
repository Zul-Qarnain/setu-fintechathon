// Builds submission/record/evidence.html from the generated evidence/*.json files (synthetic data, offline run).
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../..");
const ev = (f) => JSON.parse(fs.readFileSync(path.join(root, "evidence", f), "utf-8"));
const evalr = ev("eval_results.json"), sec = ev("security_results.json"), aud = ev("audit_export.json");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const attacks = sec.attacks.map((a) => `<tr><td>${a.id}</td><td>${esc(a.name)}</td><td class="ok">${a.blocked ? "✔ blocked" : "✘"}</td></tr>`).join("");
const tiers = {}; evalr.tasks.forEach((t) => { tiers[t.tier] = (tiers[t.tier] || 0) + 1; });
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Setu — evidence</title>
<style>
body{font-family:"Noto Sans","DejaVu Sans",sans-serif;margin:0;background:#f6f4ef;color:#14213d}
header{background:#14213d;color:#fff;padding:14px 32px}
h1{margin:0;font-size:24px} .sub{font-size:13px;opacity:.8;margin-top:2px}
main{padding:18px 32px;display:grid;grid-template-columns:1fr 1.3fr;gap:22px}
.card{background:#fff;border:1px solid #d8d3c7;border-radius:12px;padding:14px 18px}
.big{font-size:44px;font-weight:800;color:#0b7a53;line-height:1}
.lab{font-size:13px;color:#4a5568;margin-top:4px}
table{border-collapse:collapse;width:100%;font-size:13px} td{padding:3px 6px;border-bottom:1px solid #eee}
.ok{color:#0b7a53;font-weight:700} code{font-size:12px;word-break:break-all}
.row{display:flex;gap:28px;margin-bottom:10px}
</style></head><body>
<header><h1>Evidence — generated from real runs of the application code</h1>
<div class="sub">Offline mode · scripted planner · SAMPLE FX fixture (not live rates) · all data SYNTHETIC · sandbox bank only</div></header>
<main>
<section>
 <div class="card"><div class="row">
  <div><div class="big">${evalr.passed}/${evalr.total}</div><div class="lab">golden agent tasks passed (threshold 80%)</div></div>
  <div><div class="big">${sec.blocked}/${sec.total}</div><div class="lab">adversarial scenarios blocked</div></div></div>
  <div class="lab">Golden tasks by policy tier: ${Object.entries(tiers).sort().map(([k, v]) => `${k}: ${v}`).join(" · ")}</div></div>
 <div class="card" style="margin-top:16px"><b>Tamper-evident audit export</b>
  <div class="lab">${aud.audit.length} events · chain verify: <span class="ok">ok=${aud.verify.ok}</span> (checked ${aud.verify.checked})</div>
  <div class="lab" style="margin-top:8px">head hash</div><code>${aud.head_hash}</code></div>
 <div class="card" style="margin-top:16px"><b>Sandbox bank</b>
  <div class="lab">Deterministic, idempotent sandbox: settled / ACCOUNT_CLOSED / RISK_HOLD / LIMIT_EXCEEDED paths, replay-safe. No real money moves.</div></div>
</section>
<section class="card"><b>Adversarial scenarios (all blocked)</b><table>${attacks}</table></section>
</main></body></html>`;
fs.writeFileSync(path.join(import.meta.dirname, "evidence.html"), html);
console.log("wrote evidence.html");
