// Records the Setu demo video against the REAL running app (server :8000 DEMO_MODE=true, web :3000).
// Output: out/raw.webm + out/timeline.json ; then build_video.sh muxes captions' voiceover -> ../Setu_Demo.mp4
// Run: node record.mjs   (needs piper venv at /workspace/tts for voiceover; falls back to caption-only timing)
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const require = createRequire("/workspace/setu/web/");
const { chromium } = require("playwright-core");
const HERE = import.meta.dirname;
const OUT = path.join(HERE, "out");
const AUDIO = path.join(OUT, "audio");
fs.mkdirSync(AUDIO, { recursive: true });

const WEB = process.env.WEB ?? "http://localhost:3000";
const API = process.env.API ?? "http://localhost:8000";
const VW = Number(process.env.VW ?? 1280), VH = Number(process.env.VH ?? 720);
const PIPER = "/workspace/tts/venv/bin/piper", VOICE = "/workspace/tts/voices/en_US-lessac-medium.onnx";
const HAVE_TTS = fs.existsSync(PIPER) && fs.existsSync(VOICE);
const PASSWORD = "demo-password-123";
const SHOTS = "/workspace/tts/shots"; fs.mkdirSync(SHOTS, { recursive: true });

// ---------- narration audio ----------
function synth(text) {
  if (!HAVE_TTS) return { file: null, dur: Math.max(3, text.split(/\s+/).length / 2.6) };
  const h = crypto.createHash("md5").update(text).digest("hex").slice(0, 10);
  const wav = path.join(AUDIO, `${h}.wav`);
  if (!fs.existsSync(wav)) {
    const r = spawnSync(PIPER, ["-m", VOICE, "-f", wav, "--length-scale", "1.05"], { input: text, encoding: "utf-8" });
    if (r.status !== 0) throw new Error("piper failed: " + r.stderr);
  }
  const p = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav], { encoding: "utf-8" });
  return { file: wav, dur: parseFloat(p.stdout) };
}

// ---------- overlay injected into every document (captions, title cards, cursor) ----------
const OVERLAY = `(() => {
  if (window.__demoInstalled) return; window.__demoInstalled = true;
  const css = document.createElement('style');
  css.textContent = \`
  #__cap{position:fixed;left:0;right:0;bottom:0;z-index:2147483646;pointer-events:none;display:none;
    background:linear-gradient(0deg,rgba(10,18,40,.94),rgba(10,18,40,.86));color:#fff;padding:9px 20px 11px;
    font-family:"Noto Sans","Noto Sans SC","Noto Sans CJK SC","DejaVu Sans",sans-serif;border-top:3px solid #2dd4a3}
  #__cap .t{font-size:21px;font-weight:700;line-height:1.25} #__cap .s{font-size:15px;opacity:.88;margin-top:2px;line-height:1.3}
  #__cap .chip{position:absolute;right:14px;top:-26px;background:#f59e0b;color:#1a1200;font-size:12px;font-weight:800;
    padding:3px 10px;border-radius:8px 8px 0 0;letter-spacing:.04em}
  #__card{position:fixed;inset:0;z-index:2147483647;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center;
    background:radial-gradient(circle at 30% 20%,#1d3a6e,#0a1228 70%);color:#fff;font-family:"Noto Sans","Noto Sans SC","Noto Sans CJK SC","DejaVu Sans",sans-serif;padding:40px}
  #__card .t{font-size:58px;font-weight:800;letter-spacing:.01em} #__card .s{font-size:25px;margin-top:16px;opacity:.92;max-width:1000px;line-height:1.35}
  #__card .b{margin-top:30px;font-size:17px;font-weight:800;background:#f59e0b;color:#1a1200;padding:6px 16px;border-radius:10px;letter-spacing:.05em}
  #__cur{position:fixed;z-index:2147483645;width:22px;height:22px;border-radius:50%;background:rgba(239,68,68,.35);border:2px solid #ef4444;
    pointer-events:none;transform:translate(-50%,-50%);left:-50px;top:-50px;transition:transform .08s}
  #__cur.down{transform:translate(-50%,-50%) scale(.6);background:rgba(239,68,68,.7)}\`;
  const mount = () => {
    if (document.getElementById('__cap')) return;
    document.documentElement.appendChild(css);
    for (const [id, html] of [['__cap','<div class="chip">SYNTHETIC DATA · SANDBOX BANK</div><div class="t"></div><div class="s"></div>'],['__card','<div class="t"></div><div class="s"></div><div class="b">SYNTHETIC DATA · SANDBOX BANK · NO REAL MONEY</div>'],['__cur','']]) {
      const d = document.createElement('div'); d.id = id; d.innerHTML = html; document.documentElement.appendChild(d);
    }
    window.__demoSet(JSON.parse(sessionStorage.getItem('__demo') || '{}'));
  };
  window.__demoSet = (st) => {
    sessionStorage.setItem('__demo', JSON.stringify(st));
    const cap = document.getElementById('__cap'), card = document.getElementById('__card'); if (!cap) return;
    if (st.card) { card.style.display = 'flex'; card.querySelector('.t').textContent = st.card[0]; card.querySelector('.s').textContent = st.card[1]; }
    else card.style.display = 'none';
    if (st.cap) { cap.style.display = 'block'; cap.querySelector('.t').textContent = st.cap[0]; cap.querySelector('.s').textContent = st.cap[1] || ''; }
    else cap.style.display = 'none';
  };
  const cur = () => document.getElementById('__cur');
  addEventListener('mousemove', (e) => { const c = cur(); if (c) { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; } }, true);
  addEventListener('mousedown', () => cur()?.classList.add('down'), true);
  addEventListener('mouseup', () => cur()?.classList.remove('down'), true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  new MutationObserver(mount).observe(document, { childList: true });
})();`;

