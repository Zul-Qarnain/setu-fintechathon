# GROK.md — shared box rules (all agents). Caveman style. No keys here.

## Rules (permanent)
1. **Code search:** never grep/cat many raw files. Graph first:
   - `graphify query "<q>"` · `graphify path A B` · `graphify explain Sym`
   - Read only returned file + lines. Graph at `<repo>/graphify-out/graph.json` (+ `GRAPH_REPORT.md`). Stale → `graphify update .`
2. **Shell:** prefix shell/git/lint/test cmds with `rtk` if hook not rewriting (`rtk git status`, `rtk git diff`, `rtk npm test`, `rtk pytest`).
3. **Style:** caveman full. No filler. Code/paths/errors exact. Explain in <3 bullets.
4. **Browser:** DOM accessibility-tree snapshots via `playwright-cli` (`open`, `snapshot`, `click <ref>`, `fill <ref> <text>`, `find`). No screenshot clicking. Same browser task 3+ times → save as `.spec.js`.
5. **Offload:** routine edits/tests/boilerplate/refactors → `qodercli` (or GLM when avail) via bash. Orchestrator only reviews `rtk git diff`.
6. **Context:** `MAX_THINKING_TOKENS=8000`. At ~40k ctx tokens or task end: write <150-word caveman state dump to `/workspace/STATE.md`, compress it, tell user open new chat.

## Tool status
| tool | status |
|---|---|
| graphify (uv tool) | ok. `/workspace/setu/graphify-out` built (code-only AST; docs/images not LLM-extracted) |
| rtk 1.0.1 | ok. Claude hook in `~/.claude/settings.json`. cfg `~/.config/rtk/config.toml` |
| caveman 4.0.1 | ok. skills in `~/.agents/skills`. telemetry off |
| playwright-cli 0.1.22 + chromium | ok |
| qodercli 1.1.64 | installed. **credits exhausted** → don't rely |
| GLM / ZCode | **not working** (auth blocker). See `/workspace/glm-headless.md` |
| OmniRouter | **UNCONFIGURED.** Need base URL + key from user. Don't guess. |

## Hard limits
- No API keys/secrets in rule files, STATE.md, commits.
- Do not touch `Zul-Qarnain/oryxa` or `field-shift`.
