---
date: 2026-04-12T00:00:00Z
researcher: Claude Code
git_commit: 920c276
branch: master
repository: rpiv-pi
topic: "Skill flow chaining with context clearing"
tags: [research-questions, skill-system, session-management, flow-orchestration]
status: complete
last_updated: 2026-04-12
last_updated_by: Claude Code
---

# Research Questions: Skill Flow Chaining with Context Clearing

## Discovery Summary

Discovery agents comprehensively mapped the pi skill system architecture, session lifecycle management, and state persistence mechanisms. The skill loading system in `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/skills.js` discovers and parses `SKILL.md` files with frontmatter, while `agent-session.js`'s `_expandSkillCommand()` method expands `/skill:name` commands into full skill content. Session lifecycle is orchestrated through events (`session_start`, `session_compact`, `session_shutdown`, `session_tree`) in `extensions/rpiv-core/index.ts`, with state persistence patterns demonstrated in `todo.ts` (snapshot-based replay from conversation entries) and `guidance.ts` (injection tracking with marker files). Tools like `advisor.ts` show how in-process LLM invocation works via `completeSimple()`, and the TUI system in `interactive-mode.js` manages slash commands and autocomplete. Current skill chaining is manual — skills reference other skills via `/skill:name` text that users must invoke, with no automated flow execution or context clearing between steps.

## Questions

1. Trace how a `/skill:name` command flows through the system — from the user input handler in `interactive-mode.js`, through the skill expansion logic in `agent-session.js`'s `_expandSkillCommand()` method (lines 808-842), the skill loading via `skills.js`'s `loadSkillFromFile()` and `loadSkills()` functions, the system prompt integration in `system-prompt.js`'s `buildSystemPrompt()` calling `formatSkillsForPrompt()`, and finally the skill content being delivered to the LLM. This matters for understanding where we could intercept to add flow chaining metadata.

2. Explain how session lifecycle events orchestrate state management — from the `session_start` event handler in `extensions/rpiv-core/index.ts` (lines 40-101) that initializes todo state, copies agents, and seeds permissions, through `session_compact` (lines 103-107) that clears injection state and reconstructs todo, to `session_shutdown` (lines 109-113) that disposes the todo overlay. This matters for understanding where we could inject flow state and where context clearing happens.

3. Describe how tools persist state across session boundaries — from the `todo` tool's state storage in `todo.ts`'s module-level `tasks` and `nextId` variables (lines 90-91), through the `reconstructTodoState()` function (lines 528-572) that walks `ctx.sessionManager.getBranch()` to restore state from `AgentToolResult.details` envelopes, to the `applyTaskMutation()` reducer (lines 123-269) that enforces invariants. This matters for understanding how flow metadata could be persisted similarly.

4. Trace how the advisor tool implements advisor-strategy pattern with in-process LLM invocation — from the `registerAdvisorTool()` in `advisor.ts`, through the `executeAdvisor()` function (lines 135-259) that calls `completeSimple()` with the serialized conversation via `serializeConversation()`, to the advisor model selection stored in the module-level `selectedAdvisor` variable (line 72) that resets each session. This matters for understanding how skills could invoke other flows programmatically.

5. Analyze how guidance injection state is managed across tool calls — from the `handleToolCallGuidance()` function in `guidance.ts` (lines 43-78) that checks `isInjected()` via `session-state.js`, through the module-level `injectedGuidance` Set (line 18), to the `clearInjectionState()` calls on `session_compact` and `session_shutdown` in `index.ts`. This matters for understanding a pattern for tracking flow execution state.

6. Explain how slash commands are registered and executed — from the `registerTodosCommand()` in `todo.ts` (lines 621-645) calling `pi.registerCommand()`, through the TUI integration using `ctx.ui.custom()` for interactive selection panels, to how commands can invoke tools or trigger other operations. This matters for understanding how we could add flow-specific commands for starting/chaining flows.

7. Trace how subagents are dispatched and their results retrieved — from skills calling the `Agent` tool with `subagent_type` parameter (as seen in research-questions skill), through `@tintinweb/pi-subagents` package's agent discovery in `<cwd>/.pi/agents/`, to the `get_subagent_result()` tool that retrieves background agent output. This matters for understanding how flows could dispatch background work and resume.

8. Describe the extension event system's capabilities — from the event subscriptions in `index.ts` including `session_start`, `session_compact`, `session_shutdown`, `session_tree`, `tool_call`, `tool_execution_end`, and `before_agent_start`, through how extensions receive `ExtensionContext` and can call `pi.appendEntry()` to add session data, to the `ExtensionUIContext` for widget registration. This matters for understanding all available hooks for flow orchestration.

9. Analyze how session branching and switching works in `SessionManager` — from the `getBranch()` method used by `todo.ts` (line 499) and `advisor.ts` (line 125) to retrieve conversation entries, through how sessions can be compacted with `compact()` in `agent-session.js`, to the `session_tree` event that fires when the conversation tree changes. This matters for understanding whether flow state needs to be branch-aware.

10. Trace how skills currently chain to each other — from the `/skill:design` reference in `write-plan/SKILL.md` (line 34), through the `/skill:research` chain in `research-questions/SKILL.md` (line 180), to the `/skill:implement-plan` chain in `validate-plan/SKILL.md` (lines 169-171), noting that these are text references the user must manually invoke. This matters for understanding the current manual chaining pattern we need to automate.