// ---------- static server for the evidence page ----------
const evServer = http.createServer((req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(fs.readFileSync(path.join(HERE, "evidence.html")));
}).listen(3210);

// ---------- run ----------
await fetch(`${API}/demo/reset`, { method: "POST" });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--force-device-scale-factor=1"] });
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, recordVideo: { dir: path.join(OUT, "vid"), size: { width: 1280, height: 720 } }, locale: "en-US" });
await ctx.addInitScript(OVERLAY);
const t0 = Date.now();
const page = await ctx.newPage();
const now = () => (Date.now() - t0) / 1000;
const timeline = [];
let state = {};
const apply = async () => { await page.evaluate((s) => window.__demoSet && window.__demoSet(s), state).catch(() => {}); };
const sleep = (ms) => page.waitForTimeout(ms);
let shotN = 0;
const shot = async (name) => { await page.screenshot({ path: path.join(SHOTS, `${String(++shotN).padStart(2, "0")}-${name}.png`) }); };

/** Show a caption, play the narration, and run `act` while it is speaking. */
async function scene(caption, narration, act, { card = null, minTail = 0.6 } = {}) {
  const a = synth(narration);
  state = { ...(card ? { card } : {}), ...(caption ? { cap: caption } : {}) };
  await apply();
  const start = now();
  timeline.push({ start, text: narration, audio: a.file, dur: a.dur, caption });
  if (act) await act();
  const left = start + a.dur + minTail - now();
  if (left > 0) await sleep(left * 1000);
}

async function moveTo(loc) {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  if (b) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 18 });
}
async function click(loc) { await moveTo(loc); await sleep(250); await loc.click(); }
async function type(loc, text, delay = 55) { await moveTo(loc); await loc.click(); await loc.pressSequentially(text, { delay }); }
async function smoothScroll(y) { await page.evaluate((y) => window.scrollTo({ top: y, behavior: "smooth" }), y); await sleep(900); }

const lastCode = {};
async function totp(email) {
  for (let i = 0; i < 80; i++) {
    const r = await (await page.request.get(`${API}/demo/totp/${encodeURIComponent(email)}`)).json();
    if (Number(r.valid_for_seconds) >= 8 && r.code !== lastCode[email]) { lastCode[email] = r.code; return r.code; }
    await sleep(1000);
  }
  throw new Error("no fresh TOTP");
}
async function approveWithTotp(article, email, who) {
  const code = await totp(email);
  const input = article.locator("input[inputmode=numeric]");
  await type(input, code, 140);
  await sleep(500);
  await click(article.getByRole("button", { name: "Approve", exact: true }));
}
async function login(email) {
  await page.goto(`${WEB}/en/login`); await apply();
  await page.evaluate(() => localStorage.removeItem("setu.token")).catch(() => {});
  await page.reload(); await apply();
  await type(page.getByLabel("Email"), email, 60);
  await type(page.getByLabel("Password"), PASSWORD, 45);
  await sleep(300);
  await click(page.locator("form button[type=submit]"));
  await page.getByRole("main").waitFor();
  await page.waitForURL(/\/en\/?$/);
}
async function nav(href) { await click(page.locator(`nav a[href="${href}"]`).first()); await sleep(900); }
async function logout() { await click(page.getByRole("button", { name: "Log out" })); await page.waitForURL(/login/); await sleep(500); }
async function chat(text) {
  await type(page.locator("#msg"), text, 38);
  await sleep(300);
  await page.locator("#msg").press("Enter");
}
async function pickDoc(re) {
  const sel = page.locator("#doc");
  const opt = sel.locator("option").filter({ hasText: re }).first();
  await sel.selectOption({ value: await opt.getAttribute("value") });
}

