---
date: 2026-04-14T03:33:41Z
researcher: Claude Code
git_commit: c388ea9
branch: master
repository: rpiv-pi
topic: "Rework README to a professional standard with clean, step-by-step setup section and prerequisites for seamless brand-new-user onboarding"
tags: [research, README, onboarding, setup, skills, agents, migration, troubleshooting]
status: complete
questions_source: "thoughts/shared/questions/2026-04-13_23-21-05_rework-readme-professional-setup.md"
last_updated: 2026-04-14
last_updated_by: Claude Code
---

# Research: Rework README to a professional standard with clean, step-by-step setup section and prerequisites for seamless brand-new-user onboarding

## Research Question
Rework README to a professional standard with clean, step-by-step setup section and prerequisites for seamless brand-new-user onboarding.

## Summary
`rpiv-pi` is an orchestration package: it wires skills, named agents, startup hooks, guidance injection, and setup commands. The README should front-load a short lede, separate true user prerequisites from Pi-bundled runtime assumptions and sibling-plugin setup, preserve the real `/skill:` and `/rpiv-setup` flow, add a visible pipeline section, and include a short troubleshooting section for the setup/migration failures the code emits. Keep the multi-step fenced install flow, add a license footer, omit a screenshot, and defer a table of contents until the document grows much larger. Per developer correction, the legacy `pi-permission-system` compatibility path at `extensions/rpiv-core/index.ts:38-46` should be removed rather than documented.

## Detailed Findings

### Prerequisites
- `package.json:11-21` declares nine peer dependencies.
- `extensions/rpiv-core/package-checks.ts:15-30` reads `~/.pi/agent/settings.json`, so Pi runtime state already exists.
- `extensions/rpiv-core/index.ts:104-121` shells out to `git`, so git is an implicit prerequisite for git-context injection.
- README should split dependencies into:
  - user-installs-first: Pi CLI/runtime, Node.js, git
  - bundled-with-Pi-runtime: `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`, `@sinclair/typebox`
  - rpiv-family-installed-by-setup: `@tintinweb/pi-subagents`, `@juicesharp/rpiv-ask-user-question`, `@juicesharp/rpiv-todo`, `@juicesharp/rpiv-advisor`, `@juicesharp/rpiv-web-tools`
- Current README mixes those groups in `README.md:7-24`.

### First-run flow
- `extensions/rpiv-core/index.ts:32-85` is the startup path.
- `extensions/rpiv-core/index.ts:35-36` injects root guidance.
- `extensions/rpiv-core/index.ts:49-59` scaffolds `thoughts/shared/{research,questions,designs,plans,handoffs}`.
- `extensions/rpiv-core/agents.ts:36-62` copies bundled agents into `<cwd>/.pi/agents/`.
- `extensions/rpiv-core/index.ts:70-84` emits one aggregated warning if any sibling plugin is missing.
- `extensions/rpiv-core/index.ts:141-240` implements `/rpiv-setup`: interactive check, confirm dialog, sequential `pi install` loop, per-package error reporting.
- `extensions/rpiv-core/index.ts:236-239` ends with “Restart your Pi session.”
- `README.md:48-52` already points to `/web-search-config`; `extensions/rpiv-core/index.ts:174-177` ties it to `@juicesharp/rpiv-web-tools`.
- README should mirror the real order: install rpiv-pi, start Pi, observe startup side effects and warnings, run `/rpiv-setup`, confirm, wait for installs, restart, then run `/web-search-config` if needed.

### Session-start visibility
- `.pi/agents/` appearing and `thoughts/shared/` being created are user-visible effects worth a short “What happens on session start” section.
- `extensions/rpiv-core/agents.ts:31-62` makes agent copy idempotent; `extensions/rpiv-core/index.ts:123-136` exposes `/rpiv-update-agents` as the refresh path.
- `extensions/rpiv-core/guidance.ts:122-192` shows hidden guidance injection during session start and on `read`/`edit`/`write`.
- Per developer instruction, the legacy `pi-permission-system` seed workaround at `extensions/rpiv-core/index.ts:38-46` should be removed and should not be documented.

### Skills and agents
- `package.json:7-10` declares `"skills": ["./skills"]`; `README.md:67-69,106-114` shows `/skill:<name>`.
- `.rpiv/guidance/skills/architecture.md:4-12,26-30,60-82` says SKILL.md frontmatter `name` maps to `/skill:<name>` and skills form a pipeline.
- `.rpiv/guidance/agents/architecture.md:1-76` distinguishes locators, analyzers, git-history, and web-research tiers.
- README should keep the catalog tables but add an ordered Pipeline section and phase groupings; flat lists alone hide the workflow.

