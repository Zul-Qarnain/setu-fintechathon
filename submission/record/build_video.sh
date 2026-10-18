#!/usr/bin/env bash
# Mux raw.webm (+ piper voiceover placed at caption start times) into ../Setu_Demo.mp4 (1280x720, H.264/AAC)
set -euo pipefail
cd "$(dirname "$0")/out"
python3 - <<'PY'
import json, subprocess
d = json.load(open("timeline.json"))
ins, filt, labels = [], [], []
n = 1
for t in d["timeline"]:
    if not t["audio"]: continue
    ins += ["-i", t["audio"]]
    ms = int((t["start"] + 0.15) * 1000)
    filt.append(f"[{n}:a]adelay={ms}|{ms},apad[a{n}]"); labels.append(f"[a{n}]"); n += 1
fc = ";".join(filt) + ";" + "".join(labels) + f"amix=inputs={n-1}:normalize=0:duration=longest,volume=1.4,atrim=0:{d['total']+0.5:.2f}[aout]"
cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", "raw.webm", *ins, "-filter_complex", fc,
       "-map", "0:v", "-map", "[aout]", "-vf", "scale=1280:720,fps=25,format=yuv420p",
       "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
       "-shortest", "../../Setu_Demo.mp4"]
subprocess.run(cmd, check=True)
PY
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height -of default=nw=1 ../../Setu_Demo.mp4
