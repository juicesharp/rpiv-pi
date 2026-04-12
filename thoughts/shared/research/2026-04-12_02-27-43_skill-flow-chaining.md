---
date: 2026-04-12T02:27:43Z
researcher: Claude Code
git_commit: 920c276
branch: master
repository: rpiv-pi
topic: "Skill flow chaining with context clearing"
tags: [research, skill-system, session-management, flow-orchestration, context-clearing, rpiv-core]
status: complete
questions_source: "thoughts/shared/questions/2026-04-12_skill-flow-chaining.md"
last_updated: 2026-04-12
last_updated_by: Claude Code
---

# Research: Skill Flow Chaining with Context Clearing

## Research Question
How to implement automated skill flow chaining that creates a fresh session (like `/new`) between each skill step, passing only artifact files forward?

## Summary
The pi skill system uses manual text-based chaining — skills emit `/skill:name path` instructions that users must type. The `/new` command (`interactive-mode.js:3848`) creates an entirely fresh session via `runtimeHost.newSession()`, which is the desired behavior between flow steps. Only files on disk (artifacts in `thoughts/shared/`) survive a session reset. Extension commands registered via `pi.registerCommand()` can call `ctx.newSession()` and `pi.sendUserMessage()` to orchestrate session resets and auto-invoke the next skill. The implementation should be an extension command `/research-pipeline` that tracks the pipeline definition, creates new sessions between steps, and auto-invokes the next skill with the artifact path.

## Detailed Findings

### Skill Command Flow
The `/skill:name` command flow has three distinct layers:

1. **Interactive mode** (`interactive-mode.js:1715`) — editor submit handler passes text to `session.prompt()` without intercepting skill commands
2. **Agent session** (`agent-session.js:660`) — `prompt()` checks for extension commands first (`_tryExecuteExtensionCommand` at line 668), then expands skill commands via `_expandSkillCommand()` at line 690
3. **Skill expansion** (`agent-session.js:808-842`) — reads the skill file, strips frontmatter, wraps in `<skill>` XML block, appends user args. The expanded text becomes a user message sent to the LLM

Extension commands are intercepted **before** skill expansion — `pi.registerCommand()` handlers execute entirely in extension code and never reach the LLM. This is the correct hook point for `/research-pipeline`.

The same `_expandSkillCommand()` is called from `steer()` (line 859) and `followUp()` (line 884), so skill expansion works during streaming too.

### Session Lifecycle and Context Clearing
Session state management follows two patterns:

**Persistent (todo pattern)**: State embedded in tool result `details` field, persisted as session entries, reconstructed by walking `ctx.sessionManager.getBranch()` on `session_start`, `session_compact`, and `session_tree` events (`todo.ts:528-542`).

**Transient (guidance pattern)**: Module-level `Set<string>` tracking injected guidance files, cleared on `session_start`, `session_compact`, and `session_shutdown` (`guidance.ts:18-21`), rebuilt incrementally via `tool_call` events.

For flow chaining, **neither pattern applies** because `/new` creates an entirely new session — the old session's entries are gone. Only disk artifacts survive. This is the correct behavior: the flow orchestrator passes artifact file paths between steps.

### `/new` Command — Full Session Reset
`handleClearCommand()` at `interactive-mode.js:3848` calls `runtimeHost.newSession()`. Extension commands can do the same via `ctx.newSession()` (exposed at `interactive-mode.js:907-917`). This:
- Creates a fresh `SessionManager` and `AgentSession`
- Fires `session_shutdown` on the old session and `session_start` on the new one
- Clears all in-memory state (todo tasks, guidance injection, advisor selection)
- Preserves only files on disk

### Extension Command Capabilities
Extension commands registered via `pi.registerCommand()` receive a `ctx` object with:
- `ctx.newSession(options)` — create new session (`interactive-mode.js:907`)
- `ctx.ui.setEditorText(text)` — inject text into editor (`interactive-mode.js:1317`)
- `ctx.ui.notify(message, type)` — toast notifications (`interactive-mode.js:1293`)
- `ctx.ui.custom(factory)` — arbitrary custom TUI component (`interactive-mode.js:1311`)
- `ctx.hasUI` — boolean for interactive mode check

