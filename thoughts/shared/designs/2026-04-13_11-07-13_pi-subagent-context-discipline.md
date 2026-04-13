---
date: 2026-04-13T11:07:13-04:00
designer: Claude Code
git_commit: 785e09e
branch: master
repository: rpiv-pi
topic: "pi-subagent context discipline for weak models (GLM-4.7) — turn cap + bundled-agent frontmatter knobs"
tags: [design, pi-subagents, context-window, max-turns, frontmatter, rpiv-core, agents]
status: complete
research_source: "thoughts/shared/research/2026-04-13_10-31-03_pi-subagent-context-management.md"
last_updated: 2026-04-13
last_updated_by: Claude Code
---

# Design: pi-subagent context discipline for weak models (GLM-4.7)

## Summary

Weak models (GLM-4.7) running rpiv-pi subagents routinely blow past 200k tokens (sometimes >1M) inside a single subagent conversation, triggering compaction. This design lands the two highest-leverage mitigations: (1) one rpiv-core `session_start` hook that deep-imports `setDefaultMaxTurns` from `@tintinweb/pi-subagents/src/agent-runner.js` to cap the global default at 10 assistant turns, and (2) frontmatter edits on all 9 bundled agents to add per-agent `max_turns` overrides and `isolated: true` for the 8 that never use extensions. Agent body content (Output Format sections) and skill-prompt wording are NOT changed in this round — deferred to a follow-up design.

## Requirements

- Cap the per-subagent turn budget so weak models cannot loop unboundedly.
- Shrink the tool-schema JSON re-shipped every subagent turn (drop `ask_user_question`, `todo`, `advisor`, `web_*`, MCP tools for agents that never call them).
- Keep `web-search-researcher` functional (needs `web_search` / `web_fetch`, which live in the web-tools extension).
- Guard all new code against the peer dep `@tintinweb/pi-subagents` being absent — rpiv-core must continue to load.
- Deferred to follow-up: agent Output Format verbosity trim; skill-prompt amplifier cleanup.

## Current State Analysis

### Key Discoveries

- `defaultMaxTurns` at `@tintinweb/pi-subagents/src/agent-runner.ts:28` is declared `let ... = undefined` (unlimited) with a CHANGELOG v0.4.0 comment confirming the 50-turn default was intentionally removed.
- Setter `setDefaultMaxTurns(n)` at `agent-runner.ts:37-39` mutates the same module-level `let`; pi-subagents' own internal resolver at `src/index.ts:772` reads it via `getDefaultMaxTurns()` at dispatch time. Jiti's `moduleCache: false` (at `core/extensions/loader.js:225`) isolates **rpiv-core extension** module state per-subagent, but does NOT re-import pi-subagents' own `agent-runner.ts` per-subagent — the host loads pi-subagents once. A parent-session `setDefaultMaxTurns(10)` call is therefore visible to all subsequent subagent dispatches.
- Setters are NOT re-exported from pi-subagents' public `src/index.ts` (only default export at line 197). Must deep-import. Package has no `main` / `exports` field — subpath imports are unrestricted.
- Frontmatter parser at `custom-agents.ts:52-74` accepts `max_turns`, `isolated`, `disallowed_tools`, `extensions`, `disallowed_tools` among others. `isolated: true` at `agent-runner.ts:175-176` forces `extensions = false` + `skills = false` — smallest possible tool schema.
- All 9 bundled agents in `agents/*.md` ship only `name` / `description` / `tools` frontmatter — zero usage of the 5+ tuning knobs the parser exposes.
- Grep across `agents/*.md` for every skill name returns only descriptive nouns in prose — zero skill invocations, so `isolated: true` stripping `skills` is verified safe.
- 2 of 9 agents already have the `CRITICAL: Use EXACTLY this format` directive (`integration-scanner.md:52`, `precedent-locator.md:86`). The other 7 have verbose Output Format examples — `codebase-pattern-finder.md:48-158` is worst at 107 lines with 3 full JavaScript code blocks.
- `rpiv-core` has no existing `await import()` dynamic-import pattern. `package-checks.ts:33-35`'s `hasPiSubagentsInstalled()` reads `~/.pi/agent/settings.json` — it confirms registration, not actual module resolvability.
- `extensions/rpiv-core/agents.ts:53-56` is copy-if-missing for bundled agents. Developer is sole user; force-refresh via existing `/rpiv-update-agents` is sufficient — no version-stamp machinery needed.