const AISHA = "aisha@demo.setu.test", FATHER = "father.rahman@demo.setu.test";

// 0. Title
await page.goto(`${WEB}/en/login`);
await scene(null, "This is Setu, a bridge for international students paying fees abroad. Everything in this video is the real application, recorded live, using synthetic data and a sandbox bank.",
  async () => {}, { card: ["Setu 桥", "A safe agent for cross-border student fee payments. Real UI, recorded live."], minTail: 0.8 });
state = {}; await apply();

// 1. Login + dashboard
await scene(["Sign in as a seeded persona", "Aisha — synthetic student · aisha@demo.setu.test"],
  "I sign in as Aisha, a synthetic student persona. The dashboard shows upcoming obligations, her budget, and an exchange rate that is clearly labelled as a sample.",
  async () => {
    await login(AISHA);
    await sleep(1500); await shot("dashboard");
    await smoothScroll(380); await sleep(1500); await smoothScroll(0);
  });

// 2. Agent chat with live trace (T0)
await scene(["Agent chat with live trace", "Intent → plan → tools → guardian verdict → policy tier → executor → reply check"],
  "In the agent chat I ask how much taka I need by the first of March. A scripted planner reads the intent, all numbers come from deterministic code, and the live trace shows every pipeline step.",
  async () => {
    await nav("/en/agent");
    await click(page.getByTestId("prompt-bdt"));
    await page.getByRole("complementary", { name: "Live trace" }).getByText("Guardian verdict").first().waitFor();
    await sleep(2500); await shot("agent-trace");
  });

// 3. T2
await scene(["Tier 2 — payment up to CNY 2,000 to a verified payee", "The agent drafts; a one-time code (TOTP) confirms; the sandbox bank settles"],
  "Next, a tier two payment. I ask it to pay my dorm fee, which is under the two thousand yuan cap and goes to a verified payee. The agent only drafts the payment and explains why. I confirm with a one-time code, and the sandbox bank settles it.",
  async () => {
    await chat("Pay my dorm fee");
    const art = page.getByRole("article").last();
    await art.waitFor();
    await art.scrollIntoViewIfNeeded(); await sleep(3500); await shot("t2-draft");
    await approveWithTotp(art, AISHA);
    await art.getByText("Executed in the sandbox bank").first().waitFor();
    await sleep(1800); await shot("t2-executed");
  });

// 4. T3 : upload + confirm notice, draft payment
await scene(["Tier 3 — spring tuition, CNY 18,500 (over the cap)", "Student confirms the parsed notice fields first"],
  "A tier three payment: spring tuition, eighteen thousand five hundred yuan, over the cap. First I load the synthetic fee notice and confirm the parsed fields myself.",
  async () => {
    await nav("/en/documents");
    await click(page.getByTestId("load-clean")); await sleep(1200);
    await click(page.getByTestId("analyse"));
    await page.getByRole("heading", { name: "Confirm the parsed fields" }).waitFor();
    await page.getByRole("heading", { name: "Confirm the parsed fields" }).scrollIntoViewIfNeeded(); await sleep(2200); await shot("doc-parsed");
    await click(page.getByLabel("I checked these values against the original notice."));
    await sleep(500);
    await click(page.getByTestId("confirm-doc"));
    await page.getByText("Obligation created").waitFor(); await sleep(1000);
  });
await scene(["Tier 3 needs TOTP + a family approver", "Over the cap → two people must approve before anything executes"],
  "The agent drafts the payment and the policy engine requires two approvals: my code, and a family approver. I approve with my code, and the payment now waits for my father.",
  async () => {
    await nav("/en/agent");
    await pickDoc(/en_tuition/);
    await click(page.getByTestId("prompt-pay"));
    const art = page.getByRole("article").last();
    await art.waitFor(); await art.scrollIntoViewIfNeeded(); await sleep(3000); await shot("t3-draft");
    await approveWithTotp(art, AISHA);
    await art.getByText(/You have already approved/).waitFor(); await sleep(1500); await shot("t3-student-approved");
  });
await scene(["Family approver signs in separately", "Mr. Rahman (synthetic) · own account · own TOTP code"],
  "Her father, a family approver, signs in on his own account, sees the request, and approves with his own code. Only then does the sandbox bank execute the payment.",
  async () => {
    await logout();
    await login(FATHER);
    await nav("/en/approvals");
    const art = page.getByRole("article").first();
    await art.waitFor(); await sleep(1800); await shot("t3-approver-view");
    await approveWithTotp(art, FATHER);
    await page.getByText(/Executed in the sandbox bank/).first().waitFor(); await sleep(2200); await shot("t3-executed");
  });