The extension API (`pi`) provides:
- `pi.sendMessage(message, options)` — inject messages into conversation (`agent-session.js:1723`)
- `pi.sendUserMessage(content, options)` — send as user message (`agent-session.js:1726`)
- `pi.appendEntry(customType, data)` — persist custom data in session (`agent-session.js:1734`)
- `pi.registerTool(config)` — register tools visible to the LLM
- `pi.registerCommand(name, options)` — register slash commands

### Current Skill Chaining DAG
16 skills organized into 4 pipelines, all using manual `/skill:name` text references:

**Main development pipeline** (the target for automation):
```
research-questions → research → design → write-plan → implement-plan
                     research → research-solutions → design (alternate)
```

**Chain locations** (file:line of forward chain text):
- `research-questions/SKILL.md:180` — "When ready, run `/skill:research ...`"
- `research/SKILL.md:261` — "When ready: `/skill:design ...`"
- `design/SKILL.md:363` — "When ready, run `/skill:write-plan ...`"
- `write-plan/SKILL.md:192` — "When ready, run `/skill:implement-plan ...`"

**Artifact contract**: Each skill produces a `.md` file with YAML frontmatter + structured sections. The receiving skill reads specific sections:
- research-questions → research: questions artifact with Discovery Summary + dense question paragraphs
- research → design: research artifact with Code References + Integration Points + Architecture Insights
- design → write-plan: design artifact with Architecture + File Map + Ordering Constraints

### Subagent System (pi-subagents)
The `@tintinweb/pi-subagents` extension registers three tools: `Agent`, `get_subagent_result`, `steer_subagent`. Key constraints:
- Each subagent gets a **fresh in-memory session** (`SessionManager.inMemory()`) — no parent messages by default
- Subagents **cannot spawn further subagents** (`EXCLUDED_TOOL_NAMES = ["Agent","get_subagent_result","steer_subagent"]` at `agent-runner.js:33`)
- Agent definitions come from `.pi/agents/*.md` files with YAML frontmatter for tools, model, prompt_mode
- Background agents have 4-concurrent limit with queue, auto-cleanup after 10 minutes
- Foreground agents block the parent until complete

The subagent pattern is NOT the right approach for flow chaining because: (1) the parent session accumulates all subagent results, defeating context clearing; (2) subagents can't spawn subagents, limiting pipeline depth; (3) the goal is to reset the PARENT session, not create isolated child sessions.

### Advisor Tool — In-Process LLM Pattern
The advisor tool demonstrates in-process LLM invocation via `completeSimple()` with serialized context (`advisor.ts:153`). The context curation pipeline (`getBranch()` → filter → `convertToLlm()` → `serializeConversation()`) is reusable. However, this pattern is for same-session escalation, not cross-session flow chaining.

### Session Branching and Tree Navigation
`SessionManager` (`session-manager.js`) implements an append-only tree stored as JSONL. `getBranch()` at line 356 walks from current leaf to root. Branching moves the `leafId` pointer. `session_tree` events trigger state reconstruction. This is relevant for understanding session internals but NOT needed for flow chaining — `/new` bypasses branching entirely.