### README style and structure
- Sibling READMEs use a lede, screenshot, short install block, restart trailer, and license footer.
- `README.md:1-5` currently has only title + version; replace the version line with a lede paragraph.
- Keep fenced blocks for the multi-step install flow in `README.md:26-52`.
- Add `## License` with MIT.
- Omit a screenshot because `rpiv-pi` has no single UI surface.
- Add badges only if they remain minimal; defer a TOC until the README grows past ~200 lines.

### Migration and troubleshooting
- `README.md:116-125` names old config files but does not name the four `@juicesharp/rpiv-*` packages or explain the silent cutover clearly enough.
- `extensions/rpiv-core/index.ts:144-147` emits `"/rpiv-setup requires interactive mode"`.
- `extensions/rpiv-core/index.ts:79-82` emits an aggregated missing-sibling warning.
- `extensions/rpiv-core/index.ts:231-234` emits per-package failure lines.
- `README.md:129-131` buries the subagent concurrency note; that belongs in troubleshooting or advanced notes.
- A dedicated Troubleshooting section should cover: headless setup, missing siblings, partial installs, config-path cutover, and background-agent throttling.

### Code references
- `package.json:7-21`
- `extensions/rpiv-core/index.ts:32-85`
- `extensions/rpiv-core/index.ts:104-121`
- `extensions/rpiv-core/index.ts:141-240`
- `extensions/rpiv-core/agents.ts:31-62`
- `extensions/rpiv-core/guidance.ts:122-192`
- `extensions/rpiv-core/package-checks.ts:15-55`
- `README.md:1-131`

### Integration points
#### Inbound references
- `package.json:7-10` — Pi discovers skills via `"skills": ["./skills"]`.
- `package.json:11-21` — peer dependency list that drives setup messaging.
- `extensions/rpiv-core/index.ts:34-84` — session-start onboarding events users see.
- `extensions/rpiv-core/index.ts:141-240` — `/rpiv-setup` install flow.
#### Outbound dependencies
- `node:fs`, `node:path`, `node:os` in `extensions/rpiv-core/index.ts` and `package-checks.ts`.
- `git` via `extensions/rpiv-core/index.ts:104-121`.
- `.rpiv/guidance/architecture.md` via `guidance.ts:122-158`.
- `<cwd>/.pi/agents/` via `agents.ts:36-62`.
- `thoughts/shared/{research,questions,designs,plans,handoffs}` via `index.ts:49-59`.
#### Infrastructure wiring
- `package.json:7-10` — skills directory registration.
- `extensions/rpiv-core/index.ts:34-242` — lifecycle hooks and slash commands.
- `extensions/rpiv-core/guidance.ts:162-192` — tool-call guidance injection.
- `extensions/rpiv-core/agents.ts:36-62` — bundled-agent copy.
- `extensions/rpiv-core/package-checks.ts:21-55` — installed-package detection.

### Architecture insights
- `/skill:` is runtime-owned; frontmatter `name` only supplies the suffix.
- `rpiv-pi` should document a pipeline, not just a catalog.
- The README should explain visible side effects, not hook internals.
- The current compatibility path for `pi-permission-system` is legacy and should be removed from code and docs.

### Precedents & Lessons
- `8610ae5` — refactored the orchestrator into focused modules; docs need to reflect ownership boundaries.
- `74b1cbb` — guidance resolver expansion; lifecycle wording must stay accurate.
- `d484cb3` — README-only rework; easy to ship, easy to under-specify.

### Historical Context (from thoughts/)
- `thoughts/shared/designs/2026-04-13_17-00-00_extract-rpiv-plugins.md` — sibling-plugin extraction and migration design.
- `thoughts/shared/research/2026-04-13_16-11-41_extract-rpiv-core-tools-into-prerequisite-plugins.md` — earlier prerequisite-plugin research.
- `thoughts/shared/research/2026-04-12_02-27-43_skill-flow-chaining.md` — pipeline chaining background.
- `thoughts/shared/research/2026-04-13_08-24-28_pi-claude-md-subfolder-resolution.md` — depth-aware guidance behavior.

### Developer Context
**Q (`extensions/rpiv-core/index.ts:38-46`):** The `active_agent` seed workaround is only for `pi-permission-system`. Should the README mention it as a startup detail, or keep it out of onboarding?
A: Remove that piece of code; that extension is no longer required and we do not want to handle it.

### Related Research
- Questions source: `thoughts/shared/questions/2026-04-13_23-21-05_rework-readme-professional-setup.md`
- `thoughts/shared/research/2026-04-13_16-11-41_extract-rpiv-core-tools-into-prerequisite-plugins.md`
- `thoughts/shared/research/2026-04-12_02-27-43_skill-flow-chaining.md`

### Open Questions
- None after developer confirmation that the `pi-permission-system` compatibility path should be removed from code and documentation.
