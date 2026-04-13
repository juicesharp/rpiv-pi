---
date: 2026-04-13T08:24:28-04:00
researcher: Claude Code
git_commit: 333949d
branch: master
repository: rpiv-pi
topic: "Pi CLAUDE.md subfolder resolution + extension adoption for annotate-inline (reuse/extend the .rpiv/guidance/ extension)"
tags: [research, codebase, pi-sdk, resource-loader, guidance-injection, annotate-inline, extensions]
status: complete
questions_source: "thoughts/shared/questions/2026-04-13_08-20-00_pi-claude-md-subfolder-resolution.md"
last_updated: 2026-04-13
last_updated_by: Claude Code
---

# Research: Pi CLAUDE.md subfolder resolution + extension adoption for annotate-inline

## Research Question
Pi's SDK only auto-loads `CLAUDE.md`/`AGENTS.md` from `cwd` and its ancestors — the subfolder `CLAUDE.md` files produced by `annotate-inline` (`extensions/rpiv-core/CLAUDE.md`, `scripts/CLAUDE.md`, `skills/CLAUDE.md`, `agents/CLAUDE.md`, `.pi/agents/CLAUDE.md`) are silently ignored. How should the existing `.rpiv/guidance/` injection extension be reused or extended to surface those files, what shape must the new code take, and how does it coexist with Pi's built-in loader?

## Summary
- **The gap is real and narrow.** Pi's `loadProjectContextFiles` at `resource-loader.js:48-76` walks strictly upward (`resolve(currentDir, "..")` fixed-point loop); there is no `readdirSync` on cwd anywhere in the SDK's context-file path. `<cwd>/CLAUDE.md` IS loaded on the loop's first iteration, but every `CLAUDE.md` strictly below cwd is invisible.
- **Only two SDK seams are reachable from an `ExtensionAPI` consumer.** `agentsFilesOverride` (`resource-loader.d.ts:87-97`) is a `DefaultResourceLoader` constructor option — reachable only by an embedding CLI, not by a plugin loaded via `"extensions": [...]`. Extensions can use either `pi.on("tool_call", ...)` + `pi.sendMessage({display:false})` (lazy) or `before_agent_start` returning `{message}`/`{systemPrompt}` (eager).
- **The reference implementation already solves 95% of the problem.** `extensions/rpiv-core/guidance.ts:22-107` implements an ancestor-walking resolver with session-scoped dedup, `display:false` injection, and clear discipline across `session_start`/`session_compact`/`session_shutdown` (`index.ts:42, 108, 115`). The only per-depth difference for a CLAUDE.md loader is the candidate filename list.
- **Decision (developer checkpoint).** Extend `guidance.ts` in place — single resolver, single handler, single dedup Set — with per-depth priority **AGENTS.md > CLAUDE.md > `.rpiv/guidance/<sub>/architecture.md`** (first-match wins at each depth). Skip depth=0 for AGENTS.md/CLAUDE.md only (Pi already loads those); keep depth=0 for architecture.md.

## Detailed Findings

### 1. Pi's ancestor-only walk (feature gap)
`loadProjectContextFiles({cwd, agentDir})` at `resource-loader.js:48-76`:
- Seeds with `loadContextFileFromDir(resolvedAgentDir)` at line 53 (global `~/.pi/agent/` context).
- Loop at lines 61-73: starts at `currentDir = resolvedCwd`, calls `loadContextFileFromDir(currentDir)` (line 62), `unshift`s matches into `ancestorContextFiles` (line 64) so ordering is shallowest-first, terminates on `currentDir === root` or `resolve(currentDir, "..") === currentDir`.
- Line 74 concatenates `contextFiles.push(...ancestorContextFiles)` → final order: `[global, /, …, cwd]`.
- `loadContextFileFromDir` (lines 30-46) tries `["AGENTS.md", "CLAUDE.md"]` and returns the FIRST existing file — at most one context file per directory.
- The only `readdirSync` anywhere in the SDK's context path is `loadThemesFromDir` (lines 550-578) — not context files. No descent into cwd's subtree.

