// Per-scene-emotion TTS. Female voice. Order: ElevenLabs -> Gemini TTS -> (caller falls back to piper). Keys read from files, never logged.
import fs from "node:fs"; import crypto from "node:crypto"; import path from "node:path"; import { spawnSync } from "node:child_process";
const EL_VOICE = process.env.EL_VOICE || "EXAVITQu4vr4xnSDxMaL"; // Sarah: mature, reassuring, confident (female)
// mood -> ElevenLabs voice_settings + Gemini style direction
export const MOODS = {
  intro:   { st: 0.40, style: 0.45, speed: 1.0,  gem: "Say warmly and confidently, like a trusted guide welcoming someone:" },
  calm:    { st: 0.55, style: 0.20, speed: 0.97, gem: "Say in a calm, reassuring, steady tone:" },
  payment: { st: 0.50, style: 0.25, speed: 0.97, gem: "Say in a calm, reassuring tone, clear and unhurried:" },
  careful: { st: 0.50, style: 0.30, speed: 0.97, gem: "Say attentively and carefully, with quiet seriousness:" },
  attack:  { st: 0.65, style: 0.35, speed: 0.93, gem: "Say in a serious, firm, authoritative tone, with controlled gravity:" },
  assured: { st: 0.50, style: 0.30, speed: 0.98, gem: "Say in an assured, confident tone, satisfied that it checks out:" },
  friendly:{ st: 0.45, style: 0.40, speed: 1.0,  gem: "Say in a friendly, bright, welcoming tone:" },
  closing: { st: 0.38, style: 0.55, speed: 1.0,  gem: "Say in an uplifting, warm, inspiring tone, ending on a confident high note:" },
};
const rd = (f) => fs.readFileSync(f, "utf8").trim();
function toWav(inFile, args, wav) { const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args, "-i", inFile, "-ar", "44100", "-ac", "1", wav]); if (r.status !== 0) throw new Error("ffmpeg: " + r.stderr); }
async function eleven(text, m, wav) {
  const key = rd("/workspace/elevenlabs-key.txt");
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${EL_VOICE}?output_format=mp3_44100_128`, {
    method: "POST", headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: m.st, similarity_boost: 0.8, style: m.style, use_speaker_boost: true, speed: m.speed } }) });
  if (!r.ok) throw new Error("elevenlabs " + r.status + " " + (await r.text()).slice(0, 200).split(key).join("***"));
  const mp3 = wav + ".mp3"; fs.writeFileSync(mp3, Buffer.from(await r.arrayBuffer())); toWav(mp3, [], wav); fs.unlinkSync(mp3);
}
async function gemini(text, m, wav) {
  let last;
  for (const n of [1, 2, 3]) {
    const key = rd(`/workspace/gemini-key-${n}.txt`);
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent", {
      method: "POST", headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: `${m.gem} ${text}` }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Sulafat" } } } } }) });
    if (!r.ok) { last = "gemini " + r.status; continue; }
    const j = await r.json(); const b64 = j?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data; if (!b64) { last = "gemini empty"; continue; }
    const pcm = wav + ".pcm"; fs.writeFileSync(pcm, Buffer.from(b64, "base64")); toWav(pcm, ["-f", "s16le", "-ar", "24000", "-ac", "1"], wav); fs.unlinkSync(pcm); return;
  }
  throw new Error(last || "gemini failed");
}
/** Returns wav path or null (caller falls back). */
export async function synthMood(text, mood, dir) {
  const m = MOODS[mood] || MOODS.calm; fs.mkdirSync(dir, { recursive: true });
  const h = crypto.createHash("md5").update(mood + "|" + text).digest("hex").slice(0, 10);
  const wav = path.join(dir, `${h}.wav`); if (fs.existsSync(wav)) return wav;
  for (const [name, fn] of [["elevenlabs", eleven], ["gemini", gemini]]) {
    try { await fn(text, m, wav); console.error(`tts ${name} [${mood}] ok`); return wav; } catch (e) { console.error(`tts ${name} failed: ${e.message}`); }
  }
  return null;
}
