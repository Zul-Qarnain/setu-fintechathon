// Mux out/raw.webm (1920x1080) + per-scene voiceover + burned-in English subtitles (full narration) -> ../Setu_Demo.mp4
// Called by build_video.sh (cwd = out/). DRY_RUN=1 writes subs.srt and prints the ffmpeg argv instead of running it.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const d = JSON.parse(readFileSync('timeline.json', 'utf-8'));
const len = (s) => [...s].length; // code points

/** round-half-even, like a bankers' rounding of x*1000 ms */
const roundHalfEven = (x) => {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
};
const pad = (n, w) => String(n).padStart(w, '0');

// --- SRT: every narration sentence, split into <=2-line chunks, timed by character share ---
function ts(x) {
  let ms = roundHalfEven(x * 1000);
  const h = Math.floor(ms / 3600000); ms %= 3600000;
  const m = Math.floor(ms / 60000); ms %= 60000;
  const s = Math.floor(ms / 1000); ms %= 1000;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`;
}
function chunks(text, maxc = 84) {
  const words = text.trim() ? text.trim().split(/\s+/) : [];
  const out = [];
  let cur = '';
  for (const w of words) {
    if (cur && len(cur) + 1 + len(w) > maxc) {
      out.push(cur);
      cur = w;
    } else {
      cur = `${cur} ${w}`.trim();
    }
    if (/[.!?;:]$/.test(cur) && len(cur) > maxc * 0.45) {
      out.push(cur);
      cur = '';
    }
  }
  if (cur) out.push(cur);
  return out;
}
const srt = [];
let n = 1;
for (const t of d.timeline) {
  if (!t.text || !t.audio) continue;
  const parts = chunks(t.text);
  const total = parts.reduce((a, p) => a + len(p), 0);
  let st = t.start + 0.15;
  const span = t.dur;
  for (const p of parts) {
    const dur = (span * len(p)) / total;
    srt.push(`${n}\n${ts(st)} --> ${ts(st + dur - 0.04)}\n${p}\n`);
    n += 1;
    st += dur;
  }
}
writeFileSync('subs.srt', srt.join('\n'));

const ins = [], filt = [], labels = [];
let k = 1;
for (const t of d.timeline) {
  if (!t.audio) continue;
  ins.push('-i', t.audio);
  const ms = Math.trunc((t.start + 0.15) * 1000);
  filt.push(`[${k}:a]adelay=${ms}|${ms},apad[a${k}]`);
  labels.push(`[a${k}]`);
  k += 1;
}
const style = 'FontName=Noto Sans,FontSize=15,PrimaryColour=&H00FFFFFF,BackColour=&H99000000,BorderStyle=4,Outline=0,Shadow=0,MarginV=22,MarginL=60,MarginR=60,Alignment=2';
let fc = filt.join(';') + ';' + labels.join('') + `amix=inputs=${k - 1}:normalize=0:duration=longest,volume=1.4,atrim=0:${(d.total + 0.5).toFixed(2)}[aout]`;
fc += `;[0:v]scale=1920:1080,fps=30,subtitles=subs.srt:force_style='${style}',format=yuv420p[vout]`;
const args = ['-y', '-loglevel', 'error', '-i', 'raw.webm', ...ins, '-filter_complex', fc,
  '-map', '[vout]', '-map', '[aout]',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart',
  '-shortest', '../../Setu_Demo.mp4'];
if (process.env.DRY_RUN) {
  console.log(JSON.stringify(['ffmpeg', ...args]));
} else {
  const r = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