## Scope

### Building

- New `extensions/rpiv-core/subagent-tuning.ts` module: `applySubagentTuning(pi)` function that dynamically imports `setDefaultMaxTurns` and calls it with `10`, guarded by `hasPiSubagentsInstalled()` + try/catch on the import.
- `extensions/rpiv-core/index.ts` session_start hook additions: call `applySubagentTuning(pi)`.
- Frontmatter edits on 9 bundled agents: add `max_turns` (10 for locators, 15 for analyzers); add `isolated: true` on 8 (all except `web-search-researcher`).

### Not Building (this round)

- **Agent Output Format trim.** Bodies of `agents/*.md` (Output Format sections, CRITICAL directive, dropping demonstrative code blocks, removing `## Important Guidelines` / `## What NOT to Do` tails) stay as-is. Developer deferred.
- **Skill-prompt amplifier cleanup.** `skills/*/SKILL.md` dispatch prompts retain current wording ("thoroughly", "Focus on DEPTH", "comprehensive", etc.). Developer deferred.
- **Cross-session guidance dedup.** Research Q3/Q4 flagged `pi.setData`/`pi.getData` or `globalThis` Map as options. Novel architectural work.
- **Return-size cap.** `record.result` stored uncapped at `agent-manager.ts:172`; `get_subagent_result` returns it uncapped at `index.ts:1022`. No in-package lever; would require upstream patch to pi-subagents.
- **`MAX_CONCURRENT` foreground-bypass fix** (`agent-manager.ts:107-111`). Separate concurrency concern.
- **`verbose: true` forbidding on `get_subagent_result`.** Grep shows zero callers today.
- **`graceTurns` change.** Keep default 5.
- **Version-stamped auto-refresh of `.pi/agents/`.** Not needed — sole user is the developer; existing `/rpiv-update-agents` suffices.
- **`setMaxConcurrent` wiring.**

## Decisions

### D1 — Global default_max_turns value

Set `setDefaultMaxTurns(10)` on session_start. Per-agent frontmatter raises to 15 for analyzers (codebase-analyzer, thoughts-analyzer, codebase-pattern-finder) that read many files per call.

- **Ambiguity**: How aggressive a floor? 10 / 15 / 20.
- **Explored**:
  - A (10 + per-agent override): forces GLM-4.7 to wrap in ≤10 assistant turns (+5 grace = 15 hard). Per-agent overrides give analyzers headroom.
  - B (15 global, no override): single-knob, relies on graceTurns for headroom.
  - C (20 global): near v0.3.x's 50-turn legacy default; weak-model improvement is marginal.
- **Decision**: A. Resolution precedence at `agent-runner.ts:312` is `options.maxTurns ?? agentConfig?.maxTurns ?? defaultMaxTurns` — frontmatter cleanly raises the floor per-agent.

### D2 — Tool-schema suppression knob

Add `isolated: true` to 8 of 9 bundled agents (all except `web-search-researcher`, which needs `web_search`/`web_fetch` from the web-tools extension).

- **Ambiguity**: `isolated: true` vs `extensions: false` vs surgical `disallowed_tools: ask_user_question,todo,advisor,web_search,web_fetch`.
- **Explored**:
  - A (isolated:true uniform): `agent-runner.ts:175-176` forces `extensions=false` + `skills=false`. Strips ask_user_question/todo/advisor/web_* AND all MCP tools AND skills. Smallest schema.
  - B (tiered): locators `isolated`, analyzers `extensions:false`. Functionally equivalent to A since skill usage is verified zero.
  - C (surgical disallowed_tools): keeps MCP tools and skill channel. Less aggressive cut; extensions still bind and re-fire session_start inside each subagent.
- **Decision**: A. Grep verified zero skill invocations across all 9 bundled agents. MCP tools are never consulted by pure locators/analyzers — no reason to preserve their schemas.

### D3 — Output Format trim strategy (DEFERRED)

Deferred to a follow-up design at developer direction. Research identifies `codebase-pattern-finder.md` (107 lines of Output Format with 3 fabricated JS code blocks) and `thoughts-analyzer.md:115-135` (duplicate `## Example Transformation`) as the highest-leverage trim targets; template shape at `integration-scanner.md:52` / `precedent-locator.md:86` is already proven. Re-open as a separate design when ready.

### D4 — Refresh path for existing users

No new code. Developer runs existing `/rpiv-update-agents` after merging. Bundled agent edits land in-place in `agents/*.md`.

