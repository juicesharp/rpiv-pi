---
date: 2026-04-12T00:37:31-00:00
researcher: Claude Code
git_commit: 26f9c58
branch: master
repository: rpiv-pi
topic: "Make /pipeline default to start subcommand and auto-run steps without Press Enter"
tags: [research-questions, pipeline, extension-command, ux, auto-submit]
status: complete
last_updated: 2026-04-12
last_updated_by: Claude Code
---

# Research Questions: Pipeline Default Subcommand & Auto-Run

## Discovery Summary
The pipeline command is entirely contained in `extensions/rpiv-core/pipeline.ts` (378 lines), registered via `extensions/rpiv-core/index.ts`. It uses `ctx.ui.setEditorText()` to pre-fill the editor with `/skill:...` commands and relies on the user manually pressing Enter to trigger execution. The Pi SDK provides `ctx.ui.sendUserMessage()` which "always triggers a turn" — this may be the key to auto-submission. The design doc explicitly notes that `pi.sendUserMessage()` is broken after `ctx.newSession()`, but `ctx.ui.sendUserMessage()` is a different closure that captures the InteractiveMode instance (not the session) and should work after newSession.

## Questions

1. Trace the argument dispatch logic in `extensions/rpiv-core/pipeline.ts` lines 341–369 — specifically how `registerPipelineCommand` splits `args` on the first space into `subcommand` and `subArgs`, then uses a `switch(subcommand)` to route to `handleStart`/`handleNext`/`handleStatus`/`handleReset`. Currently when `args` is empty or the first word doesn't match any case, the `default` branch shows the usage message `"Usage: /pipeline start [description] | next [path] | status | reset [id]"`. Determine the minimal change to treat `start` as the default subcommand — when no recognized subcommand is found, route the entire `args` string to `handleStart(trimmed, ctx)` instead of showing usage. Consider edge cases: `/pipeline` with no args (should show usage since `handleStart` already handles empty description), `/pipeline some description text` (should route to `handleStart("some description text", ctx)`), and `/pipeline status`/`/pipeline next`/`/pipeline reset` must still work as explicit subcommands.

2. Trace the auto-submission path from `ctx.ui.sendUserMessage()` in the Pi SDK through to actual LLM invocation. In `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts`, `sendUserMessage(content, { deliverAs })` is documented as "Always triggers a turn." The design doc at `thoughts/shared/designs/2026-04-12_03-55-13_skill-flow-pipeline.md:34-37` states that `pi.sendUserMessage()` is broken after `ctx.newSession()` (targets disposed session via stale `runtime` closure in `loader.js:174-175`), but `ctx.ui` closures capture InteractiveMode instance (`interactive-mode.js:1317`) and work after newSession. Determine whether `ctx.ui.sendUserMessage()` can replace the current `ctx.ui.setEditorText()` + "Press Enter" pattern in both `handleStart` (line 175) and `handleNext` (line 251), and whether it properly expands `/skill:name` shorthand via `_expandSkillCommand()` in `agent-session.js:812` or if the skill text needs to be pre-expanded before sending. Also investigate whether `sendUserMessage()` after `ctx.newSession()` in `handleNext` (line 248) works correctly, and whether there are timing/sequencing concerns (e.g., newSession needs to fully initialize before the message arrives).
