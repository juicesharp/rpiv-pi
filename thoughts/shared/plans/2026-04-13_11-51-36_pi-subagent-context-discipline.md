---
date: 2026-04-13T11:51:36-04:00
planner: Claude Code
git_commit: 7525a5db3ee2b2bfa1ac6739895222ee788f267d
branch: master
repository: rpiv-pi
topic: "pi-subagent context discipline for weak models (GLM-4.7) — turn cap + bundled-agent frontmatter knobs"
tags: [plan, pi-subagents, context-window, max-turns, frontmatter, rpiv-core, agents]
status: ready
design_source: "thoughts/shared/designs/2026-04-13_11-07-13_pi-subagent-context-discipline.md"
last_updated: 2026-04-13
last_updated_by: Claude Code
---

# pi-subagent context discipline Implementation Plan

## Overview

Weak models (GLM-4.7) routinely blow past 200k tokens inside a single rpiv-pi subagent conversation. This plan implements the two highest-leverage mitigations from the design: (1) an rpiv-core `session_start` hook that dynamic-imports `setDefaultMaxTurns` from `@tintinweb/pi-subagents/src/agent-runner.js` and caps the global default at 10 assistant turns, and (2) per-agent frontmatter additions on all 9 bundled agents (`max_turns` + `isolated: true` for 8 of 9). Agent bodies and skill prompts are NOT changed this round.

Design source: `thoughts/shared/designs/2026-04-13_11-07-13_pi-subagent-context-discipline.md`

## Desired End State

A fresh `pi` session in an rpiv-pi-using project produces no new UI noise but:
- `setDefaultMaxTurns(10)` has run before the first Agent-tool dispatch.
- Spawning `Agent(subagent_type: "codebase-locator", prompt: "...")` resolves `maxTurns = 10` from frontmatter, runs with 10-turn soft + 5 grace.
- The same dispatch sees only built-in tools in its schema — no `ask_user_question`, `todo`, `advisor`, `web_*`, or MCP tools.
- `web-search-researcher` retains its extension tools (no `isolated`).
- rpiv-core continues to load cleanly when `@tintinweb/pi-subagents` is absent.

Shell verification:

```bash
grep -l "max_turns:" /Users/sguslystyi/rpiv-pi/agents/*.md | wc -l   # → 9
grep -l "isolated: true" /Users/sguslystyi/rpiv-pi/agents/*.md | wc -l   # → 8
```

## What We're NOT Doing

- **Agent body edits.** Output Format sections, CRITICAL directives, demonstrative code blocks, `## Important Guidelines` / `## What NOT to Do` tails — all deferred to a follow-up design.
- **Skill-prompt amplifier cleanup.** `skills/*/SKILL.md` dispatch prompts retain current wording.
- **Cross-session guidance dedup** (`pi.setData`/`pi.getData` or `globalThis` Map).
- **Return-size cap** on `record.result` / `get_subagent_result` (would require upstream patch).
- **`MAX_CONCURRENT` foreground-bypass fix.**
- **Forbidding `verbose: true` on `get_subagent_result`.**
- **`graceTurns` change** — keep default 5.
- **Version-stamped auto-refresh of `.pi/agents/`** — sole developer runs existing `/rpiv-update-agents`.
- **`setMaxConcurrent` wiring.**

## Phase 1: Turn-cap session_start hook

### Overview

Introduce `extensions/rpiv-core/subagent-tuning.ts` exposing `applySubagentTuning(pi)` — a guarded dynamic-import caller for pi-subagents' `setDefaultMaxTurns(10)`. Wire one `await applySubagentTuning(pi)` call into the existing `session_start` handler in `extensions/rpiv-core/index.ts` after `restoreAdvisorState`.

### Changes Required:

#### 1. Subagent tuning module
**File**: `extensions/rpiv-core/subagent-tuning.ts` (NEW)
**Changes**: New module. Deep-imports `setDefaultMaxTurns` from `@tintinweb/pi-subagents/src/agent-runner.js` with a three-layer guard: outer `hasPiSubagentsInstalled()` check, try/catch around the dynamic import, optional-chain on the imported symbol. Silent on failure — the existing `/rpiv-setup` toast already notifies when the peer dep is missing.

```typescript
/**
 * subagent-tuning — applies rpiv-pi defaults to @tintinweb/pi-subagents.
 *
 * Deep-imports setDefaultMaxTurns from pi-subagents' agent-runner and sets
 * the global default to 10. Per-agent frontmatter can raise the floor; the
 * resolver at pi-subagents/src/agent-runner.ts:312 prefers agentConfig.maxTurns.
 *
 * Guarded so rpiv-core continues to load when the optional peer dep is absent.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { hasPiSubagentsInstalled } from "./package-checks.js";

const DEFAULT_MAX_TURNS = 10;

export async function applySubagentTuning(_pi: ExtensionAPI): Promise<void> {
	if (!hasPiSubagentsInstalled()) return;
	try {
		const mod = await import("@tintinweb/pi-subagents/src/agent-runner.js");
		mod.setDefaultMaxTurns?.(DEFAULT_MAX_TURNS);
	} catch {
		// Peer resolvable per settings.json but module missing/renamed — silent.
	}
}
```

#### 2. Session_start wiring
**File**: `extensions/rpiv-core/index.ts`
**Changes**: Add import for `applySubagentTuning` alongside the other extension-local imports. Inside the `session_start` handler, insert `await applySubagentTuning(pi);` after the existing `restoreAdvisorState(ctx, pi);` call (around line 47) and before the `todoOverlay` construction (around line 51). The handler is already async.

```typescript
// Add alongside other imports at line 19-26 area:
import { applySubagentTuning } from "./subagent-tuning.js";

// Inside the session_start handler, insert AFTER the existing
// `restoreAdvisorState(ctx, pi);` call at line 47 (before the todoOverlay
// construction at line 51). The hook is async-fire-and-returns-void —
// pi's session_start handlers are already declared async.
		await applySubagentTuning(pi);
```

### Success Criteria:

#### Automated Verification:
- [x] File exists: `test -f extensions/rpiv-core/subagent-tuning.ts`
- [~] Type checking passes: N/A — no `typecheck` script; Pi loads TS directly
- [~] Linting passes: N/A — no `lint` script in package.json
- [~] Build passes: N/A — no `build` script; Pi loads TS directly
- [x] Import wired: `grep -c "applySubagentTuning" extensions/rpiv-core/index.ts` returns ≥ 2 (import + call)
- [x] Setter referenced: `grep -q "setDefaultMaxTurns" extensions/rpiv-core/subagent-tuning.ts`

#### Manual Verification:
- [ ] Start `pi` in an rpiv-pi-using project; no new error toast, no crash.
- [ ] With `@tintinweb/pi-subagents` temporarily removed from `~/.pi/agent/settings.json`'s `packages` list, `pi` still starts cleanly — `applySubagentTuning` degrades silently.
- [ ] Module-identity check: add a temporary `console.log('[agent-runner]', Math.random())` near the top of `node_modules/@tintinweb/pi-subagents/src/agent-runner.ts`; spawn a parent + 3 subagent dispatches; the log fires exactly once (confirms pi-subagents is not re-imported per-subagent).
- [ ] With the hook active and no frontmatter override (temporarily test via an inline agent), a deliberately-open-ended subagent dispatch terminates at ~10-15 assistant turns rather than running unbounded.

---

## Phase 2: Bundled-agent frontmatter

### Overview

Add `max_turns` and (where applicable) `isolated: true` frontmatter keys to all 9 bundled agents in `agents/`. Locators get `max_turns: 10`; analyzers get `max_turns: 15`; `web-search-researcher` gets `max_turns: 10` only (NO `isolated` — needs `web_search` / `web_fetch` from the web-tools extension). All 8 non-web agents get `isolated: true`. No body changes.

