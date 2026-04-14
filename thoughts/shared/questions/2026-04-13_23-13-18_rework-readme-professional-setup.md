---
date: 2026-04-13T23:13:18-04:00
researcher: Claude Code
git_commit: c388ea9
branch: master
repository: rpiv-pi
topic: "Requirements: rework REEDME that one should look highly professional and follow the best industry standards. The setup section MUST be clean with step by step instructions and prerequisites that whould allow a bran new user to have most seamless expirience."
tags: [research-questions, README, rpiv-core, package-json, skills, agents, guidance, web-tools]
status: complete
last_updated: 2026-04-13
last_updated_by: Claude Code
---

# Research Questions: Rework README for a professional setup flow

## Discovery Summary
Discovery focused on the root package manifest, the current README, and the rpiv-core runtime that powers first-run setup. I read `package.json`, `README.md`, `extensions/rpiv-core/index.ts`, `extensions/rpiv-core/package-checks.ts`, `extensions/rpiv-core/agents.ts`, and `extensions/rpiv-core/guidance.ts` to understand how installation, sibling-plugin detection, auto-copying agents, and guidance injection actually work. I also read `agents/web-search-researcher.md` plus the three guidance architecture files under `.rpiv/guidance/` to align the README with the documented extension, skills, and agent registries. The overall shape is a thin runtime extension layer backed by peer plugins and Markdown-defined skills, with most onboarding behavior happening automatically at session start.

## Questions

1. Trace how the prerequisite stack for a first-time install is enforced and surfaced across `README.md`, `package.json`, `extensions/rpiv-core/package-checks.ts`, and `extensions/rpiv-core/index.ts`. Start from the root manifest's `peerDependencies` and `pi.extensions` / `pi.skills` config, then follow `readInstalledPackages()`, `hasPiSubagentsInstalled()`, `hasPiPermissionSystemInstalled()`, `hasRpivAskUserQuestionInstalled()`, `hasRpivTodoInstalled()`, `hasRpivAdvisorInstalled()`, and `hasRpivWebToolsInstalled()` in `package-checks.ts`, and finally the `session_start` warning logic in `index.ts` that collects missing packages into a single UI notification. This matters because the README's prerequisites section needs to match the runtime's actual contract instead of listing generic dependencies or omitting the one-time setup steps that Pi will warn about on first session start.

2. Explain the full `/rpiv-setup` onboarding flow in `extensions/rpiv-core/index.ts` and how the README should describe it step by step. Trace the handler from the `pi.registerCommand("rpiv-setup", ...)` registration through the `ctx.hasUI` guard, the missing-package list built from the `package-checks.ts` helpers, the `ctx.ui.confirm(...)` prompt, the sequential `pi.exec("pi", ["install", pkg])` loop, and the restart advice after successful installs. Also account for how this command updates `~/.pi/agent/settings.json` and why the README should make the interactive, confirm-before-install behavior explicit for new users.

3. Trace the bundled-agent bootstrap path from `extensions/rpiv-core/agents.ts` into the user's workspace and back into the documentation surface. Start with `PACKAGE_ROOT` resolution via `import.meta.url` and `fileURLToPath`, then `copyBundledAgents(cwd, false)` writing from the repo's `agents/` directory into `<cwd>/.pi/agents/`, and finally the `session_start` and `/rpiv-update-agents` calls in `extensions/rpiv-core/index.ts` that either seed or refresh the working copies. This matters for a professional README because it should explain what happens automatically on first run, what `/rpiv-update-agents` does, and how the bundled agents such as `agents/web-search-researcher.md` relate to the editable runtime copies.

4. Explain how guidance injection works end-to-end across `extensions/rpiv-core/guidance.ts`, `extensions/rpiv-core/index.ts`, `.rpiv/guidance/architecture.md`, `.rpiv/guidance/extensions/rpiv-core/architecture.md`, and `.rpiv/guidance/agents/architecture.md`. Trace `clearInjectionState()`, `injectRootGuidance()`, `handleToolCallGuidance()`, and `resolveGuidance()` through the `session_start`, `session_compact`, `session_shutdown`, and `tool_call` hooks, including the precedence rules that prefer `AGENTS.md`, then `CLAUDE.md`, then `.rpiv/guidance/.../architecture.md`. This matters because the README should distinguish between user-visible setup instructions and context that Pi injects automatically, so it stays concise without hiding important behavior.

5. Trace how the README's “What's included” and `/skill:<name>` sections are backed by actual discovery wiring in `package.json`, `README.md`, `agents/web-search-researcher.md`, and `.rpiv/guidance/agents/architecture.md`. Follow `pi.extensions` and `pi.skills` in the root manifest, the README's skill/agent inventory tables, and the agent profile that requests `web_search` and `web_fetch` to see how named subagents and skills are meant to be invoked. This matters because the rewritten README should present skills, agents, and artifact outputs in a clean, professional way that matches the real registries rather than treating them as ad hoc commands.

6. Trace the web-search onboarding surface across `README.md`, `package.json`, `extensions/rpiv-core/package-checks.ts`, `extensions/rpiv-core/index.ts`, and `agents/web-search-researcher.md`. Start from the README's `pi install npm:@juicesharp/rpiv-web-tools` and `/web-search-config` instructions, follow the peer dependency declaration and the `hasRpivWebToolsInstalled()` detection, then inspect the `/rpiv-setup` reason string that explains the sibling provides `web_search`, `web_fetch`, and `/web-search-config`. This matters because the setup section should explain the one-time Brave API key flow and the dependency on the sibling plugin in a way that a brand-new user can complete without guesswork.

7. Trace the first-run experience after installation across `extensions/rpiv-core/index.ts`, `README.md`, and `.rpiv/guidance/architecture.md`. Follow the `session_start` scaffolding that creates `thoughts/shared/research`, `questions`, `designs`, `plans`, and `handoffs`, the `before_agent_start` hook that injects branch and commit context, and the README's workflow example that chains `/skill:research-questions` → `/skill:research` → `/skill:design` → `/skill:write-plan` → `/skill:implement-plan` → `/skill:validate-plan`. This matters because the README rework should tell a newcomer what the product does immediately after setup, what files appear automatically, and how the generated artifacts fit into the documented workflow.