### 2. `buildSystemPrompt` consumption and caching
`system-prompt.js:15-27` (customPrompt branch) and `:99-106` (default branch) both render every `{path, content}` as:
```
# Project Context

Project-specific instructions and guidelines:

## <filePath>

<content>

```
Consumption chain: `agent-session.js:643-647` — `_rebuildSystemPrompt` pulls `this._resourceLoader.getAgentsFiles().agentsFiles` and feeds `buildSystemPrompt()`. Call sites at `:558`, `:625`, `:1629`. `this._baseSystemPrompt` is cached and reused per turn; `before_agent_start` only overwrites `this.agent.state.systemPrompt` transiently (`:767-773`) and explicitly resets to `_baseSystemPrompt` when no handler modifies it (`:772`). Freshness: files are re-read ONLY in `DefaultResourceLoader.reload()` at `resource-loader.js:320-322` — i.e., only on `/reload` per `CHANGELOG.md:1303`.

### 3. Extension seams available today
- **`agentsFilesOverride`** at `resource-loader.d.ts:87-97` — `(base: {agentsFiles}) => {agentsFiles}`. Applied at `resource-loader.js:320-322`. Constructor option. NOT on `ExtensionAPI` (`extensions/types.d.ts:747-761`). Unreachable to plugins.
- **`before_agent_start`** at `extensions/types.d.ts:400-406, 653-657, 713` → invoked by `extensions/runner.js:581-628`, applied at `agent-session.js:750-773`. Return `{message: {customType, content, display:false}}` → pushed as `role: "custom"` conversation entry. Return `{systemPrompt}` → replaces `agent.state.systemPrompt` for one turn only.
- **`pi.on("tool_call")`** — already used at `index.ts:135-137`. Fires per tool call; combined with `pi.sendMessage({customType, display:false})` delivers lazy, per-file content.

### 4. `guidance.ts` algorithm + state model (the reference)
`resolveGuidance(filePath, projectDir)` at `guidance.ts:22-51`:
- Line 23-24: `dirname(filePath)` → `relative(projectDir, fileDir)`.
- Line 27-29: traversal guard returns `[]` when file is outside project.
- Line 31: `parts = relativeDir ? relativeDir.split(sep) : []`.
- Line 34-48: `for (let depth = 0; depth <= parts.length; depth++)` — `<=` yields `N+1` iterations; depth=0 is the cwd-root, depth=parts.length is the touched file's own directory.
- Line 36-38: candidate path is `join(".rpiv", "guidance", subPath, "architecture.md")` (with special-case for `subPath === ""`).
- Line 41-47: `existsSync` gate, sync `readFileSync`, `relativePath` normalized to forward slashes (line 43) → stable dedup key across platforms.

Session state: `injectedGuidance = new Set<string>()` at `guidance.ts:58`; `clearInjectionState()` at `:60-62`; wired in `index.ts:42, 108, 115` (session_start, session_compact, session_shutdown).

Handler at `guidance.ts:72-107`:
- Line 77: tool-name gate `["read","edit","write"]`.
- Line 79-80: `file_path ?? path` fallback across tool input conventions.
- Line 85-91: filter-then-mark; marks before `sendMessage` (idempotence > reliability).
- Line 94-106: label extraction, join with `---` separator, `pi.sendMessage({customType:"rpiv-guidance", display:false})`.

### 5. What `annotate-inline` actually produces
`skills/annotate-inline/SKILL.md`:
- `:41-73` — Initial pass creates root + one-per-layer CLAUDE.md; Decomposition pass adds subfolder CLAUDE.md for composite layers.
- `:159-176` — drafts subfolder files FIRST (≤100 lines), then compact root; explicit anti-duplication rule at :171.
- `:200-217` — Pass 3 `Write`s all files at once.
- `:270-282` — depth rules: create CLAUDE.md at architectural layers, skip when same-pattern-as-parent.

Repo today (committed in `333949d`): subfolder CLAUDE.md at `extensions/rpiv-core/`, `scripts/`, `skills/`, `agents/`, `.pi/agents/`. All invisible to Pi when launched from `/Users/sguslystyi/rpiv-pi`.

### 6. Shape decision (per developer checkpoint)
Extend `guidance.ts` — single module, single handler, single dedup Set. Reject the "parallel `claude-md.ts` sibling module" option to avoid coexistence complexity and logic duplication. Resolver becomes multi-candidate per depth:

Per-depth candidate order (first-match wins, at most one file per depth):
1. `<subPath>/AGENTS.md`
2. `<subPath>/CLAUDE.md`
3. `.rpiv/guidance/<subPath>/architecture.md`