Phase 2 is independent of Phase 1 at runtime (resolution precedence at `agent-runner.ts:312` is `options.maxTurns ?? agentConfig?.maxTurns ?? defaultMaxTurns` — frontmatter wins regardless). **Phases 1 and 2 can run in parallel.**

### Changes Required:

#### 1. Locator agents (max_turns: 10 + isolated: true)
**File**: `agents/codebase-locator.md`
**Changes**: Insert two lines before the closing `---` of the frontmatter block. No body changes.

```markdown
max_turns: 10
isolated: true
```

**File**: `agents/thoughts-locator.md`
**Changes**: Insert two lines before the closing `---` of the frontmatter block. No body changes.

```markdown
max_turns: 10
isolated: true
```

**File**: `agents/integration-scanner.md`
**Changes**: Insert two lines before the closing `---` of the frontmatter block. No body changes (Output Format already disciplined).

```markdown
max_turns: 10
isolated: true
```

**File**: `agents/test-case-locator.md`
**Changes**: Insert two lines before the closing `---` of the frontmatter block. No body changes.

```markdown
max_turns: 10
isolated: true
```

**File**: `agents/precedent-locator.md`
**Changes**: Insert two lines before the closing `---` of the frontmatter block. No body changes (Output Format already disciplined).

```markdown
max_turns: 10
isolated: true
```

#### 2. Analyzer agents (max_turns: 15 + isolated: true)
**File**: `agents/codebase-analyzer.md`
**Changes**: Insert two lines before the closing `---` of the frontmatter block. No body changes.

```markdown
max_turns: 15
isolated: true
```

**File**: `agents/thoughts-analyzer.md`
**Changes**: Insert two lines before the closing `---` of the frontmatter block. No body changes.

```markdown
max_turns: 15
isolated: true
```

**File**: `agents/codebase-pattern-finder.md`
**Changes**: Insert two lines before the closing `---` of the frontmatter block. No body changes (Output Format trim deferred to follow-up).

```markdown
max_turns: 15
isolated: true
```

#### 3. Web-search agent (max_turns only, NO isolated)
**File**: `agents/web-search-researcher.md`
**Changes**: Insert one line before the closing `---` of the frontmatter block. **Do NOT add `isolated: true`** — this agent needs the web-tools extension for `web_search` / `web_fetch`. No body changes.

```markdown
max_turns: 10
```

### Success Criteria:

#### Automated Verification:
- [x] All 9 bundled agents have `max_turns:`: `[ "$(grep -l 'max_turns:' agents/*.md | wc -l | tr -d ' ')" = "9" ]`
- [x] Exactly 8 bundled agents have `isolated: true`: `[ "$(grep -l 'isolated: true' agents/*.md | wc -l | tr -d ' ')" = "8" ]`
- [x] `web-search-researcher.md` does NOT have `isolated`: `! grep -q 'isolated' agents/web-search-researcher.md`
- [x] Locators at 10: `grep -l 'max_turns: 10' agents/*.md` lists `codebase-locator.md`, `thoughts-locator.md`, `integration-scanner.md`, `test-case-locator.md`, `precedent-locator.md`, `web-search-researcher.md` (6 files)
- [x] Analyzers at 15: `grep -l 'max_turns: 15' agents/*.md` lists `codebase-analyzer.md`, `thoughts-analyzer.md`, `codebase-pattern-finder.md` (3 files)
- [x] Agent bodies unchanged — `git diff --stat agents/*.md` shows only frontmatter-line additions (2 lines per file for the 8 `isolated` agents, 1 line for `web-search-researcher`).

