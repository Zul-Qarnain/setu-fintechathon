// Usage: STITCH_API_KEY=$(cat /workspace/stitch-key.txt) node stitch_gen.mjs [--test] [--only name1,name2] [prompts.json]
// prompts.json: { "title": "...", "common": "shared design brief", "screens": [{ "name": "dashboard", "device": "MOBILE|DESKTOP", "prompt": "..." }] }
// Creates (or reuses stitch/project.json) a Stitch project, generates each screen, saves <name>.html + <name>.png in ./stitch/. Never prints the key.
import { stitch } from "@google/stitch-sdk";
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)); const out = path.join(here, "stitch"); fs.mkdirSync(out, { recursive: true });
const args = process.argv.slice(2); const test = args.includes("--test");
const oi = args.indexOf("--only"); const only = oi >= 0 ? args[oi + 1].split(",") : null;
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--only") || path.join(here, "prompts.json");
if (!process.env.STITCH_API_KEY) { console.error("STITCH_API_KEY not set"); process.exit(2); }
const scrub = (e) => String(e?.message || e).split(process.env.STITCH_API_KEY).join("***");
async function bytes(v, img) { // SDK 0.3.x returns signed URLs; newer returns content
  if (typeof v === "string" && /^https?:\/\//.test(v)) { const r = await fetch(img && /googleusercontent/.test(v) && !v.includes("=") ? v + "=w1440" : v); if (!r.ok) throw new Error("download " + r.status); return Buffer.from(await r.arrayBuffer()); }
  return typeof v === "string" ? Buffer.from(v) : Buffer.from(v);
}
async function save(name, screen) {
  fs.writeFileSync(path.join(out, `${name}.html`), await bytes(await screen.getHtml()));
  fs.writeFileSync(path.join(out, `${name}.png`), await bytes(await screen.getImage(), true));
  console.log("saved", name);
}
try {
  let cfg = test ? { title: "Setu API test", common: "", screens: [{ name: "_test", device: "MOBILE", prompt: "A simple login page with email and password" }] } : JSON.parse(fs.readFileSync(file, "utf8"));
  const pf = path.join(out, test ? "project.test.json" : "project.json");
  let project;
  if (fs.existsSync(pf)) project = stitch.project(JSON.parse(fs.readFileSync(pf, "utf8")).id);
  else { project = await stitch.createProject(cfg.title); fs.writeFileSync(pf, JSON.stringify({ id: project.id ?? project.projectId, title: cfg.title })); console.log("project", project.id ?? project.projectId); }
  for (const s of cfg.screens) {
    if (only && !only.includes(s.name)) continue;
    if (!test && fs.existsSync(path.join(out, `${s.name}.png`)) && !only) { console.log("skip", s.name); continue; }
    // SDK 0.3.x: generate(prompt, deviceType) -> Screen (newer: options object -> Generation)
    const g = await project.generate(`${cfg.common ? cfg.common + "\n\n" : ""}${s.prompt}`, s.device || "MOBILE");
    const screens = g.screens || [g.first || g];
    await save(s.name, screens[0]);
    for (let i = 1; i < screens.length; i++) await save(`${s.name}-${i + 1}`, screens[i]);
  }
} catch (e) { console.error("FAILED:", e?.code || "", e?.name || "", scrub(e)); process.exit(1); }