- **Ambiguity**: Version-stamp auto-refresh vs documented manual run vs unconditional force-overwrite.
- **Decision**: Documented manual. User confirmed sole developer — no external user base to coordinate with.

### D5 — Deep-import guard pattern

Three-layer guard: `hasPiSubagentsInstalled()` outer check + `try { const mod = await import("@tintinweb/pi-subagents/src/agent-runner.js") } catch` + optional-chain on the imported symbol (`mod.setDefaultMaxTurns?.(10)`).

- **Evidence**: No precedent for dynamic-import in rpiv-core (`advisor.ts` uses static import on always-resolvable `@mariozechner/pi-ai`). `hasPiSubagentsInstalled()` reads `~/.pi/agent/settings.json` — may lie about actual resolvability. Three-layer guard is defensive but cheap.
- **Decision**: Use all three layers. Silent failure mode (no notify) — if pi-subagents is missing, rpiv-core already notifies via the existing `/rpiv-setup` toast at `index.ts:98-104`.

### D6 — Call site for the setter

Call `applySubagentTuning(pi)` once in `session_start` (after existing wiring at `index.ts:41-105`). No `before_agent_start` re-application.

- **Evidence**: Precedent `be0a014` shows pi-permission-system overrides rpiv-core mutations on `before_agent_start`. But `setDefaultMaxTurns` mutates `agent-runner.ts`'s module-level `let`, read by pi-subagents' own resolver at `src/index.ts:772` at dispatch time — nothing else writes it.
- **Decision**: session_start only.

## Architecture

### extensions/rpiv-core/subagent-tuning.ts — NEW

One-line purpose: dynamic-import guard + setter caller for pi-subagents' `setDefaultMaxTurns`.

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

### extensions/rpiv-core/index.ts:19-47 — MODIFY

One-line purpose: import `applySubagentTuning` and call from session_start after `restoreAdvisorState`.

```typescript
// Add alongside other imports at line 19-26 area:
import { applySubagentTuning } from "./subagent-tuning.js";

// Inside the session_start handler, insert AFTER the existing
// `restoreAdvisorState(ctx, pi);` call at line 47 (before the todoOverlay
// construction at line 51). The hook is async-fire-and-returns-void —
// pi's session_start handlers are already declared async.
		await applySubagentTuning(pi);
```

### agents/codebase-locator.md — MODIFY

One-line purpose: add `max_turns: 10` + `isolated: true` frontmatter (body unchanged — Output Format trim deferred).

```markdown
# Insert these two lines at line 5 (before the closing `---`). No body changes.
max_turns: 10
isolated: true
```

### agents/thoughts-locator.md — MODIFY

One-line purpose: add `max_turns: 10` + `isolated: true` frontmatter (body unchanged).

```markdown
# Insert at line 5 (before closing `---`). No body changes.
max_turns: 10
isolated: true
```

### agents/integration-scanner.md — MODIFY

One-line purpose: add `max_turns: 10` + `isolated: true` frontmatter (Output Format already disciplined — no body changes).

```markdown
# Insert these two lines at line 5 (before the closing `---` on line 5).
# No other changes to this file.
max_turns: 10
isolated: true
```

### agents/test-case-locator.md — MODIFY

One-line purpose: add `max_turns: 10` + `isolated: true` frontmatter (body unchanged).

```markdown
# Insert at line 5 (before closing `---`). No body changes.
max_turns: 10
isolated: true
```

### agents/precedent-locator.md — MODIFY

One-line purpose: add `max_turns: 10` + `isolated: true` frontmatter (Output Format already disciplined — no body changes).

```markdown
# Insert these two lines at line 5 (before the closing `---`).
max_turns: 10
isolated: true
```

### agents/codebase-analyzer.md — MODIFY

One-line purpose: add `max_turns: 15` + `isolated: true` frontmatter (body unchanged).

```markdown
# Insert at line 5 (before closing `---`). No body changes.
max_turns: 15
isolated: true
```

### agents/thoughts-analyzer.md — MODIFY

One-line purpose: add `max_turns: 15` + `isolated: true` frontmatter (body unchanged).

```markdown
# Insert at line 5 (before closing `---`). No body changes.
max_turns: 15
isolated: true
```

### agents/codebase-pattern-finder.md — MODIFY

One-line purpose: add `max_turns: 15` + `isolated: true` frontmatter (body unchanged — Output Format trim deferred to follow-up).