#### Manual Verification:
- [ ] Run `/rpiv-update-agents` in an rpiv-pi-using project to refresh `<cwd>/.pi/agents/` copies.
- [ ] Open `/agents` menu in `pi`; each bundled agent displays its declared `Max turns: 10` or `15`.
- [ ] `isolated` agents show no extension tools, no skills channel, no MCP tools in their dispatch tool schema.
- [ ] `web-search-researcher` still shows `web_search` / `web_fetch` in its tool schema.
- [ ] Spawn a deliberately-open-ended `codebase-locator` prompt; it terminates at ≤15 assistant turns (10 soft + 5 grace).
- [ ] Spot-check that no bundled agent actually invokes a skill (design's grep already verified — this is a post-change sanity run): `grep -l 'Skill\|skill(' agents/*.md` returns empty or matches only prose references.

---

## Testing Strategy

### Automated:

- Type check / lint / build for Phase 1's TypeScript module.
- Shell greps for frontmatter presence, counts, and per-file values for Phase 2.
- `git diff --stat agents/*.md` to confirm no body changes.

### Manual Testing Steps:

1. **Clean session smoke test.** Start `pi` in an rpiv-pi-using project. Confirm no new error toast, no crash.
2. **Peer-dep-absent regression.** Temporarily remove `@tintinweb/pi-subagents` from `~/.pi/agent/settings.json` `packages`. Restart `pi`. Confirm rpiv-core loads; `applySubagentTuning` degrades silently. Restore settings.
3. **Module-identity verification.** In `node_modules/@tintinweb/pi-subagents/src/agent-runner.ts`, add a temporary `console.log('[agent-runner]', Math.random())` near the top. Run a parent + 3 subagent dispatches. Confirm the log fires exactly once — verifies pi-subagents is not re-imported per-subagent. Remove the log.
4. **Turn-cap end-to-end.** Spawn a deliberately-open-ended `codebase-locator` dispatch. Observe it terminates at ~10-15 assistant turns rather than running unbounded.
5. **Agent menu display.** Open `/agents` menu. Confirm each bundled agent shows its `Max turns` value.
6. **Tool schema for isolated agents.** Spawn a `codebase-locator` dispatch; inspect its available tools (via logging or `/agents` inspection). Confirm no `ask_user_question`, `todo`, `advisor`, `web_*`, or MCP tools present.
7. **web-search-researcher untouched.** Spawn a `web-search-researcher` dispatch; confirm `web_search` and `web_fetch` are still available.
8. **Post-merge refresh.** Run `/rpiv-update-agents` once in a project that already has `<cwd>/.pi/agents/` populated; confirm new frontmatter is copied into the working set.

## Performance Considerations

The whole plan IS the performance work. Secondary effects:
- Fewer tokens re-shipped per subagent turn (extension + MCP tool schemas dropped from 8 of 9 agents).
- Bounded turn loop (soft 10 / 15, hard +5 grace) — eliminates the >1M-token tail.

No new runtime cost: session_start hook is one `await import()` + one function call; ~1ms at worst.

## Migration Notes

Not applicable in the schema-migration sense. Developer runs `/rpiv-update-agents` once post-merge to refresh `<cwd>/.pi/agents/` working copies. No data migration, no rollback concern beyond `git revert`.

## References

- Design: `thoughts/shared/designs/2026-04-13_11-07-13_pi-subagent-context-discipline.md`
- Research: `thoughts/shared/research/2026-04-13_10-31-03_pi-subagent-context-management.md`
- Question: `thoughts/shared/questions/2026-04-13_09-54-21_pi-subagent-context-management.md`
- Related research: `thoughts/shared/research/2026-04-13_08-51-45_todo-propagation-subagents.md` (jiti `moduleCache: false` isolation mechanism)
- Related research: `thoughts/shared/research/2026-04-11_07-16-31_pi-subagents-alt-library.md` (inherit_context megabomb)
- Pattern template: `extensions/rpiv-core/advisor.ts:137-171` (graceful-degradation precedent)
- Pattern template: `extensions/rpiv-core/package-checks.ts:33-35` (`hasPiSubagentsInstalled`)
- Pattern template: `extensions/rpiv-core/index.ts:41-105` (session_start wiring)
