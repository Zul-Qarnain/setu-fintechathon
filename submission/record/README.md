Demo video pipeline (all scripts only; app code untouched).
1. Start server (`DEMO_MODE=true CORS_ORIGINS=http://localhost:3000 npm start` in server/) and web (`next start -p 3000` in web/).
2. `node make_evidence_page.mjs` -> evidence.html (from ../../evidence/*.json)
3. `node record.mjs` -> out/raw.webm + out/timeline.json (Playwright, headless Chrome, real UI; piper TTS voiceover timing)
4. `./build_video.sh` -> ../Setu_Demo.mp4 (1280x720 H.264 + AAC)