```markdown
# Insert at line 5 (before closing `---`). No body changes.
max_turns: 15
isolated: true
```

### agents/web-search-researcher.md — MODIFY

One-line purpose: add `max_turns: 10` frontmatter only (NO `isolated` — needs web_* extensions; body unchanged).

```markdown
# Insert at line 5 (before closing `---`). No body changes. NO isolated key —
# this agent needs the web-tools extension for web_search / web_fetch.
max_turns: 10
```

### skills/*/SKILL.md — NOT MODIFIED THIS ROUND

Skill-prompt amplifier cleanup (research, research-questions, research-solutions, code-review, design, iterate-plan, write-test-cases) deferred at developer direction. Re-open as a separate design when ready.

## Desired End State

A fresh `pi` session in a rpiv-pi-using project logs no new UI noise but:
- `setDefaultMaxTurns(10)` has run before the first Agent-tool dispatch.
- Spawning `Agent(subagent_type: "codebase-locator", prompt: "...")` resolves `maxTurns = 10` (frontmatter), runs with 10-turn soft limit + 5 grace.
- The same dispatch sees only built-in tools (read/bash/edit/write/grep/find/ls minus `isolated` exclusions) in its tool schema — no ask_user_question, todo, advisor, web_*, or MCP tools.
- The locator's output follows the `CRITICAL: Use EXACTLY this format` skeleton, not a 27-line demonstrative example.

Shell check:

```bash
grep -l "max_turns:" /Users/sguslystyi/rpiv-pi/agents/*.md | wc -l   # → 9
grep -l "isolated: true" /Users/sguslystyi/rpiv-pi/agents/*.md | wc -l   # → 8
```

## File Map

```
extensions/rpiv-core/subagent-tuning.ts  # NEW   — dynamic-import guard + setDefaultMaxTurns caller
extensions/rpiv-core/index.ts            # MODIFY — wire applySubagentTuning into session_start
agents/codebase-locator.md               # MODIFY — frontmatter add (max_turns:10, isolated:true)
agents/thoughts-locator.md               # MODIFY — frontmatter add (max_turns:10, isolated:true)
agents/integration-scanner.md            # MODIFY — frontmatter add (max_turns:10, isolated:true)
agents/test-case-locator.md              # MODIFY — frontmatter add (max_turns:10, isolated:true)
agents/precedent-locator.md              # MODIFY — frontmatter add (max_turns:10, isolated:true)
agents/codebase-analyzer.md              # MODIFY — frontmatter add (max_turns:15, isolated:true)
agents/thoughts-analyzer.md              # MODIFY — frontmatter add (max_turns:15, isolated:true)
agents/codebase-pattern-finder.md        # MODIFY — frontmatter add (max_turns:15, isolated:true)
agents/web-search-researcher.md          # MODIFY — frontmatter add (max_turns:10 only; NO isolated)
```

1 NEW, 10 MODIFY. No agent bodies changed. No skill files changed.

## Ordering Constraints

- Slice 1 (hook) lands before Slice 2 (frontmatter) for reviewer self-consistency; runtime order is unconstrained (frontmatter wins regardless).
- `/rpiv-update-agents` must be run by the developer ONCE after merge to refresh `<cwd>/.pi/agents/` working copies.

## Verification Notes

- **Hook applies before first dispatch**: after `pi` starts in a rpiv-pi project, before any Agent-tool call, check rpiv-core logs (if any) or run a trivial Agent dispatch and observe the subagent terminates at ~10-15 assistant turns rather than running unbounded. Spot-check by running a deliberately-open-ended locator prompt.
- **pi-subagents absent**: temporarily remove `@tintinweb/pi-subagents` from `~/.pi/agent/settings.json`'s `packages` list; rpiv-core must still load without crash or error toast. `applySubagentTuning` must degrade silently.
- **Module identity**: open `agent-runner.ts` in node_modules and add a `console.log('[agent-runner] module instance', Math.random())` near the top; confirm the log fires exactly once across a parent + 3 subagent dispatches — verifies pi-subagents' own code is NOT re-imported per-subagent (jiti `moduleCache: false` affects only the rpiv-core extension reload path).
- **Frontmatter parse**: run `pi` in a fresh project, open `/agents` menu; each bundled agent displays `Max turns: 10` or `15`; isolated agents show no extension tools.

## Performance Considerations

