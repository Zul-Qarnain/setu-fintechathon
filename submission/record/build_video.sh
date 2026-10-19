#!/usr/bin/env bash
# Mux raw.webm (1920x1080) + per-scene voiceover + burned-in English subtitles (full narration) -> ../Setu_Demo.mp4
set -euo pipefail
cd "$(dirname "$0")/out"
node ../build_video.mjs
cp ../../Setu_Demo.mp4 "../../official/C-VIRSYS-DemoVideo.mp4"
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height -of default=nw=1 ../../Setu_Demo.mp4