// 5. New payee via SMS -> cooling off
await scene(["New payee: verification is Tier 3 + family approver + 24-hour cooling-off", "A text message is treated as data, never as an instruction"],
  "Now a message claims the school's bank account has changed. Setu treats it as data. The new payee stays unverified, and verifying it needs a family approver, plus a twenty four hour cooling-off before approval is even possible.",
  async () => {
    await logout();
    await login(AISHA);
    await nav("/en/agent");
    await click(page.getByTestId("prompt-sms"));
    await page.getByTestId("cooling-off").waitFor();
    await page.getByTestId("cooling-off").scrollIntoViewIfNeeded(); await sleep(3000); await shot("new-payee-cooling-off");
  });

// 6. T4 injected document
await scene(["Attack: instructions hidden inside a fee notice", "Guardian flags the injection; the document is blocked and cannot be confirmed"],
  "Now an attack. This fee notice hides an instruction telling the assistant to ignore its rules and pay another account. The guardian flags it, and the document is blocked. It cannot even be confirmed.",
  async () => {
    await nav("/en/documents");
    await click(page.getByTestId("load-injected")); await sleep(1500);
    await click(page.getByTestId("analyse"));
    await page.getByTestId("doc-blocked").waitFor();
    await page.getByTestId("doc-blocked").scrollIntoViewIfNeeded(); await sleep(2500); await shot("t4-doc-blocked");
  });
await scene(["Tier 4 — blocked: INJECTION_DETECTED", "No approval path exists · nothing executes · the event is audited"],
  "If I ask the agent to pay from that notice, the answer is a red tier four block, reason injection detected. There is no approval path, no money moves, and the event is written to the audit log.",
  async () => {
    await nav("/en/agent");
    await pickDoc(/atk_injection/);
    await click(page.getByTestId("prompt-pay"));
    await page.getByTestId("t4-block").waitFor();
    await sleep(800); await page.getByTestId("t4-block").scrollIntoViewIfNeeded(); await sleep(3000); await shot("t4-block");
  });

// 7. Audit chain verify
await scene(["Hash-chained audit log", "Every decision and approval is an entry; one click re-verifies the whole chain"],
  "Every decision and approval is recorded in a hash chained audit log. One click re-verifies the entire chain.",
  async () => {
    await nav("/en/audit"); await sleep(1200);
    await click(page.getByTestId("verify-chain"));
    await page.getByTestId("chain-ok").waitFor(); await sleep(1200); await shot("audit-verified");
    await smoothScroll(420); await sleep(1500); await smoothScroll(0);
  });

// 8. zh-CN
await scene(["界面支持简体中文 · Simplified Chinese UI", "总览 · 智能助手 · 审计日志 — same flows, same policy engine"],
  "The interface also runs in Simplified Chinese. Here is the dashboard, and the agent answering the same question with its live trace.",
  async () => {
    await page.getByRole("button", { name: "简体中文" }).scrollIntoViewIfNeeded();
    await click(page.getByRole("button", { name: "简体中文" }));
    await page.waitForURL(/zh-CN/); await page.getByRole("heading", { name: "审计日志" }).waitFor();
    await nav("/zh-CN");
    await page.getByRole("heading", { name: "总览" }).waitFor(); await sleep(1800); await shot("zh-dashboard");
    await nav("/zh-CN/agent");
    await click(page.getByTestId("prompt-bdt"));
    await page.locator("aside[aria-live=polite]").getByText(/\u2713|\u2705|\u76d1|\u62a4/).first().waitFor({ timeout: 8000 }).catch(() => {});
    await sleep(3500); await shot("zh-agent");
  });

// 9. Evidence page
await scene(["Evidence generated from real runs", "25/25 golden agent tasks · 17/17 adversarial scenarios blocked · verified audit export"],
  "Evidence is generated from real runs of the application code: twenty five golden tasks passed, and all seventeen adversarial scenarios were blocked, offline, with synthetic data. The audit export carries the verified hash chain.",
  async () => {
    await page.goto("http://localhost:3210/"); await apply(); await sleep(1500); await shot("evidence");
    await smoothScroll(300);
  });

// 10. Close
await scene(null,
  "Setu. A scripted planner interprets the request, deterministic code computes the numbers, a policy engine decides, and people approve. Thank you for watching.",
  async () => {}, { card: ["Setu 桥", "Planner interprets · code computes · policy engine decides · people approve"], minTail: 1.2 });

const total = now();
await ctx.close();
const vid = fs.readdirSync(path.join(OUT, "vid")).map((f) => path.join(OUT, "vid", f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
fs.copyFileSync(vid, path.join(OUT, "raw.webm"));
fs.writeFileSync(path.join(OUT, "timeline.json"), JSON.stringify({ total, timeline }, null, 2));
await browser.close(); evServer.close();
console.log("recorded", vid, "duration~", total.toFixed(1));