The whole design IS the performance work. Secondary effects:
- Fewer tokens re-shipped per subagent turn (extension + MCP tool schemas dropped).
- Shorter assistant messages (no minimum-output-contract from verbose examples).
- Bounded turn loop (soft 10, hard 15) — eliminates the >1M-token tail.

No new runtime cost: session_start hook is one `await import()` + one function call; ~1ms at worst.

## Migration Notes

Not applicable in the schema-migration sense. Developer runs `/rpiv-update-agents` once post-merge to refresh `<cwd>/.pi/agents/` working copies. No data migration, no rollback concern beyond `git revert`.

## Pattern References

- `extensions/rpiv-core/advisor.ts:137-171` — graceful-degradation pattern when a dependency (model registry lookup) misses; the novel `await import()` guard in `subagent-tuning.ts` follows the same spirit.
- `extensions/rpiv-core/package-checks.ts:33-35` — `hasPiSubagentsInstalled()` outer check (reused, not modified).
- `agents/integration-scanner.md:52` — `CRITICAL: Use EXACTLY this format. Never use markdown tables. Use relative paths...` — exact template shape for Output Format directive.
- `agents/precedent-locator.md:86` — `CRITICAL: Use EXACTLY this format. Be concise — commit hashes and dates are the evidence, not prose.` — alternative template shape.
- `extensions/rpiv-core/index.ts:41-105` — canonical session_start wiring pattern (sequence of register/restore/warn calls).

## Developer Context

**Q1 (scope) — Which levers to bundle into this design?**
A: Initially answered **Mid-scope bundle** (turn-cap + frontmatter + Output Format + skill cleanup). **Later narrowed** to turn-cap + frontmatter only (Slices 1 + 2). Output Format trim and skill-prompt cleanup deferred to follow-up designs.

**Q2 (turn cap) — Global defaultMaxTurns value?**
A: **10 global + per-agent override.** Analyzers raised to 15 via frontmatter; locators stay at 10.

**Q3 (tool schema) — Suppression knob?**
A: **`isolated: true` on 8 of 9 bundled agents.** Verified via grep that bundled agents never invoke any skill, so the skills-off side-effect is safe. `web-search-researcher` excluded because it needs `web_search`/`web_fetch` from the web-tools extension.

**Q4 (refresh) — How do existing users pick up new bundled agents?**
A: **No new machinery.** User confirmed sole developer; existing `/rpiv-update-agents` suffices.

**Q5 (micro-checkpoint during Slice 4 generation) — Modify agent Output Formats this round?**
A: **No — defer.** Developer explicitly stated "at this stage" — intended as a separate pass. Slice 3 (codebase-pattern-finder full rewrite) rolled back; Slice 4 (6 other agents) never generated; Slice 5 (skill prompts) also deferred.

**Verified during research phase (not re-asked):**
- Parser default for `prompt_mode` is `"replace"` (not `"append"`) — the premise of the question artifact was inverted. No action needed on prompt-inheritance.
- `inherit_context` is opt-in only; zero agents set it; no guardrail needed.
- `setDefaultMaxTurns` mutation is visible to all future subagent dispatches — pi-subagents' own code is NOT re-imported per-subagent via jiti.

## Design History

- Slice 1: Turn-cap session_start hook — approved as generated
- Slice 2: Bundled-agent frontmatter pass — approved as generated (all 9 files, frontmatter-only additions)
- Slice 3 (Output Format trim — codebase-pattern-finder) — **descoped at developer direction**; initial draft superseded
- Slice 4 (Output Format trim — other 6 agents) — **descoped at developer direction**
- Slice 5 (Skill-prompt amplifier cleanup) — **descoped at developer direction**

Remaining scope = Slice 1 + Slice 2 only.

## References

- Research: `thoughts/shared/research/2026-04-13_10-31-03_pi-subagent-context-management.md`
- Question: `thoughts/shared/questions/2026-04-13_09-54-21_pi-subagent-context-management.md`
- Related research: `thoughts/shared/research/2026-04-13_08-51-45_todo-propagation-subagents.md` (jiti `moduleCache: false` isolation mechanism)
- Related research: `thoughts/shared/research/2026-04-11_07-16-31_pi-subagents-alt-library.md` (inherit_context megabomb documentation)
- Pattern template: `extensions/rpiv-core/advisor.ts` (graceful-degradation precedent for missing dependency)
- Pattern template: `agents/integration-scanner.md`, `agents/precedent-locator.md` (disciplined Output Format references)
