#!/usr/bin/env bash
# Mux raw.webm (1920x1080) + per-scene voiceover + burned-in English subtitles (full narration) -> ../Setu_Demo.mp4
set -euo pipefail
cd "$(dirname "$0")/out"
python3 - <<'PY'
import json, re, subprocess
d = json.load(open("timeline.json"))

# --- SRT: every narration sentence, split into <=2-line chunks, timed by character share ---
def ts(x):
    ms = int(round(x * 1000)); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"
def chunks(text, maxc=84):
    words, out, cur = text.split(), [], ""
    for w in words:
        if cur and len(cur) + 1 + len(w) > maxc:
            out.append(cur); cur = w
        else:
            cur = f"{cur} {w}".strip()
        if re.search(r"[.!?;:]$", cur) and len(cur) > maxc * 0.45:
            out.append(cur); cur = ""
    if cur: out.append(cur)
    return out
srt, n = [], 1
for t in d["timeline"]:
    if not t.get("text") or not t.get("audio"): continue
    parts = chunks(t["text"]); total = sum(len(p) for p in parts)
    st = t["start"] + 0.15; span = t["dur"]
    for p in parts:
        dur = span * len(p) / total
        srt.append(f"{n}\n{ts(st)} --> {ts(st + dur - 0.04)}\n{p}\n"); n += 1; st += dur
open("subs.srt", "w").write("\n".join(srt))

ins, filt, labels = [], [], []
k = 1
for t in d["timeline"]:
    if not t["audio"]: continue
    ins += ["-i", t["audio"]]
    ms = int((t["start"] + 0.15) * 1000)
    filt.append(f"[{k}:a]adelay={ms}|{ms},apad[a{k}]"); labels.append(f"[a{k}]"); k += 1
style = "FontName=Noto Sans,FontSize=15,PrimaryColour=&H00FFFFFF,BackColour=&H99000000,BorderStyle=4,Outline=0,Shadow=0,MarginV=22,MarginL=60,MarginR=60,Alignment=2"
fc = ";".join(filt) + ";" + "".join(labels) + f"amix=inputs={k-1}:normalize=0:duration=longest,volume=1.4,atrim=0:{d['total']+0.5:.2f}[aout]"
fc += f";[0:v]scale=1920:1080,fps=30,subtitles=subs.srt:force_style='{style}',format=yuv420p[vout]"
cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", "raw.webm", *ins, "-filter_complex", fc,
       "-map", "[vout]", "-map", "[aout]",
       "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
       "-shortest", "../../Setu_Demo.mp4"]
subprocess.run(cmd, check=True)
PY
cp ../../Setu_Demo.mp4 "../../official/C-[TeamName]-DemoVideo.mp4"
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height -of default=nw=1 ../../Setu_Demo.mp4