## Code References
- `agent-session.js:808-842` — `_expandSkillCommand()`: skill expansion core
- `agent-session.js:660-740` — `prompt()`: command dispatch + skill expansion entry
- `interactive-mode.js:3848-3871` — `handleClearCommand()`: `/new` session creation
- `interactive-mode.js:907-917` — `newSession()`: extension-accessible session creation
- `interactive-mode.js:272-285` — skill command autocomplete registration
- `interactive-mode.js:1288-1367` — `createExtensionUIContext()`: UI methods available to extensions
- `skills.js:225-275` — `loadSkillFromFile()`: skill discovery and parsing
- `skills.js:277-302` — `formatSkillsForPrompt()`: XML skill metadata in system prompt
- `system-prompt.js:8-118` — `buildSystemPrompt()`: prompt construction including skills
- `slash-commands.js:1-24` — `BUILTIN_SLASH_COMMANDS`: hardcoded command list
- `todo.ts:86-91` — module-level state variables
- `todo.ts:123-269` — `applyTaskMutation()`: pure reducer for state transitions
- `todo.ts:528-542` — `reconstructTodoState()`: branch-walking state reconstruction
- `guidance.ts:18-21` — `injectedGuidance` Set: transient state tracking
- `guidance.ts:43-78` — `handleToolCallGuidance()`: tool-call-hook state injection
- `advisor.ts:72` — `selectedAdvisor`: in-memory model selection
- `advisor.ts:99-213` — `executeAdvisor()`: in-process LLM invocation pipeline
- `advisor.ts:153-158` — `completeSimple()` call: provider resolution chain
- `index.ts:40-101` — `session_start` handler: state initialization
- `index.ts:103-107` — `session_compact` handler: state reset + reconstruction
- `index.ts:109-113` — `session_shutdown` handler: full teardown
- `index.ts:116-119` — `session_tree` handler: branch-switch state reconstruction
- `session-manager.js:356-365` — `getBranch()`: tree path walker
- `session-manager.js:424-430` — `branch()`: leaf pointer movement
- `research-questions/SKILL.md:180` — forward chain to `/skill:research`
- `research/SKILL.md:261` — forward chain to `/skill:design`
- `design/SKILL.md:363` — forward chain to `/skill:write-plan`
- `write-plan/SKILL.md:192` — forward chain to `/skill:implement-plan`

## Integration Points

### Inbound References
- `interactive-mode.js:545` — `session.prompt(userInput)`: main input path for all user commands
- `interactive-mode.js:272-285` — skill autocomplete: registers `/skill:name` commands from loaded skills
- `agent-session.js:660` — `prompt()`: central dispatch for commands, skills, and LLM interaction
- `index.ts:137-139` — `tool_call` handler: intercepts read/edit/write for guidance injection

### Outbound Dependencies
- `agent-session.js:642-646` — `getSkills()`: loads skill definitions into system prompt
- `skills.js:279-370` — `loadSkills()`: discovers skills from user/project/path locations
- `session-manager.js:298-307` — `appendMessage()`: persists tool results with `details` envelopes
- `pi-ai/stream.js:22-25` — `completeSimple()`: in-process LLM completion (used by advisor)

### Infrastructure Wiring
- `index.ts:40-43` — tool/command registration: `registerTodoTool`, `registerAdvisorTool`, etc.
- `index.ts:47-101` — `session_start` event: initializes all rpiv-core state
- `index.ts:103-107` — `session_compact` event: clears transient state, reconstructs persistent state
- `index.ts:109-113` — `session_shutdown` event: disposes overlays and clears state
- `agent-session.js:1723-1734` — `sendMessage`/`sendUserMessage`/`appendEntry`: extension message injection
- `interactive-mode.js:907-917` — `newSession()`: extension-accessible session creation (for `/research-pipeline`)

## Architecture Insights

1. **Three command execution models**: Built-in commands (if/else in interactive-mode.js), extension commands (registered via `pi.registerCommand`, intercepted in `prompt()` before skill expansion), skill commands (expanded inline as user message text sent to LLM). Flow orchestration should be an extension command — it runs in extension code and orchestrates the flow.

2. **`/new` is the correct clearing mechanism**: Unlike compaction (which preserves tool results in the kept tail), `/new` via `ctx.newSession()` creates an entirely fresh session. This is the desired behavior — the flow orchestrator calls `ctx.newSession()` between steps.

3. **Artifacts on disk are the inter-skill contract**: Each skill produces a `.md` file consumed by the next. The artifact path is the only data that needs to survive between sessions. This already works.

4. **Extension commands can inject skill invocations**: After `ctx.newSession()`, the orchestrator can use `pi.sendUserMessage()` to auto-invoke the next skill (e.g., `/skill:research thoughts/shared/questions/2026-04-12_...`). This triggers `_expandSkillCommand()` in the new session, loading the skill instructions fresh.

5. **The `before_agent_start` event** (`index.ts:142-155`) can inject hidden context before each LLM turn. For flow orchestration, this could inject a "you are in a pipeline, step N of M" context message without polluting the user-visible conversation.