Depth-0 special case:
- Skip candidates 1–2 (Pi's loader at `resource-loader.js:62` first iteration already loads `<cwd>/AGENTS.md` or `<cwd>/CLAUDE.md` into `agentsFiles`).
- Keep candidate 3 — `<cwd>/.rpiv/guidance/architecture.md` is NOT seen by Pi's loader.

Dedup: existing `injectedGuidance: Set<string>` keyed on `relativePath` (forward-slash-normalized) works unchanged — CLAUDE.md paths and `.rpiv/guidance/…/architecture.md` paths never collide.

Labels: render `## Project Guidance: <label>` (generalized from current `## Architecture Guidance:`), where label is derived:
- `extensions/rpiv-core/AGENTS.md` → `extensions/rpiv-core (AGENTS.md)`
- `scripts/CLAUDE.md` → `scripts (CLAUDE.md)`
- `.rpiv/guidance/scripts/architecture.md` → `scripts (architecture.md)`

customType may remain `"rpiv-guidance"` (no renderer distinguishes today, per precedent agent finding).

### 7. Rejected alternatives (and why)
- **Eager `before_agent_start` bulk walker** (mirror `index.ts:140-157` git-context): visible from turn 0, but full content re-sent every turn. Branch accumulates N copies unless additional cross-turn dedup is added, defeating the simplicity win. Also requires descending walk of cwd subtree — new code path not already present in `guidance.ts`.
- **`agentsFilesOverride`**: requires forking `@mariozechner/pi-coding-agent` to expose the option on `ExtensionAPI`. Out of scope for "out-of-the-box experience."
- **Parallel `claude-md.ts` module**: rejected by developer — "I would exclude doubling of logic because other way we have to find way for both extension to coexist."
- **Global CLAUDE.md-silences-architecture.md rule**: risks dropping guidance at depths the CLAUDE.md doesn't cover.
- **Emit both CLAUDE.md + architecture.md at same depth**: doubles token cost; per-depth first-match-wins matches Pi's own contract.

## Code References
- `extensions/rpiv-core/guidance.ts:22-51` — `resolveGuidance` resolver loop (extend candidate list here)
- `extensions/rpiv-core/guidance.ts:34` — `for (let depth = 0; depth <= parts.length; depth++)` — add depth-0 skip for AGENTS/CLAUDE candidates
- `extensions/rpiv-core/guidance.ts:36-38` — single candidate path (replace with candidate loop)
- `extensions/rpiv-core/guidance.ts:58` — `injectedGuidance: Set<string>` — reuse unchanged
- `extensions/rpiv-core/guidance.ts:60-62` — `clearInjectionState` — reuse unchanged
- `extensions/rpiv-core/guidance.ts:72-107` — `handleToolCallGuidance` (labels at :94-100 need generalized format)
- `extensions/rpiv-core/index.ts:42, 108, 115` — `clearInjectionState()` wiring — unchanged
- `extensions/rpiv-core/index.ts:135-137` — existing `tool_call` hook — unchanged (single handler)
- `extensions/rpiv-core/CLAUDE.md:74-76` — "NO ExtensionAPI in utility modules" — preserved (guidance.ts keeps pi param only on handler)
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/resource-loader.js:30-46` — `loadContextFileFromDir` (AGENTS.md > CLAUDE.md per-dir precedence reference)
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/resource-loader.js:48-76` — `loadProjectContextFiles` ancestor-only walk
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/resource-loader.js:320-322` — `reload()` + `agentsFilesOverride` invocation
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/resource-loader.d.ts:87-97` — override signature
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/system-prompt.js:21-27, 99-106` — `# Project Context` rendering template
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session.js:625-654` — `_rebuildSystemPrompt` pulling `getAgentsFiles()`
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session.js:750-773` — `before_agent_start` application
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/runner.js:581-628` — `emitBeforeAgentStart` chain semantics
- `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts:400-406, 653-657, 713, 747-761` — event types + `ExtensionAPI` surface
- `skills/annotate-inline/SKILL.md:41-73` — target determination (root + subfolder)
- `skills/annotate-inline/SKILL.md:159-176` — drafting order + anti-duplication rule
- `skills/annotate-inline/SKILL.md:270-282` — depth rules

## Integration Points

### Inbound References
- `extensions/rpiv-core/index.ts:19` — imports `clearInjectionState`, `handleToolCallGuidance` from `./guidance.js`
- `extensions/rpiv-core/index.ts:135-137` — `pi.on("tool_call")` → `handleToolCallGuidance(event, ctx, pi)`
- `extensions/rpiv-core/index.ts:42, 108, 115` — three lifecycle resets

### Outbound Dependencies
- `guidance.ts:8` — `node:fs` (`existsSync`, `readFileSync`)
- `guidance.ts:9` — `node:path` (`dirname`, `relative`, `sep`, `isAbsolute`, `join`)
- `guidance.ts:10` — `@mariozechner/pi-coding-agent` (`ExtensionAPI` type only)

### Infrastructure Wiring
- `extensions/rpiv-core/index.ts:135-137` — `pi.on("tool_call")` registration site
- `package.json` `"extensions": ["./extensions"]` — Pi auto-discovery of the extension
- `pi.sendMessage({customType:"rpiv-guidance", display:false})` at `guidance.ts:102-106` — the conversation channel

### External to Pi (still covered by Pi's own loader, NOT by this extension)
- `<cwd>/AGENTS.md`, `<cwd>/CLAUDE.md` — resolved by `loadContextFileFromDir(cwd)` at `resource-loader.js:62` (first loop iteration)
- `<ancestor>/AGENTS.md`, `<ancestor>/CLAUDE.md` — resolved by the upward walk at `resource-loader.js:61-73`
- `~/.pi/agent/AGENTS.md`, `~/.pi/agent/CLAUDE.md` — resolved by `loadContextFileFromDir(resolvedAgentDir)` at `resource-loader.js:53`

## Architecture Insights

- **Per-depth first-match is the native Pi contract** (`resource-loader.js:30-46`). Mirroring it inside the extended resolver keeps semantics predictable: at each directory depth there is ONE authoritative file. AGENTS.md and CLAUDE.md are treated as same-category (Pi does this too) with AGENTS.md wins; `.rpiv/guidance/.../architecture.md` is a lower-priority fallback unique to this project.
- **Lazy per-`tool_call` injection is strictly cheaper than eager per-turn injection** when the user only touches a subset of the project. `guidance.ts`'s `injectedGuidance.clear()` on compaction is load-bearing — without it, post-compact sessions would lose context silently because the LLM forgets but the Set remembers.
- **`display: false` custom messages survive in the branch.** This means `session_tree` replay does NOT re-play them (branch-replay just reads existing entries), and the dedup Set is about avoiding *new* duplicate injections across a live session — not about replay correctness. This is why `session_tree` at `index.ts:121-124` does NOT call `clearInjectionState()`.
- **The only extension-visible `ExtensionAPI` channels for context injection are conversation-level** (`sendMessage`, `before_agent_start.message`). System-prompt-level injection is cached, lacks a renderer, and is unreachable without a fork. Any future work to "properly" inject subfolder CLAUDE.md into the `# Project Context` section requires upstream SDK changes (exposing `agentsFilesOverride` on `ExtensionAPI`).
- **`.rpiv/guidance/` and CLAUDE.md are not competitors.** The per-depth first-match rule makes them a priority ladder: a directory that has CLAUDE.md uses CLAUDE.md; a directory that doesn't but has a `.rpiv/guidance/.../architecture.md` uses that. Authors can mix them freely across the tree.

## Precedents & Lessons
3 similar past changes analyzed. Key commits: `a01a4a3` (initial port of `.rpiv/guidance/` resolver from CC hooks), `8610ae5` (split monolith into `guidance.ts` — zero follow-up fixes since), `333949d` (added the 5 subfolder CLAUDE.md files that trigger this feature).

- **State-reset discipline is the single most repeated rule.** Clear the dedup Set from all three of `session_start`, `session_compact`, `session_shutdown`; do NOT clear from `session_tree`. Applies unchanged to the extended resolver — `injectedGuidance` remains shared across both CLAUDE.md and architecture.md paths.
- **Utility modules stay `pi`-free** (`extensions/rpiv-core/CLAUDE.md:74-76`). The refactor into candidate loop does not change this — `resolveGuidance` takes only `(filePath, projectDir)`; `handleToolCallGuidance` is the only function that imports/uses `pi`.
- **Two delivery paths have already drifted.** The CC-hooks implementation at `scripts/handlers/inject-guidance.js` + `scripts/lib/resolver.js` uses SHA-256 marker files; the Pi extension uses an in-memory Set. If the CLAUDE.md extension writes to `guidance.ts`, the CC-hooks resolver should be updated in parallel OR explicitly scoped to `.rpiv/guidance/` only (root `CLAUDE.md:17-23` already notes hooks are "not yet well battle-tested"). Recommendation: update `scripts/lib/resolver.js` with the same candidate ladder so the two paths stay semantically equivalent.
- **Use a stable `customType`.** `rpiv-guidance` is fine for the extended resolver — no renderer consumes it today. Only introduce a new `customType` if future message filtering needs to discriminate CLAUDE.md from architecture.md entries.
- **annotate-inline has been stable since `66eaea3`** (no follow-up fixes). The producer format (CLAUDE.md ≤100 lines, Write at Pass 3) is the locked contract this extension consumes.

## Historical Context (from thoughts/)
- `thoughts/shared/questions/2026-04-13_08-20-00_pi-claude-md-subfolder-resolution.md` — driving research-questions doc for this topic
- `thoughts/shared/plans/2026-04-10_12-46-17_complete-pi-migration.md` — CC→Pi migration plan that originally landed `guidance.ts`
- `thoughts/shared/research/2026-04-10_13-45-00_complete-pi-migration.md` — pre-refactor map of `extensions/rpiv-core/index.ts`; documents `customType` surface
- `thoughts/shared/designs/2026-04-10_11-18-29_complete-pi-migration.md` — design-level write-up of the CC→Pi guidance migration
- `thoughts/MIGRATION.md` — living migration tracker

## Developer Context
**Q (`extensions/rpiv-core/guidance.ts:34-48`, `index.ts:135-137`): Which architectural shape should the new extension take — lazy tool_call (mirror `guidance.ts`), eager before_agent_start (mirror `index.ts:140-157` git-context), or hybrid?**
A: Extend `guidance.ts` in place to support CLAUDE.md with priority over architecture.md. Exclude duplication; avoid coexistence complexity between two extensions. Prefer an out-of-the-box experience for the rpiv-pi developer.

**Q (`guidance.ts:34-48` vs Pi's `resource-loader.js:30-46`): When CLAUDE.md and `.rpiv/guidance/<sub>/architecture.md` both exist at the same depth, what is the precedence?**
A: Per-depth first-match. CLAUDE.md wins at that depth; architecture.md is skipped at that depth only. Other depths without CLAUDE.md still render their architecture.md.

**Q (`guidance.ts:34-48` depth=0 vs `resource-loader.js:62`): Should the walker skip depth=0 for CLAUDE.md to avoid double-injecting `<cwd>/CLAUDE.md` (which Pi already loads)?**
A: Skip depth=0 for AGENTS.md/CLAUDE.md only; keep depth=0 for `.rpiv/guidance/architecture.md` (that path is NOT seen by Pi's loader).

**Q (`resource-loader.js:30-46` vs new walker): Should the subfolder walker honor AGENTS.md per Pi's contract?**
A: Yes — AGENTS.md > CLAUDE.md per depth, mirror Pi's contract. Future-proofs annotate-inline if it ever emits AGENTS.md.

## Related Research
- Questions source: `thoughts/shared/questions/2026-04-13_08-20-00_pi-claude-md-subfolder-resolution.md`
- Migration series: `thoughts/shared/{questions,research,designs,plans}/2026-04-10_*complete-pi-migration.md`

## Open Questions
- **Parallel update of `scripts/lib/resolver.js` (CC hooks path).** The Pi extension and the CC hooks already use different dedup strategies; extending only the Pi path widens the drift. Does the rpiv-pi developer want the CC hooks resolver updated in the same change, or is the CC hooks path frozen / deprecated? (Root `CLAUDE.md:17-23` flags it as "not yet well battle-tested".)
- **`session_tree` behavior for the extended resolver.** Current `guidance.ts` does NOT clear state on `session_tree` (`index.ts:121-124` is overlay-only). Confirm this remains correct when subfolder CLAUDE.md is also in the mix — branch replay is expected to surface previously-injected entries automatically, but this should be smoke-tested after implementation.