6. **Tool registration vs activation**: Tools registered via `pi.registerTool()` are only visible to the LLM when in the active tools list (`pi.setActiveTools()`). The advisor demonstrates lazy activation. Flow-specific tools could follow this pattern.

## Precedents & Lessons
6 similar past changes analyzed. Key commits: `66eaea3` (Pi migration), `8610ae5` (module refactor), `33550c5` (todo persistence), `e4e03ab` (advisor tool), `920c276` (skills consolidation).

- **Session state survives via tool result replay** — `todo.ts` writes to `details`, reconstructs via `getBranch()`. But `/new` wipes everything. Only disk artifacts survive a session reset (`33550c5`).
- **`session_compact` clears in-memory state** — guidance injection Set, advisor selection, any transient state. Design for it explicitly or accept that compaction = partial reset (`8610ae5`).
- **Missing `promptSnippet` = invisible tool** — the `ask_user_question` mistake. Every tool registration must include `promptSnippet` and `promptGuidelines` (`e4e03ab`, codified in design doc).
- **Port carryover bugs surface days later** — the `ask_user_question` batching claim was a Claude Code falsehood that survived the Pi port. Scan for platform-specific claims (`66eaea3` + `7f7f25c` fix).
- **Prompt bloat kills skills** — target ≤25 added lines per change. Flow metadata should live in extension code, not SKILL.md prose (`920c276`).
- **Subagents cannot spawn further subagents** — `EXCLUDED_TOOL_NAMES` limits chaining depth. Flow orchestration must happen at the top level (`agent-runner.js:33`).

## Historical Context (from thoughts/)
- `thoughts/shared/research/2026-04-10_13-45-00_complete-pi-migration.md` — Pi migration patterns and pitfalls
- `thoughts/shared/research/2026-04-10_21-53-11_todo-tool-cc-parity.md` — Todo persistence pattern, compaction behavior
- `thoughts/shared/research/2026-04-11_07-16-31_pi-subagents-alt-library.md` — Subagent library constraints, excluded tool names
- `thoughts/shared/research/2026-04-11_07-47-54_design-iterative-question-subagents.md` — Manual chaining limitations, prompt bloat risk
- `thoughts/shared/research/2026-04-11_17-27-55_advisor-strategy-pattern.md` — In-process LLM invocation, context curation pipeline
- `thoughts/shared/designs/2026-04-11_14-10-07_advisor-strategy-pattern.md` — Advisor design with tool activation pattern

## Developer Context
**Q (index.ts:103-107): Should flow state be persistent (todo pattern) or transient (guidance pattern)?**
A: Neither — the goal is full session reset (`/new`) between skill steps. Only artifact files on disk survive. No session-internal state tracking needed.

**Q (research/SKILL.md:261): Should chaining be automatic (LLM self-advances) or user-controlled?**
A: Extension command `/research-pipeline` orchestrates automatically. After each skill completes, the extension creates a new session and auto-invokes the next skill with the artifact path. No LLM self-advance tool needed.

**Q (agent-runner.js:33): Should the flow use subagents for isolation?**
A: No. Subagent results accumulate in the parent session, defeating context clearing. The goal is to reset the parent session itself via `ctx.newSession()`.

## Related Research
- Questions source: `thoughts/shared/questions/2026-04-12_skill-flow-chaining.md`

## Open Questions
1. How to detect when a skill "completes" — the LLM outputs the artifact path + chain text, but there's no structured completion signal. Options: (a) parse the LLM's final message for the artifact path pattern, (b) require skills to produce a specific output format, (c) use a tool call (e.g., a `flow-step-complete` tool) as the completion signal.
2. Whether `pi.sendUserMessage()` after `ctx.newSession()` correctly triggers `_expandSkillCommand()` for the `/skill:name` prefix in the new session.
3. How to handle skill failure — if research-questions produces no questions (empty discovery), should the pipeline halt or skip to the next step?
4. Whether the pipeline should support branching (e.g., research → design OR research → research-solutions) and how the user selects the branch.
