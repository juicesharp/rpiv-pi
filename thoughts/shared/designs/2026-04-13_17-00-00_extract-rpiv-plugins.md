---
date: 2026-04-13T17:00:00-04:00
designer: Claude Code
git_commit: 7525a5d
branch: master
repository: rpiv-pi
topic: "Extract ask_user_question, todo, advisor, and web-tools into 4 prerequisite Pi plugins"
tags: [design, rpiv-core, rpiv-web-tools, plugin-extraction, peer-dependencies, migration, brave-search]
status: complete
research_source: "thoughts/shared/research/2026-04-13_16-11-41_extract-rpiv-core-tools-into-prerequisite-plugins.md"
last_updated: 2026-04-13
last_updated_by: Claude Code
---

# Design: Extract rpiv-core tools into prerequisite plugins

## Summary

Extract four self-contained capabilities currently bundled in `rpiv-pi` into four independently-released Pi plugin packages: `rpiv-ask-user-question`, `rpiv-todo`, `rpiv-advisor`, and `rpiv-web-tools`. After extraction, `rpiv-pi` becomes a skills-and-orchestration package that hard-requires the four siblings plus `@tintinweb/pi-subagents`. All tool names are preserved verbatim; the existing `pi-permission-system` seeder is deleted entirely because Pi runs in YOLO mode by default (no per-call prompts to suppress).

## Requirements

- Each capability ships as its own Pi plugin package with `default export(pi: ExtensionAPI)`.
- `rpiv-pi` retains only orchestration: guidance injection, git-context injection, `thoughts/` scaffolding, agent auto-copy, subagent tuning, `/rpiv-setup`, `/rpiv-update-agents`, and the pi-permission-system-specific `active_agent` workaround.
- `rpiv-pi` expresses its prerequisites via `peerDependencies` + runtime `session_start` warning + `/rpiv-setup` hard-fail with actionable install commands.
- Tool names (`ask_user_question`, `todo`, `advisor`, `web_search`, `web_fetch`) and command names (`/todos`, `/advisor`, `/web-search-config`) are preserved verbatim to avoid breaking skill prose, permission-file entries, branch replay, and overlay refresh.
- Config-file paths for `rpiv-advisor` and `rpiv-web-tools` hard-cut over to plugin-owned directories (`~/.config/rpiv-advisor/advisor.json`, `~/.config/rpiv-web-tools/config.json`). Silent cutover — users re-run `/advisor` and `/web-search-config` once on upgrade.
- Delete `rpiv-pi`'s permissions seeder (`extensions/rpiv-core/permissions.ts`, `templates/pi-permissions.jsonc`, and the session_start call site). Pi has no native per-call prompt; `pi-permission-system` is a user choice, not a `rpiv-pi` dependency.

## Current State Analysis

`extensions/rpiv-core/index.ts` is today the single composition root: it registers six tool/command constructors (`registerAskUserQuestionTool`, `registerTodoTool`, `registerTodosCommand`, `registerAdvisorTool`, `registerAdvisorCommand`, `registerAdvisorBeforeAgentStart`), then attaches seven lifecycle hooks (`session_start`, `session_compact`, `session_shutdown`, `session_tree`, `tool_execution_end`, `tool_call`, `before_agent_start`), then registers two slash commands (`/rpiv-update-agents`, `/rpiv-setup`). `extensions/web-tools/index.ts` is a second, already-isolated extension in the same package.

### Key Discoveries

- Research artifact at `thoughts/shared/research/2026-04-13_16-11-41_extract-rpiv-core-tools-into-prerequisite-plugins.md` establishes that tool names are load-bearing contracts across 30+ skill prose references, permission entries, branch-replay filters, and overlay refresh.
- `extensions/rpiv-core/ask-user-question.ts:17-116` — 117 LOC, stateless, zero sibling imports. Cleanest extraction.
- `extensions/rpiv-core/todo.ts:60-65` module-level `let tasks / let nextId` plus `todo-overlay.ts:19` import of `getTodos/Task/TaskStatus` create an ESM-singleton coupling that must stay intra-plugin.
- `extensions/rpiv-core/todo.ts:502` `reconstructTodoState` filters `msg.toolName === "todo"` — tool name literal pins replay behavior.
- `extensions/rpiv-core/advisor.ts:55` `ADVISOR_CONFIG_PATH = ~/.config/rpiv-pi/advisor.json`; `advisor.ts:139` early-returns when `modelKey` falsy, so a silent cutover to a new config path is detectable only by the user noticing their advisor is disabled.
- `extensions/rpiv-core/advisor.ts:369-378` `before_agent_start` strip is a per-plugin concern that survives extraction (Pi guarantees `session_start` for all extensions completes before any `before_agent_start` fires — runner.js:581-629 accumulates `messages[]` across plugins).
- `extensions/web-tools/index.ts:39` `CONFIG_PATH = ~/.config/rpiv-pi/web-tools.json`; `chmodSync(..., 0o600)` at line 54 — holds Brave API key secret.
- `extensions/rpiv-core/index.ts:69-71` seeds a root `active_agent` session entry gated on `hasPiPermissionSystemInstalled()` — workaround for pi-permission-system@0.4.1's skill-handler bug. Stays in orchestrator.
- **Pi runs YOLO by default.** [Pi author's blog](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/) confirms no native per-call prompts. `pi-permission-system` ADDS prompts; it does not suppress them. The permissions seeder solves a problem only users-of-pi-permission-system have, and they already own their policy file.
- `package.json:18` currently has `@tintinweb/pi-subagents` under `dependencies` — moves to `peerDependencies` alongside the four new plugins.

## Scope

### Building

1. Four new sibling npm packages, each a Pi extension:
   - `rpiv-ask-user-question` — registers `ask_user_question` tool.
   - `rpiv-advisor` — registers `advisor` tool + `/advisor` command + session_start restore + before_agent_start strip.
   - `rpiv-todo` — registers `todo` tool + `/todos` command + 5 lifecycle hooks + `TodoOverlay` widget.
   - `rpiv-web-tools` — registers `web_search` + `web_fetch` tools + `/web-search-config` command.
2. `rpiv-pi` orchestrator cleanup:
   - Delete `extensions/rpiv-core/{ask-user-question.ts, todo.ts, todo-overlay.ts, advisor.ts, permissions.ts}`.
   - Delete `extensions/rpiv-core/templates/pi-permissions.jsonc` and the `templates/` directory if empty.
   - Delete `extensions/web-tools/` entirely.
   - Modify `extensions/rpiv-core/index.ts`: drop extracted imports and registrations; keep guidance, git-context, thoughts scaffold, agent-copy, subagent tuning, `active_agent` workaround, `/rpiv-setup`, `/rpiv-update-agents`. Replace single hardcoded session_start sibling warning with an aggregated loop over four siblings.
   - Modify `extensions/rpiv-core/package-checks.ts`: add `hasRpivAskUserQuestionInstalled`, `hasRpivTodoInstalled`, `hasRpivAdvisorInstalled`, `hasRpivWebToolsInstalled` probes.
   - Modify `package.json`: `@tintinweb/pi-subagents` moves from `dependencies` to `peerDependencies`; four new siblings added to `peerDependencies`.
   - Modify `README.md`: installation instructions list five prerequisites with `pi install` commands; tool-ownership table updated.
3. Each extracted plugin ships a minimal README (description, installation, tool summary). No pi-permission-system mentions — consistent with pi-subagents' precedent of a clean break from that dependency.

### Not Building

- **Fragment-merge permissions seeder.** Seeding is not a problem Pi's native behavior requires solving (Pi is YOLO; pi-permission-system is a user choice with its own policy file).
- **Tool renames.** `ask_user_question`, `todo`, `advisor`, `web_search`, `web_fetch` preserved verbatim.
- **Command renames.** `/todos`, `/advisor`, `/web-search-config`, `/rpiv-setup`, `/rpiv-update-agents` preserved.
- **Pi loader / manifest changes.** No new `pi.dependencies` field — not supported by `@mariozechner/pi-coding-agent`.
- **Per-plugin permission files** — `pi-permission-system` does not aggregate across files.
- **Advisor config migration helper.** Silent hard cutover; users re-run `/advisor` once.
- **Web-tools config migration helper.** Silent hard cutover; users re-run `/web-search-config` once.
- **pi-mono feature request** for a native `pi.dependencies` field — deferred, orthogonal.
- **Changes to `subagent-tuning.ts`** — stays in rpiv-pi, unchanged.
- **Changes to `guidance.ts`** — stays in rpiv-pi, unchanged.
- **Moving `/rpiv-update-agents` or the bundled agents directory** — stays in rpiv-pi.

## Decisions

### D1. Full decomposition: 4 sibling plugins, not a thin orchestrator that imports register functions

Inherited from research Developer Context Q1 (`research.md:258-259`). Each plugin owns its own session_start/hook set. rpiv-pi imports none of the extracted modules at runtime; coupling is via installed-sibling probes and npm `peerDependencies` metadata only.

### D2. Tool + command names preserved verbatim

Evidence: `todo.ts:502` (replay filter), `todo-overlay.ts` (`WIDGET_KEY = "rpiv-todos"` at line 23 — this stays because it's plugin-internal), `index.ts:135` (tool_execution_end filter on `"todo"`), `templates/pi-permissions.jsonc:25-26` (user-owned file entries), 30+ skill prose sites. Renaming would cascade compatibility work not justified by extraction alone.

### D3. Drop pi-permission-system seeder and template entirely; zero mention in plugin READMEs

Pi runs YOLO by default ([Zechner blog post](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/); [pi-mono settings.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/settings.md) has no permission keys). `pi-permission-system` ADDS prompts; it does not suppress them. `@tintinweb/pi-subagents` ships with zero pi-permission-system coupling AND zero permission-system mentions in its README ([DeepWiki usage](https://deepwiki.com/tintinweb/pi-subagents/4-using-the-extension)) — precedent for a clean break. Plugin READMEs do not mention `pi-permission-system`. Users who install a permission extension independently own their policy file and already know how to add allow-list entries for any tool they load.

### D4. Keep `active_agent` workaround in rpiv-pi, gated on `hasPiPermissionSystemInstalled()`

`extensions/rpiv-core/index.ts:69-71` is a targeted workaround for pi-permission-system@0.4.1's skill-handler bug. It's orthogonal to tool extraction — stays in rpiv-pi orchestrator, still probe-gated so users without `pi-permission-system` pay nothing.

### D5. Silent hard config-path cutover for rpiv-advisor and rpiv-web-tools

Inherited from research Developer Context Q2 for advisor (`research.md:261-262`); same pattern applied to web-tools per checkpoint decision. New paths: `~/.config/rpiv-advisor/advisor.json`, `~/.config/rpiv-web-tools/config.json`. `advisor.ts:139` early-returns on missing `modelKey` (silent); `web-tools/index.ts:89-93` throws with an actionable error (`"Run /web-search-config to configure, or export the env var"`) so users get a loud failure on the first web_search call after upgrade. `BRAVE_SEARCH_API_KEY` env var continues to work unchanged (takes precedence at `web-tools/index.ts:61`).

### D6. Dependency expressed via peerDependencies + session_start runtime check + /rpiv-setup hard-fail

Inherited from research Developer Context Q3 (`research.md:264-265`). No native Pi mechanism for plugin-to-plugin deps ([pi-mono packages.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md)). Pattern mirrors VS Code's `extensionDependencies` via Obsidian-style runtime enforcement. rpiv-pi's `session_start` handler builds a `missing: string[]` list mirroring `/rpiv-setup`'s existing pattern and emits one aggregated notification instead of N per-missing-sibling warnings.

### D7. Unscoped package names: `rpiv-*`

Per checkpoint: `rpiv-ask-user-question`, `rpiv-todo`, `rpiv-advisor`, `rpiv-web-tools`. Matches rpiv-pi's current unscoped name. No npm org setup required. Short install commands.

### D8. Atomic 4-file unit for todo extraction

`todo.ts` (769L) + `todo-overlay.ts` (244L) + new plugin `index.ts` (lifts 5 hook call sites from `rpiv-core/index.ts`) + `README.md`. The module-level ESM singleton (`let tasks / let nextId`) is an implicit coupling between tool executor, `/todos` command, `getTodos()`, `renderCall`, `renderResult`, and `TodoOverlay` — turning it into a pi-provided session store is out of scope. Keep singleton inside the extracted plugin.

### D9. web-tools extraction is structurally identical to advisor

One file (`index.ts`) + config path cutover + README. No lifecycle hooks beyond tool/command registration (web-tools has no `session_start` or `before_agent_start` handlers today). Simpler than advisor.

## Architecture

### rpiv-ask-user-question/package.json — NEW

Npm package manifest. Declares Pi extension via root-level `index.ts`; peer-declares the three pi-coding-agent libs the tool uses (no `@mariozechner/pi-ai` — this plugin never calls LLMs).

```json
{
  "name": "rpiv-ask-user-question",
  "version": "0.1.0",
  "description": "Pi extension: structured ask_user_question tool for disambiguation prompts",
  "keywords": ["pi-package", "pi-extension", "rpiv"],
  "type": "module",
  "pi": {
    "extensions": ["./index.ts"]
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-tui": "*",
    "@sinclair/typebox": "*"
  }
}
```

### rpiv-ask-user-question/index.ts — NEW

Pi extension entry point. Single `default export(pi)` that registers the tool.

```typescript
/**
 * rpiv-ask-user-question — Pi extension
 *
 * Registers the `ask_user_question` tool, which surfaces a structured
 * option selector (plus free-text "Other" fallback) to disambiguate
 * underspecified user requests.
 *
 * Extracted from rpiv-pi@7525a5d. Tool name preserved verbatim.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerAskUserQuestionTool } from "./ask-user-question.js";

export default function (pi: ExtensionAPI) {
    registerAskUserQuestionTool(pi);
}
```

### rpiv-ask-user-question/ask-user-question.ts — NEW

Verbatim copy of `extensions/rpiv-core/ask-user-question.ts` from rpiv-pi@7525a5d. Zero edits — the module has no sibling imports.

```typescript
/**
 * ask_user_question tool — replaces Claude Code's AskUserQuestion.
 *
 * Registration function: call registerAskUserQuestionTool(pi) from index.ts.
 */

import { type ExtensionAPI, DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, SelectList, Spacer, Text, type SelectItem } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

export function registerAskUserQuestionTool(pi: ExtensionAPI): void {
    const OptionSchema = Type.Object({
        label: Type.String({ description: "Display label for the option" }),
        description: Type.Optional(Type.String({ description: "Optional description shown below label" })),
    });

    pi.registerTool({
        name: "ask_user_question",
        label: "Ask User Question",
        description:
            "Ask the user a structured question with selectable options. Use when you need user input to proceed — choosing between approaches, confirming scope, resolving ambiguities. The user can also type a custom answer.",
        promptSnippet: "Ask the user a structured question when requirements are ambiguous",
        promptGuidelines: [
            "Use the ask_user_question tool whenever the user's request is underspecified and you cannot proceed without a concrete decision.",
            "Prefer ask_user_question over prose 'please tell me X' — the structured selector gives the user concrete options and records their choice in session history.",
            "This replaces the AskUserQuestion tool from Claude Code. The user can always pick 'Other (type your own answer)' for free-text input.",
        ],
        parameters: Type.Object({
            question: Type.String({ description: "The question to ask the user" }),
            header: Type.Optional(Type.String({ description: "Section header for the question" })),
            options: Type.Array(OptionSchema, { description: "Options for the user to choose from" }),
            multiSelect: Type.Optional(
                Type.Boolean({ description: "Allow multiple selections. Default: false", default: false }),
            ),
        }),

        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            if (!ctx.hasUI) {
                return {
                    content: [{ type: "text", text: "Error: UI not available (running in non-interactive mode)" }],
                    details: { question: params.question, answer: null },
                };
            }

            if (params.options.length === 0) {
                return {
                    content: [{ type: "text", text: "Error: No options provided" }],
                    details: { question: params.question, answer: null },
                };
            }

            const headerPrefix = params.header ? `[${params.header}] ` : "";
            const items = params.options.map(
                (o) => `${o.label}${o.description ? ` — ${o.description}` : ""}`,
            );

            // Add "Other (type something)" option
            const allItems = [...items, "Other (type your own answer)"];

            const choice = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
                const container = new Container();

                container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
                container.addChild(new Spacer(1));
                container.addChild(new Text(theme.fg("accent", theme.bold(`${headerPrefix}${params.question}`)), 1, 0));
                container.addChild(new Spacer(1));

                const selectItems: SelectItem[] = allItems.map((item) => ({ value: item, label: item }));
                const selectList = new SelectList(selectItems, Math.min(allItems.length, 10), {
                    selectedPrefix: (t) => theme.bg("selectedBg", theme.fg("accent", t)),
                    selectedText: (t) => theme.bg("selectedBg", theme.bold(t)),
                    description: (t) => theme.fg("muted", t),
                    scrollInfo: (t) => theme.fg("dim", t),
                    noMatch: (t) => theme.fg("warning", t),
                });
                selectList.onSelect = (item) => done(item.value);
                selectList.onCancel = () => done(null);
                container.addChild(selectList);

                container.addChild(new Spacer(1));
                container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel"), 1, 0));
                container.addChild(new Spacer(1));
                container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

                return {
                    render: (w) => container.render(w),
                    invalidate: () => container.invalidate(),
                    handleInput: (data) => { selectList.handleInput(data); tui.requestRender(); },
                };
            });

            if (!choice) {
                return {
                    content: [{ type: "text", text: "User cancelled the selection" }],
                    details: { question: params.question, answer: null },
                };
            }

            // If user picked "Other", ask for free-text input
            if (choice === "Other (type your own answer)") {
                const customAnswer = await ctx.ui.input(`${params.question}`, "Type your answer...");
                return {
                    content: [{ type: "text", text: `User answered: ${customAnswer ?? "(no input)"}` }],
                    details: { question: params.question, answer: customAnswer ?? null, wasCustom: true },
                };
            }

            // Extract just the label (before the " — " description separator)
            const selectedLabel = choice.split(" — ")[0];
            return {
                content: [{ type: "text", text: `User selected: ${selectedLabel}` }],
                details: { question: params.question, answer: selectedLabel, wasCustom: false },
            };
        },
    });
}
```

### rpiv-ask-user-question/README.md — NEW

Plugin description, installation, and tool summary. No mention of pi-permission-system per D3.

```markdown
# rpiv-ask-user-question

Pi extension that registers the `ask_user_question` tool — a structured option
selector (with free-text "Other" fallback) for disambiguating underspecified
user requests. Replaces Claude Code's `AskUserQuestion`.

## Installation

    pi install npm:rpiv-ask-user-question

Then restart your Pi session.

## Tool

- **`ask_user_question`** — present a structured question with 2+ options and
  (optionally) a multi-select toggle. Returns the user's selection or free-text
  answer. See the tool's `promptGuidelines` for usage policy.

## License

MIT
```

### rpiv-advisor/package.json — NEW

Npm package manifest. Declares Pi extension + peer dependencies including `@mariozechner/pi-ai` (advisor calls `completeSimple`).

```json
{
  "name": "rpiv-advisor",
  "version": "0.1.0",
  "description": "Pi extension: advisor-strategy pattern — escalate to a stronger reviewer model",
  "keywords": ["pi-package", "pi-extension", "rpiv", "advisor"],
  "type": "module",
  "pi": {
    "extensions": ["./index.ts"]
  },
  "peerDependencies": {
    "@mariozechner/pi-ai": "*",
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-tui": "*",
    "@sinclair/typebox": "*"
  }
}
```

### rpiv-advisor/index.ts — NEW

Pi extension entry point. Registers the advisor tool + /advisor command + before_agent_start strip; restores state from disk in session_start.

```typescript
/**
 * rpiv-advisor — Pi extension
 *
 * Registers the `advisor` tool, `/advisor` command, and the two lifecycle
 * hooks (session_start restore, before_agent_start strip) that together
 * implement the advisor-strategy pattern.
 *
 * Config persists at ~/.config/rpiv-advisor/advisor.json. Tool name
 * preserved verbatim from rpiv-pi@7525a5d.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
    registerAdvisorTool,
    registerAdvisorCommand,
    registerAdvisorBeforeAgentStart,
    restoreAdvisorState,
} from "./advisor.js";

export default function (pi: ExtensionAPI) {
    registerAdvisorTool(pi);
    registerAdvisorCommand(pi);
    registerAdvisorBeforeAgentStart(pi);

    pi.on("session_start", async (_event, ctx) => {
        restoreAdvisorState(ctx, pi);
    });
}
```

### rpiv-advisor/advisor.ts — NEW

Copy of `extensions/rpiv-core/advisor.ts` from rpiv-pi@7525a5d with a single edit: `ADVISOR_CONFIG_PATH` changes from `~/.config/rpiv-pi/advisor.json` to `~/.config/rpiv-advisor/advisor.json` (line 55).

```typescript
/**
 * advisor tool + /advisor command — Advisor-strategy pattern.
 *
 * Lets the executor model consult a stronger advisor model (e.g. Opus) via an
 * in-process completeSimple() call with the full serialized conversation branch
 * as context. Advisor has no tools, never emits user-facing output, and returns
 * guidance (plan, correction, or stop signal) that the executor resumes with.
 *
 * Default state is OFF — the tool is registered at load but a before_agent_start
 * handler strips it from the active tool list each turn while no advisor model
 * is selected. /advisor opens a selector panel (ctx.ui.custom) to pick an
 * advisor model from ctx.modelRegistry.getAvailable() and toggles the tool in
 * via pi.setActiveTools(). Selection is in-memory and resets each session.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { completeSimple, supportsXhigh, type Message, type ThinkingLevel } from "@mariozechner/pi-ai";
import type { Api, Model, StopReason, Usage } from "@mariozechner/pi-ai";
import {
    DynamicBorder,
    convertToLlm,
    serializeConversation,
    type AgentToolResult,
    type AgentToolUpdateCallback,
    type ExtensionAPI,
    type ExtensionContext,
    type SessionEntry,
} from "@mariozechner/pi-coding-agent";
import {
    Container,
    SelectList,
    Spacer,
    Text,
    type SelectItem,
} from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ADVISOR_TOOL_NAME = "advisor";

// ---------------------------------------------------------------------------
// Config file persistence (cross-session)
// ---------------------------------------------------------------------------

interface AdvisorConfig {
    modelKey?: string;
    effort?: ThinkingLevel;
}

const ADVISOR_CONFIG_PATH = join(homedir(), ".config", "rpiv-advisor", "advisor.json");

function loadAdvisorConfig(): AdvisorConfig {
    if (!existsSync(ADVISOR_CONFIG_PATH)) return {};
    try {
        return JSON.parse(readFileSync(ADVISOR_CONFIG_PATH, "utf-8")) as AdvisorConfig;
    } catch {
        return {};
    }
}

function saveAdvisorConfig(key: string | undefined, effort: ThinkingLevel | undefined): void {
    const config: AdvisorConfig = {};
    if (key) config.modelKey = key;
    if (effort) config.effort = effort;
    try {
        mkdirSync(dirname(ADVISOR_CONFIG_PATH), { recursive: true });
        writeFileSync(ADVISOR_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
    } catch {
        // write may fail on disk-full or permission errors — best effort only
    }
    try {
        chmodSync(ADVISOR_CONFIG_PATH, 0o600);
    } catch {
        // chmod may fail on some filesystems — best effort only
    }
}

function parseModelKey(key: string): { provider: string; modelId: string } | undefined {
    const idx = key.indexOf(":");
    if (idx < 1) return undefined;
    return { provider: key.slice(0, idx), modelId: key.slice(idx + 1) };
}

export const ADVISOR_SYSTEM_PROMPT = `You are an advisor model in an advisor-strategy pattern. An executor model is running a task end-to-end — calling tools, reading results, iterating toward a solution. When the executor hits a decision it cannot reasonably solve alone, it consults you for guidance.

You read the shared conversation context and return ONE of:
- a plan (concrete next steps the executor should take),
- a correction (the executor is going down a wrong path — redirect it),
- a stop signal (the executor should halt and escalate to the user).

You NEVER call tools. You NEVER produce user-facing output. Be concise, directive, and grounded in the shared context. Name files, functions, and line numbers where possible. No preamble, no apologies, no meta-commentary about being an advisor — just the guidance the executor needs.`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdvisorDetails {
    advisorModel?: string;
    effort?: ThinkingLevel;
    usage?: Usage;
    stopReason?: StopReason;
    errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Module state — in-memory, resets each session
// ---------------------------------------------------------------------------

let selectedAdvisor: Model<Api> | undefined;
let selectedAdvisorEffort: ThinkingLevel | undefined;

export function getAdvisorModel(): Model<Api> | undefined {
    return selectedAdvisor;
}

export function setAdvisorModel(model: Model<Api> | undefined): void {
    selectedAdvisor = model;
}

export function getAdvisorEffort(): ThinkingLevel | undefined {
    return selectedAdvisorEffort;
}

export function setAdvisorEffort(effort: ThinkingLevel | undefined): void {
    selectedAdvisorEffort = effort;
}

// ---------------------------------------------------------------------------
// Session restoration — called from index.ts session_start handler
// ---------------------------------------------------------------------------

export function restoreAdvisorState(ctx: ExtensionContext, pi: ExtensionAPI): void {
    const config = loadAdvisorConfig();
    if (!config.modelKey) return;

    const parsed = parseModelKey(config.modelKey);
    if (!parsed) return;

    const model = ctx.modelRegistry.find(parsed.provider, parsed.modelId);
    if (!model) {
        if (ctx.hasUI) {
            ctx.ui.notify(
                `Previously configured advisor model ${config.modelKey} is no longer available`,
                "warning",
            );
        }
        return;
    }

    setAdvisorModel(model);
    if (config.effort) {
        setAdvisorEffort(config.effort);
    }

    const active = pi.getActiveTools();
    if (!active.includes(ADVISOR_TOOL_NAME)) {
        pi.setActiveTools([...active, ADVISOR_TOOL_NAME]);
    }

    if (ctx.hasUI) {
        ctx.ui.notify(
            `Advisor restored: ${model.provider}:${model.id}${config.effort ? `, ${config.effort}` : ""}`,
            "info",
        );
    }
}

// ---------------------------------------------------------------------------
// Core execute logic — curate context, call advisor, return structured result
// ---------------------------------------------------------------------------

function buildErrorResult(
    advisorLabel: string | undefined,
    userText: string,
    errorMessage: string,
): AgentToolResult<AdvisorDetails> {
    const effort = getAdvisorEffort();
    return {
        content: [{ type: "text", text: userText }],
        details: advisorLabel
            ? { advisorModel: advisorLabel, effort, errorMessage }
            : { effort, errorMessage },
    };
}

async function executeAdvisor(
    ctx: ExtensionContext,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<AdvisorDetails> | undefined,
): Promise<AgentToolResult<AdvisorDetails>> {
    const advisor = getAdvisorModel();
    if (!advisor) {
        return buildErrorResult(
            undefined,
            "No advisor model is configured. The user can enable one with the /advisor command.",
            "no advisor model selected",
        );
    }
    const advisorLabel = `${advisor.provider}:${advisor.id}`;
    const effort = getAdvisorEffort();

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(advisor);
    if (!auth.ok) {
        return buildErrorResult(
            advisorLabel,
            `Advisor (${advisorLabel}) is misconfigured: ${auth.error}`,
            auth.error,
        );
    }
    if (!auth.apiKey) {
        const msg = `no API key for ${advisor.provider}`;
        return buildErrorResult(
            advisorLabel,
            `Advisor (${advisorLabel}) has no API key available.`,
            msg,
        );
    }

    const branch = ctx.sessionManager.getBranch();
    const agentMessages = branch
        .filter((e): e is SessionEntry & { type: "message" } => e.type === "message")
        .map((e) => e.message);
    const conversationText = serializeConversation(convertToLlm(agentMessages));

    const userMessage: Message = {
        role: "user",
        content: [
            {
                type: "text",
                text: `## Conversation So Far\n\n${conversationText}`,
            },
        ],
        timestamp: Date.now(),
    };

    onUpdate?.({
        content: [{ type: "text", text: `Consulting advisor (${advisorLabel}${effort ? `, ${effort}` : ""})…` }],
        details: { advisorModel: advisorLabel, effort },
    });

    try {
        const response = await completeSimple(
            advisor,
            { systemPrompt: ADVISOR_SYSTEM_PROMPT, messages: [userMessage] },
            { apiKey: auth.apiKey, headers: auth.headers, signal, reasoning: effort },
        );

        if (response.stopReason === "aborted") {
            return {
                content: [
                    { type: "text", text: "Advisor call was cancelled before it completed." },
                ],
                details: {
                    advisorModel: advisorLabel,
                    effort,
                    usage: response.usage,
                    stopReason: response.stopReason,
                    errorMessage: response.errorMessage ?? "aborted",
                },
            };
        }

        if (response.stopReason === "error") {
            return {
                content: [
                    {
                        type: "text",
                        text: `Advisor call failed: ${response.errorMessage ?? "unknown error"}`,
                    },
                ],
                details: {
                    advisorModel: advisorLabel,
                    effort,
                    usage: response.usage,
                    stopReason: response.stopReason,
                    errorMessage: response.errorMessage,
                },
            };
        }

        const advisorText = response.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text)
            .join("\n")
            .trim();

        if (!advisorText) {
            return {
                content: [{ type: "text", text: "Advisor returned no text content." }],
                details: {
                    advisorModel: advisorLabel,
                    effort,
                    usage: response.usage,
                    stopReason: response.stopReason,
                    errorMessage: "empty response",
                },
            };
        }

        return {
            content: [{ type: "text", text: advisorText }],
            details: {
                advisorModel: advisorLabel,
                effort,
                usage: response.usage,
                stopReason: response.stopReason,
            },
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return buildErrorResult(
            advisorLabel,
            `Advisor call threw: ${message}`,
            message,
        );
    }
}

// ---------------------------------------------------------------------------
// Tool registration — zero-param schema, curated description/snippet/guidelines
// ---------------------------------------------------------------------------

const AdvisorParams = Type.Object({});

const ADVISOR_DESCRIPTION =
    "Escalate to a stronger reviewer model for guidance. When you need " +
    "stronger judgment — a complex decision, an ambiguous failure, a problem " +
    "you're circling without progress — escalate to the advisor model for " +
    "guidance, then resume. Takes NO parameters — when you call advisor(), " +
    "your entire conversation history is automatically forwarded. The advisor " +
    "sees the task, every tool call you've made, every result you've seen.";

const ADVISOR_PROMPT_SNIPPET =
    "Escalate to a stronger reviewer model for guidance when stuck, before substantive work, or before declaring done";

const ADVISOR_PROMPT_GUIDELINES: string[] = [
    "Call `advisor` BEFORE substantive work — before writing, before committing to an interpretation, before building on an assumption. Orientation (finding files, fetching a source, seeing what's there) is not substantive work; writing, editing, and declaring an answer are.",
    "Also call `advisor` when you believe the task is complete. BEFORE this call, make your deliverable durable: write the file, save the result, commit the change. The advisor call takes time; if the session ends during it, a durable result persists and an unwritten one doesn't.",
    "Also call `advisor` when stuck — errors recurring, approach not converging, results that don't fit — or when considering a change of approach.",
    "On tasks longer than a few steps, call `advisor` at least once before committing to an approach and once before declaring done. On short reactive tasks where the next action is dictated by tool output you just read, you don't need to keep calling — the advisor adds most of its value on the first call, before the approach crystallizes.",
    "Give the advisor's advice serious weight. If you follow a step and it fails empirically, or you have primary-source evidence that contradicts a specific claim, adapt — a passing self-test is not evidence the advice is wrong, it's evidence your test doesn't check what the advice is checking.",
    "If you've already retrieved data pointing one way and the advisor points another, don't silently switch — surface the conflict in one more `advisor` call (\"I found X, you suggest Y, which constraint breaks the tie?\"). A reconcile call is cheaper than committing to the wrong branch.",
];

export function registerAdvisorTool(pi: ExtensionAPI): void {
    pi.registerTool({
        name: ADVISOR_TOOL_NAME,
        label: "Advisor",
        description: ADVISOR_DESCRIPTION,
        promptSnippet: ADVISOR_PROMPT_SNIPPET,
        promptGuidelines: ADVISOR_PROMPT_GUIDELINES,
        parameters: AdvisorParams,

        async execute(_toolCallId, _params, signal, onUpdate, ctx) {
            return executeAdvisor(ctx, signal, onUpdate);
        },
    });
}

// ---------------------------------------------------------------------------
// before_agent_start handler — strip advisor from active tools when disabled
// ---------------------------------------------------------------------------

export function registerAdvisorBeforeAgentStart(pi: ExtensionAPI): void {
    pi.on("before_agent_start", async () => {
        if (!getAdvisorModel()) {
            const active = pi.getActiveTools();
            if (active.includes(ADVISOR_TOOL_NAME)) {
                pi.setActiveTools(active.filter((n) => n !== ADVISOR_TOOL_NAME));
            }
        }
    });
}

// ---------------------------------------------------------------------------
// /advisor slash command — opens selector panel for picking the advisor model
// ---------------------------------------------------------------------------

const ADVISOR_HEADER_TITLE = "Advisor Tool";

const ADVISOR_HEADER_PROSE_1 =
    "When the active model needs stronger judgment — a complex decision, an ambiguous " +
    "failure, a problem it's circling without progress — it escalates to the " +
    "advisor model for guidance, then resumes. The advisor runs server-side " +
    "and uses additional tokens.";

const ADVISOR_HEADER_PROSE_2 =
    "For certain workloads, pairing a faster model as the main model with a " +
    "more capable one as the advisor gives near-top-tier performance with " +
    "reduced token usage.";

const NO_ADVISOR_VALUE = "__no_advisor__";

const EFFORT_HEADER_TITLE = "Reasoning Level";

const EFFORT_HEADER_PROSE =
    "Choose the reasoning effort level for the advisor. " +
    "Higher levels produce stronger judgment but use more tokens.";

function modelKey(m: { provider: string; id: string }): string {
    return `${m.provider}:${m.id}`;
}

export function registerAdvisorCommand(pi: ExtensionAPI): void {
    pi.registerCommand("advisor", {
        description: "Configure the advisor model for the advisor-strategy pattern",
        handler: async (_args, ctx) => {
            if (!ctx.hasUI) {
                ctx.ui.notify("/advisor requires interactive mode", "error");
                return;
            }

            const availableModels = ctx.modelRegistry.getAvailable();
            const current = getAdvisorModel();
            const currentKey = current ? modelKey(current) : undefined;

            const items: SelectItem[] = availableModels.map((m) => {
                const key = modelKey(m);
                const check = key === currentKey ? " ✓" : "";
                return { value: key, label: `${m.name}  (${m.provider})${check}` };
            });
            items.push({
                value: NO_ADVISOR_VALUE,
                label: currentKey === undefined ? "No advisor ✓" : "No advisor",
            });

            const choice = await ctx.ui.custom<string | null>(
                (tui, theme, _kb, done) => {
                    const container = new Container();

                    container.addChild(
                        new DynamicBorder((s: string) => theme.fg("accent", s)),
                    );
                    container.addChild(new Spacer(1));
                    container.addChild(
                        new Text(
                            theme.fg("accent", theme.bold(ADVISOR_HEADER_TITLE)),
                            1,
                            0,
                        ),
                    );
                    container.addChild(new Spacer(1));
                    container.addChild(new Text(ADVISOR_HEADER_PROSE_1, 1, 0));
                    container.addChild(new Spacer(1));
                    container.addChild(new Text(ADVISOR_HEADER_PROSE_2, 1, 0));
                    container.addChild(new Spacer(1));

                    const selectList = new SelectList(
                        items,
                        Math.min(items.length, 10),
                        {
                            selectedPrefix: (t) => theme.bg("selectedBg", theme.fg("accent", t)),
                            selectedText: (t) => theme.bg("selectedBg", theme.bold(t)),
                            description: (t) => theme.fg("muted", t),
                            scrollInfo: (t) => theme.fg("dim", t),
                            noMatch: (t) => theme.fg("warning", t),
                        },
                    );
                    selectList.onSelect = (item) => done(item.value);
                    selectList.onCancel = () => done(null);
                    container.addChild(selectList);

                    container.addChild(new Spacer(1));
                    container.addChild(
                        new Text(
                            theme.fg("dim", "↑↓ navigate • enter select • esc cancel"),
                            1,
                            0,
                        ),
                    );
                    container.addChild(new Spacer(1));
                    container.addChild(
                        new DynamicBorder((s: string) => theme.fg("accent", s)),
                    );

                    return {
                        render: (w) => container.render(w),
                        invalidate: () => container.invalidate(),
                        handleInput: (data) => {
                            selectList.handleInput(data);
                            tui.requestRender();
                        },
                    };
                },
            );

            if (!choice) {
                return;
            }

            const activeTools = pi.getActiveTools();
            const activeHas = activeTools.includes(ADVISOR_TOOL_NAME);

            if (choice === NO_ADVISOR_VALUE) {
                setAdvisorModel(undefined);
                setAdvisorEffort(undefined);
                saveAdvisorConfig(undefined, undefined);
                if (activeHas) {
                    pi.setActiveTools(
                        activeTools.filter((n) => n !== ADVISOR_TOOL_NAME),
                    );
                }
                ctx.ui.notify("Advisor disabled", "info");
                return;
            }

            const picked = availableModels.find((m) => modelKey(m) === choice);
            if (!picked) {
                ctx.ui.notify(`Advisor selection not found: ${choice}`, "error");
                return;
            }

            // Effort picker — only for reasoning-capable models
            let effortChoice: ThinkingLevel | undefined;
            if (picked.reasoning) {
                const OFF_VALUE = "__off__";
                const baseLevels: ThinkingLevel[] = ["minimal", "low", "medium", "high"];
                const levels = supportsXhigh(picked)
                    ? [...baseLevels, "xhigh" as ThinkingLevel]
                    : baseLevels;

                const effortItems: SelectItem[] = [
                    { value: OFF_VALUE, label: "off" },
                    ...levels.map((level) => ({
                        value: level,
                        label: level === "high" ? `${level}  (recommended)` : level,
                    })),
                ];

                const effortResult = await ctx.ui.custom<string | null>(
                    (tui, theme, _kb, done) => {
                        const container = new Container();

                        container.addChild(
                            new DynamicBorder((s: string) => theme.fg("accent", s)),
                        );
                        container.addChild(new Spacer(1));
                        container.addChild(
                            new Text(
                                theme.fg("accent", theme.bold(EFFORT_HEADER_TITLE)),
                                1,
                                0,
                            ),
                        );
                        container.addChild(new Spacer(1));
                        container.addChild(new Text(EFFORT_HEADER_PROSE, 1, 0));
                        container.addChild(new Spacer(1));

                        const selectList = new SelectList(
                            effortItems,
                            Math.min(effortItems.length, 10),
                            {
                                selectedPrefix: (t) => theme.bg("selectedBg", theme.fg("accent", t)),
                                selectedText: (t) => theme.bg("selectedBg", theme.bold(t)),
                                description: (t) => theme.fg("muted", t),
                                scrollInfo: (t) => theme.fg("dim", t),
                                noMatch: (t) => theme.fg("warning", t),
                            },
                        );
                        const currentEffort = getAdvisorEffort();
                        const defaultIdx = currentEffort
                            ? effortItems.findIndex((item) => item.value === currentEffort)
                            : -1;
                        selectList.setSelectedIndex(defaultIdx >= 0 ? defaultIdx : effortItems.findIndex((item) => item.value === "high"));
                        selectList.onSelect = (item) => done(item.value);
                        selectList.onCancel = () => done(null);
                        container.addChild(selectList);

                        container.addChild(new Spacer(1));
                        container.addChild(
                            new Text(
                                theme.fg("dim", "↑↓ navigate • enter select • esc cancel"),
                                1,
                                0,
                            ),
                        );
                        container.addChild(new Spacer(1));
                        container.addChild(
                            new DynamicBorder((s: string) => theme.fg("accent", s)),
                        );

                        return {
                            render: (w) => container.render(w),
                            invalidate: () => container.invalidate(),
                            handleInput: (data) => {
                                selectList.handleInput(data);
                                tui.requestRender();
                            },
                        };
                    },
                );

                if (!effortResult) {
                    return;
                }
                effortChoice = effortResult === OFF_VALUE ? undefined : effortResult as ThinkingLevel;
            }

            setAdvisorEffort(effortChoice);
            setAdvisorModel(picked);
            saveAdvisorConfig(modelKey(picked), effortChoice);
            if (!activeHas) {
                pi.setActiveTools([...activeTools, ADVISOR_TOOL_NAME]);
            }
            ctx.ui.notify(
                `Advisor: ${picked.provider}:${picked.id}${effortChoice ? `, ${effortChoice}` : ""}`,
                "info",
            );
        },
    });
}
```

### rpiv-advisor/README.md — NEW

Plugin description, installation, `/advisor` usage, config-path migration note. No pi-permission-system mention per D3.

```markdown
# rpiv-advisor

Pi extension that registers the `advisor` tool and `/advisor` slash command,
implementing the advisor-strategy pattern: the executor model can escalate
decisions to a stronger reviewer model (e.g. Opus), receive guidance, and
resume.

## Installation

    pi install npm:rpiv-advisor

Then restart your Pi session.

## Usage

Configure an advisor model with `/advisor` — the command opens a selector for
any model registered with Pi's model registry, plus a reasoning-effort picker
for reasoning-capable models. Selection persists across sessions at
`~/.config/rpiv-advisor/advisor.json` (chmod 0600).

The `advisor` tool is registered at load but excluded from active tools by
default; selecting a model via `/advisor` enables it. Choose "No advisor" to
disable.

`advisor` takes zero parameters — calling it forwards the full serialized
conversation branch to the advisor model, which returns guidance (plan,
correction, or stop signal) that the executor consumes.

## Migration from rpiv-pi ≤ 0.3.0

If you had an advisor configured while rpiv-pi bundled this tool, your previous
selection lived at `~/.config/rpiv-pi/advisor.json`. The new plugin reads
`~/.config/rpiv-advisor/advisor.json` only — run `/advisor` once to re-select
your model.

## License

MIT
```

### rpiv-todo/package.json — NEW

Npm package manifest. `@mariozechner/pi-ai` is a peer because `todo.ts:14` imports `StringEnum`.

```json
{
  "name": "rpiv-todo",
  "version": "0.1.0",
  "description": "Pi extension: Claude-Code-parity todo tool + persistent overlay widget",
  "keywords": ["pi-package", "pi-extension", "rpiv", "todo"],
  "type": "module",
  "pi": {
    "extensions": ["./index.ts"]
  },
  "peerDependencies": {
    "@mariozechner/pi-ai": "*",
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-tui": "*",
    "@sinclair/typebox": "*"
  }
}
```

### rpiv-todo/index.ts — NEW

Pi extension entry point. Registers todo tool + /todos command + 5 lifecycle hooks (session_start, session_compact, session_tree, session_shutdown, tool_execution_end); manages `TodoOverlay` lifecycle via closure variable.

```typescript
/**
 * rpiv-todo — Pi extension
 *
 * Registers the `todo` tool, `/todos` slash command, and the five lifecycle
 * hooks that manage branch-replay state reconstruction and the TodoOverlay
 * persistent widget.
 *
 * Extracted from rpiv-pi@7525a5d. Tool name "todo" and widget key
 * "rpiv-todos" preserved verbatim so existing session history replays
 * correctly after upgrade.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerTodoTool, registerTodosCommand, reconstructTodoState } from "./todo.js";
import { TodoOverlay } from "./todo-overlay.js";

export default function (pi: ExtensionAPI) {
    // Todo overlay widget — constructed lazily at the first session_start with UI.
    let todoOverlay: TodoOverlay | undefined;

    registerTodoTool(pi);
    registerTodosCommand(pi);

    pi.on("session_start", async (_event, ctx) => {
        reconstructTodoState(ctx);
        if (ctx.hasUI) {
            todoOverlay ??= new TodoOverlay();
            todoOverlay.setUICtx(ctx.ui);
            todoOverlay.update();
        }
    });

    pi.on("session_compact", async (_event, ctx) => {
        reconstructTodoState(ctx);
        todoOverlay?.update();
    });

    pi.on("session_tree", async (_event, ctx) => {
        reconstructTodoState(ctx);
        todoOverlay?.update();
    });

    pi.on("session_shutdown", async () => {
        todoOverlay?.dispose();
        todoOverlay = undefined;
    });

    // Reads getTodos() at render time; do NOT call reconstructTodoState here
    // (branch is stale — message_end runs after tool_execution_end).
    pi.on("tool_execution_end", async (event) => {
        if (event.toolName !== "todo" || event.isError) return;
        todoOverlay?.update();
    });
}
```

### rpiv-todo/todo.ts — NEW

Verbatim copy of `extensions/rpiv-core/todo.ts` from rpiv-pi@7525a5d. No edits — tool name literal `"todo"` preserved at line 614; replay filter `msg.toolName === "todo"` at line 502 preserved.

```typescript
/**
 * todo tool + /todos command — Claude-Code-parity Task management.
 *
 * State lives in this module and persists via the tool's AgentToolResult.details
 * envelope. reconstructTodoState walks ctx.sessionManager.getBranch() and restores
 * the last snapshot; the pure applyTaskMutation reducer is the single source of
 * truth for invariants — state machine transitions, blockedBy cycle checks,
 * dangling-reference rejection. Tool name is deliberately "todo" (not
 * TaskCreate/etc.) to preserve the permissions entry at
 * templates/pi-permissions.jsonc:26.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus = "pending" | "in_progress" | "completed" | "deleted";

export type TaskAction = "create" | "update" | "list" | "get" | "delete" | "clear";

export interface Task {
    id: number;
    subject: string;
    description?: string;
    activeForm?: string;
    status: TaskStatus;
    blockedBy?: number[];
    owner?: string;
    metadata?: Record<string, unknown>;
}

export interface TaskDetails {
    action: TaskAction;
    params: Record<string, unknown>;
    tasks: Task[];
    nextId: number;
    error?: string;
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<TaskStatus, ReadonlySet<TaskStatus>> = {
    pending: new Set(["in_progress", "completed", "deleted"]),
    in_progress: new Set(["pending", "completed", "deleted"]),
    completed: new Set(["deleted"]),
    deleted: new Set(),
};

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let tasks: Task[] = [];
let nextId = 1;

export function getTodos(): readonly Task[] {
    return tasks;
}

// ---------------------------------------------------------------------------
// Pure helpers — no state mutation, no I/O
// ---------------------------------------------------------------------------

export function isTransitionValid(from: TaskStatus, to: TaskStatus): boolean {
    if (from === to) return true;
    return VALID_TRANSITIONS[from].has(to);
}

export function detectCycle(
    taskList: readonly Task[],
    taskId: number,
    newBlockedBy: readonly number[],
): boolean {
    const edges = new Map<number, number[]>();
    for (const t of taskList) {
        if (t.id === taskId) {
            const merged = new Set([...(t.blockedBy ?? []), ...newBlockedBy]);
            edges.set(t.id, [...merged]);
        } else {
            edges.set(t.id, t.blockedBy ? [...t.blockedBy] : []);
        }
    }

    const visiting = new Set<number>();
    const visited = new Set<number>();
    const hasCycleFrom = (node: number): boolean => {
        if (visiting.has(node)) return true;
        if (visited.has(node)) return false;
        visiting.add(node);
        for (const nb of edges.get(node) ?? []) {
            if (hasCycleFrom(nb)) return true;
        }
        visiting.delete(node);
        visited.add(node);
        return false;
    };

    for (const node of edges.keys()) {
        if (hasCycleFrom(node)) return true;
    }
    return false;
}

export function deriveBlocks(taskList: readonly Task[]): Map<number, number[]> {
    const blocks = new Map<number, number[]>();
    for (const t of taskList) {
        for (const dep of t.blockedBy ?? []) {
            const arr = blocks.get(dep) ?? [];
            arr.push(t.id);
            blocks.set(dep, arr);
        }
    }
    return blocks;
}

// ---------------------------------------------------------------------------
// Reducer — pure, single source of truth for invariants
// ---------------------------------------------------------------------------

interface ReducerState {
    tasks: Task[];
    nextId: number;
}

interface ReducerResult {
    state: ReducerState;
    details: TaskDetails;
    content: Array<{ type: "text"; text: string }>;
}

interface TaskMutationParams {
    [key: string]: unknown;
    subject?: string;
    description?: string;
    activeForm?: string;
    status?: TaskStatus;
    blockedBy?: number[];
    addBlockedBy?: number[];
    removeBlockedBy?: number[];
    owner?: string;
    metadata?: Record<string, unknown>;
    id?: number;
    includeDeleted?: boolean;
}

function errorResult(
    state: ReducerState,
    action: TaskAction,
    params: TaskMutationParams,
    error: string,
): ReducerResult {
    return {
        state,
        details: {
            action,
            params: params as Record<string, unknown>,
            tasks: state.tasks,
            nextId: state.nextId,
            error,
        },
        content: [{ type: "text", text: `Error: ${error}` }],
    };
}

export function applyTaskMutation(
    state: ReducerState,
    action: TaskAction,
    params: TaskMutationParams,
): ReducerResult {
    switch (action) {
        case "create": {
            if (!params.subject || !params.subject.trim()) {
                return errorResult(state, action, params, "subject required for create");
            }
            if (params.blockedBy && params.blockedBy.length) {
                for (const dep of params.blockedBy) {
                    const depTask = state.tasks.find((t) => t.id === dep);
                    if (!depTask) {
                        return errorResult(state, action, params, `blockedBy: #${dep} not found`);
                    }
                    if (depTask.status === "deleted") {
                        return errorResult(state, action, params, `blockedBy: #${dep} is deleted`);
                    }
                }
            }
            const newTask: Task = {
                id: state.nextId,
                subject: params.subject,
                status: "pending",
            };
            if (params.description) newTask.description = params.description;
            if (params.activeForm) newTask.activeForm = params.activeForm;
            if (params.blockedBy && params.blockedBy.length) {
                newTask.blockedBy = [...params.blockedBy];
            }
            if (params.owner) newTask.owner = params.owner;
            if (params.metadata) newTask.metadata = { ...params.metadata };

            const newTasks = [...state.tasks, newTask];
            const newState: ReducerState = { tasks: newTasks, nextId: state.nextId + 1 };
            return {
                state: newState,
                details: {
                    action: "create",
                    params: params as Record<string, unknown>,
                    tasks: newTasks,
                    nextId: newState.nextId,
                },
                content: [
                    { type: "text", text: `Created #${newTask.id}: ${newTask.subject} (pending)` },
                ],
            };
        }

        case "update": {
            if (params.id === undefined) {
                return errorResult(state, action, params, "id required for update");
            }
            const idx = state.tasks.findIndex((t) => t.id === params.id);
            if (idx === -1) {
                return errorResult(state, action, params, `#${params.id} not found`);
            }
            const current = state.tasks[idx];

            const hasMutation =
                params.subject !== undefined ||
                params.description !== undefined ||
                params.activeForm !== undefined ||
                params.status !== undefined ||
                params.owner !== undefined ||
                params.metadata !== undefined ||
                (params.addBlockedBy && params.addBlockedBy.length > 0) ||
                (params.removeBlockedBy && params.removeBlockedBy.length > 0);
            if (!hasMutation) {
                return errorResult(state, action, params, "update requires at least one mutable field");
            }

            let newStatus = current.status;
            if (params.status !== undefined) {
                if (!isTransitionValid(current.status, params.status)) {
                    return errorResult(
                        state,
                        action,
                        params,
                        `illegal transition ${current.status} → ${params.status}`,
                    );
                }
                newStatus = params.status;
            }

            let newBlockedBy = current.blockedBy ? [...current.blockedBy] : [];
            if (params.removeBlockedBy && params.removeBlockedBy.length) {
                const toRemove = new Set(params.removeBlockedBy);
                newBlockedBy = newBlockedBy.filter((dep) => !toRemove.has(dep));
            }
            if (params.addBlockedBy && params.addBlockedBy.length) {
                for (const dep of params.addBlockedBy) {
                    if (dep === current.id) {
                        return errorResult(state, action, params, `cannot block #${current.id} on itself`);
                    }
                    const depTask = state.tasks.find((t) => t.id === dep);
                    if (!depTask) {
                        return errorResult(state, action, params, `addBlockedBy: #${dep} not found`);
                    }
                    if (depTask.status === "deleted") {
                        return errorResult(state, action, params, `addBlockedBy: #${dep} is deleted`);
                    }
                    if (!newBlockedBy.includes(dep)) newBlockedBy.push(dep);
                }
                if (detectCycle(state.tasks, current.id, newBlockedBy)) {
                    return errorResult(
                        state,
                        action,
                        params,
                        "addBlockedBy would create a cycle in the blockedBy graph",
                    );
                }
            }

            let newMetadata = current.metadata;
            if (params.metadata !== undefined) {
                const merged: Record<string, unknown> = { ...(current.metadata ?? {}) };
                for (const [k, v] of Object.entries(params.metadata)) {
                    if (v === null) delete merged[k];
                    else merged[k] = v;
                }
                newMetadata = Object.keys(merged).length ? merged : undefined;
            }

            const updated: Task = { ...current, status: newStatus };
            if (params.subject !== undefined) updated.subject = params.subject;
            if (params.description !== undefined) updated.description = params.description;
            if (params.activeForm !== undefined) updated.activeForm = params.activeForm;
            if (params.owner !== undefined) updated.owner = params.owner;
            if (newBlockedBy.length) {
                updated.blockedBy = newBlockedBy;
            } else {
                delete updated.blockedBy;
            }
            if (newMetadata === undefined) {
                delete updated.metadata;
            } else {
                updated.metadata = newMetadata;
            }

            const newTasks = [...state.tasks];
            newTasks[idx] = updated;
            const transition =
                current.status !== newStatus ? ` (${current.status} → ${newStatus})` : "";
            return {
                state: { tasks: newTasks, nextId: state.nextId },
                details: {
                    action: "update",
                    params: params as Record<string, unknown>,
                    tasks: newTasks,
                    nextId: state.nextId,
                },
                content: [{ type: "text", text: `Updated #${updated.id}${transition}` }],
            };
        }

        case "list": {
            const includeDeleted = params.includeDeleted === true;
            const statusFilter = params.status;
            let view = state.tasks;
            if (!includeDeleted) {
                view = view.filter((t) => t.status !== "deleted");
            }
            if (statusFilter) {
                view = view.filter((t) => t.status === statusFilter);
            }
            const text =
                view.length === 0
                    ? "No tasks"
                    : view
                          .map((t) => {
                              const block = t.blockedBy?.length
                                  ? ` ⛓ ${t.blockedBy.map((id) => `#${id}`).join(",")}`
                                  : "";
                              const form =
                                  t.status === "in_progress" && t.activeForm ? ` (${t.activeForm})` : "";
                              return `[${t.status}] #${t.id} ${t.subject}${form}${block}`;
                          })
                          .join("\n");
            return {
                state,
                details: {
                    action: "list",
                    params: params as Record<string, unknown>,
                    tasks: state.tasks,
                    nextId: state.nextId,
                },
                content: [{ type: "text", text }],
            };
        }

        case "get": {
            if (params.id === undefined) {
                return errorResult(state, action, params, "id required for get");
            }
            const task = state.tasks.find((t) => t.id === params.id);
            if (!task) {
                return errorResult(state, action, params, `#${params.id} not found`);
            }
            const blocks = deriveBlocks(state.tasks).get(task.id) ?? [];
            const lines = [`#${task.id} [${task.status}] ${task.subject}`];
            if (task.description) lines.push(`  description: ${task.description}`);
            if (task.activeForm) lines.push(`  activeForm: ${task.activeForm}`);
            if (task.blockedBy?.length) {
                lines.push(`  blockedBy: ${task.blockedBy.map((id) => `#${id}`).join(", ")}`);
            }
            if (blocks.length) {
                lines.push(`  blocks: ${blocks.map((id) => `#${id}`).join(", ")}`);
            }
            if (task.owner) lines.push(`  owner: ${task.owner}`);
            return {
                state,
                details: {
                    action: "get",
                    params: params as Record<string, unknown>,
                    tasks: state.tasks,
                    nextId: state.nextId,
                },
                content: [{ type: "text", text: lines.join("\n") }],
            };
        }

        case "delete": {
            if (params.id === undefined) {
                return errorResult(state, action, params, "id required for delete");
            }
            const idx = state.tasks.findIndex((t) => t.id === params.id);
            if (idx === -1) {
                return errorResult(state, action, params, `#${params.id} not found`);
            }
            const current = state.tasks[idx];
            if (current.status === "deleted") {
                return errorResult(state, action, params, `#${current.id} is already deleted`);
            }
            const updated: Task = { ...current, status: "deleted" };
            const newTasks = [...state.tasks];
            newTasks[idx] = updated;
            return {
                state: { tasks: newTasks, nextId: state.nextId },
                details: {
                    action: "delete",
                    params: params as Record<string, unknown>,
                    tasks: newTasks,
                    nextId: state.nextId,
                },
                content: [{ type: "text", text: `Deleted #${updated.id}: ${updated.subject}` }],
            };
        }

        case "clear": {
            const count = state.tasks.length;
            return {
                state: { tasks: [], nextId: 1 },
                details: {
                    action: "clear",
                    params: params as Record<string, unknown>,
                    tasks: [],
                    nextId: 1,
                },
                content: [{ type: "text", text: `Cleared ${count} tasks` }],
            };
        }
    }
}

// ---------------------------------------------------------------------------
// Persistence — snapshot-based replay with type-guard
// ---------------------------------------------------------------------------

function isTaskDetails(value: unknown): value is TaskDetails {
    if (!value || typeof value !== "object") return false;
    const v = value as Record<string, unknown>;
    return Array.isArray(v.tasks) && typeof v.nextId === "number";
}

export function reconstructTodoState(ctx: any): void {
    tasks = [];
    nextId = 1;
    for (const entry of ctx.sessionManager.getBranch()) {
        if (entry.type !== "message") continue;
        const msg = entry.message;
        if (msg.role !== "toolResult" || msg.toolName !== "todo") continue;
        const details: unknown = msg.details;
        if (!isTaskDetails(details)) continue;
        tasks = details.tasks.map((t) => ({ ...t }));
        nextId = details.nextId;
    }
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function formatStatus(status: TaskStatus): string {
    switch (status) {
        case "in_progress": return "in progress";
        case "deleted": return "deleted";
        default: return status;
    }
}

const STATUS_GLYPH: Record<TaskStatus, string> = {
    pending: "○",
    in_progress: "◐",
    completed: "●",
    deleted: "⊘",
};

// Mirrors todo-overlay.ts:statusGlyph palette, but uses `muted` for deleted so
// a successful delete is visually distinct from the error branch (which uses
// `error` + `✗`).
const STATUS_COLOR: Record<TaskStatus, "dim" | "warning" | "success" | "muted"> = {
    pending: "dim",
    in_progress: "warning",
    completed: "success",
    deleted: "muted",
};

const ACTION_GLYPH: Record<TaskAction, string> = {
    create: "+",
    update: "→",
    delete: "×",
    get: "›",
    list: "☰",
    clear: "∅",
};

function taskSubject(id: number): string | undefined {
    return tasks.find((t) => t.id === id)?.subject;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

const TodoParams = Type.Object({
    action: StringEnum(["create", "update", "list", "get", "delete", "clear"] as const),
    subject: Type.Optional(Type.String({ description: "Task subject line (required for create)" })),
    description: Type.Optional(Type.String({ description: "Long-form task description" })),
    activeForm: Type.Optional(
        Type.String({
            description:
                "Present-continuous spinner label shown while status is in_progress (e.g. 'writing tests')",
        }),
    ),
    status: Type.Optional(
        StringEnum(["pending", "in_progress", "completed", "deleted"] as const, {
            description: "Target status (update) or list filter (list)",
        }),
    ),
    blockedBy: Type.Optional(
        Type.Array(Type.Number(), { description: "Initial blockedBy ids (create only)" }),
    ),
    addBlockedBy: Type.Optional(
        Type.Array(Type.Number(), {
            description: "Task ids to add to blockedBy (update only, additive merge)",
        }),
    ),
    removeBlockedBy: Type.Optional(
        Type.Array(Type.Number(), {
            description: "Task ids to remove from blockedBy (update only, additive merge)",
        }),
    ),
    owner: Type.Optional(Type.String({ description: "Agent/owner assigned to this task" })),
    metadata: Type.Optional(
        Type.Record(Type.String(), Type.Unknown(), {
            description: "Arbitrary metadata; pass null value for a key to delete that key on update",
        }),
    ),
    id: Type.Optional(Type.Number({ description: "Task id (required for update, get, delete)" })),
    includeDeleted: Type.Optional(
        Type.Boolean({
            description:
                "If true, list action returns deleted (tombstoned) tasks as well. Default: false.",
        }),
    ),
});

export function registerTodoTool(pi: ExtensionAPI): void {
    pi.registerTool({
        name: "todo",
        label: "Todo",
        description:
            "Manage a task list for tracking multi-step progress. Actions: create (new task), update (change status/fields/dependencies), list (all tasks, optionally filtered by status), get (single task details), delete (tombstone), clear (reset all). Status: pending → in_progress → completed, plus deleted tombstone. Use this to plan and track multi-step work like research, design, and implementation.",
        promptSnippet: "Manage a Claude-Code-style task list to track multi-step progress",
        promptGuidelines: [
            "Use `todo` for complex work with 3+ steps, when the user gives you a list of tasks, or immediately after receiving new instructions to capture requirements. Skip it for single trivial tasks and purely conversational requests.",
            "When starting any task, mark it in_progress BEFORE beginning work. Mark it completed IMMEDIATELY when done — never batch completions. Exactly one task should be in_progress at a time.",
            "Never mark a task completed if tests are failing, the implementation is partial, or you hit unresolved errors — keep it in_progress and create a new task for the blocker instead.",
            "Task status is a 4-state machine: pending → in_progress → completed, plus deleted as a tombstone. Pass activeForm (present-continuous label, e.g. 'researching existing tool') when marking in_progress.",
            "Use blockedBy to express dependencies (A is blocked by B). On create, pass blockedBy as the initial set. On update, use addBlockedBy / removeBlockedBy (additive merge — do not resend the full array). Cycles are rejected.",
            "list hides tombstoned (deleted) tasks by default; pass includeDeleted:true to see them. Pass status to filter by a single status.",
            "Subject must be short and imperative (e.g. 'Research existing tool'); description is for long-form detail. activeForm is a present-continuous label shown while in_progress.",
        ],
        parameters: TodoParams,

        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
            const result = applyTaskMutation(
                { tasks, nextId },
                params.action,
                params as TaskMutationParams,
            );
            tasks = result.state.tasks;
            nextId = result.state.nextId;
            return {
                content: result.content,
                details: result.details,
            };
        },

        renderCall(args, theme, _context) {
            const glyph = ACTION_GLYPH[args.action] ?? args.action;
            let text = theme.fg("toolTitle", theme.bold("todo ")) + theme.fg("muted", glyph);

            if (args.action === "create" && args.subject) {
                text += ` ${theme.fg("dim", args.subject)}`;
            } else if (
                (args.action === "update" || args.action === "get" || args.action === "delete") &&
                args.id !== undefined
            ) {
                const subject = taskSubject(args.id);
                text += ` ${theme.fg("accent", subject ?? `#${args.id}`)}`;
            } else if (args.action === "list" && args.status) {
                text += ` ${theme.fg("muted", formatStatus(args.status))}`;
            } else if (args.action === "clear") {
                // nothing extra
            }
            return new Text(text, 0, 0);
        },

        renderResult(result, _opts, theme, _context) {
            if (result.isError) {
                return new Text(theme.fg("error", "✗"), 0, 0);
            }
            const details = result.details as TaskDetails | undefined;
            let status: TaskStatus | undefined;
            if (details) {
                const params = details.params as TaskMutationParams;
                switch (details.action) {
                    case "create":
                        status = details.tasks[details.tasks.length - 1]?.status;
                        break;
                    case "update":
                        status =
                            params.status ??
                            details.tasks.find((t) => t.id === params.id)?.status;
                        break;
                    case "delete":
                        status = details.tasks.find((t) => t.id === params.id)?.status;
                        break;
                    case "list":
                    case "get":
                    case "clear":
                        break;
                }
            }
            if (status) {
                return new Text(
                    theme.fg(STATUS_COLOR[status], `${STATUS_GLYPH[status]} ${formatStatus(status)}`),
                    0,
                    0,
                );
            }
            return new Text(theme.fg("success", "✓"), 0, 0);
        },
    });
}

// ---------------------------------------------------------------------------
// /todos slash command
// ---------------------------------------------------------------------------

export function registerTodosCommand(pi: ExtensionAPI): void {
    pi.registerCommand("todos", {
        description: "Show all todos on the current branch, grouped by status",
        handler: async (_args, ctx) => {
            if (!ctx.hasUI) {
                ctx.ui.notify("/todos requires interactive mode", "error");
                return;
            }
            const visible = tasks.filter((t) => t.status !== "deleted");
            if (visible.length === 0) {
                ctx.ui.notify("No todos yet. Ask the agent to add some!", "info");
                return;
            }

            const pending = visible.filter((t) => t.status === "pending");
            const inProgress = visible.filter((t) => t.status === "in_progress");
            const completed = visible.filter((t) => t.status === "completed");

            const header: string[] = [];
            if (completed.length > 0) {
                header.push(`${completed.length}/${visible.length} completed`);
            }
            if (inProgress.length > 0) {
                header.push(`${inProgress.length} ${formatStatus("in_progress")}`);
            }
            if (pending.length > 0) {
                header.push(`${pending.length} pending`);
            }

            const lines: string[] = [header.join(" · ")];

            const renderTask = (t: Task, glyph: string): string => {
                const form =
                    t.status === "in_progress" && t.activeForm ? ` (${t.activeForm})` : "";
                const block = t.blockedBy?.length
                    ? `    ⛓ ${t.blockedBy.map((id) => `#${id}`).join(",")}`
                    : "";
                return `  ${glyph} #${t.id} ${t.subject}${form}${block}`;
            };

            if (pending.length > 0) {
                lines.push("── Pending ──");
                for (const t of pending) lines.push(renderTask(t, "○"));
            }
            if (inProgress.length > 0) {
                lines.push("── In Progress ──");
                for (const t of inProgress) lines.push(renderTask(t, "◐"));
            }
            if (completed.length > 0) {
                lines.push("── Completed ──");
                for (const t of completed) lines.push(renderTask(t, "✓"));
            }

            ctx.ui.notify(lines.join("\n"), "info");
        },
    });
}
```

### rpiv-todo/todo-overlay.ts — NEW

Verbatim copy of `extensions/rpiv-core/todo-overlay.ts` from rpiv-pi@7525a5d. Zero edits — imports only from `./todo.js` (intra-plugin) and pi libs. `WIDGET_KEY = "rpiv-todos"` preserved.

```typescript
/**
 * todo-overlay.ts — Persistent widget showing todo list above the editor.
 *
 * Mirrors @tintinweb/pi-subagents's AgentWidget shape: factory-form setWidget
 * registration in widgetContainerAbove, register-once + requestRender() refresh,
 * 12-line collapse-not-scroll, auto-hide when empty. No timer (todos have no
 * animation), no status bar, no aging map.
 *
 * Data source is module-level getTodos() read at render time — NEVER
 * reconstructTodoState from a tool_execution_end handler, since the persisted
 * branch is stale at that point (message_end runs after the extension event).
 */

import type {
    ExtensionUIContext,
    Theme,
} from "@mariozechner/pi-coding-agent";
import { truncateToWidth, type TUI } from "@mariozechner/pi-tui";
import { getTodos, type Task, type TaskStatus } from "./todo.js";

// ---- Constants ----

const WIDGET_KEY = "rpiv-todos";
/** Maximum rendered lines before overflow-collapse kicks in. Mirrors AgentWidget. */
const MAX_WIDGET_LINES = 12;

// ---- Helpers ----

function statusGlyph(status: TaskStatus, theme: Theme): string {
    switch (status) {
        case "pending":
            return theme.fg("dim", "○");
        case "in_progress":
            return theme.fg("warning", "◐");
        case "completed":
            return theme.fg("success", "✓");
        case "deleted":
            return theme.fg("error", "✗");
    }
}

// ---- Controller ----

export class TodoOverlay {
    private uiCtx: ExtensionUIContext | undefined;
    private widgetRegistered = false;
    private tui: TUI | undefined;

    /**
     * Bind or rebind the UI context. Identity-compares the incoming ctx so
     * subsequent session_start handlers are idempotent; on identity change
     * (e.g. /reload) cached widgetRegistered/tui are invalidated so the next
     * update() re-registers under the fresh context.
     */
    setUICtx(ctx: ExtensionUIContext): void {
        if (ctx !== this.uiCtx) {
            this.uiCtx = ctx;
            this.widgetRegistered = false;
            this.tui = undefined;
        }
    }

    /**
     * Idempotent refresh. Safe to call from session_start, session_compact,
     * session_tree, and tool_execution_end. Reads live state via getTodos() —
     * NEVER calls reconstructTodoState (branch is stale during tool events).
     */
    update(): void {
        if (!this.uiCtx) return;

        const visible = getTodos().filter((t) => t.status !== "deleted");

        // Empty → unregister and clear cached refs.
        if (visible.length === 0) {
            if (this.widgetRegistered) {
                this.uiCtx.setWidget(WIDGET_KEY, undefined);
                this.widgetRegistered = false;
                this.tui = undefined;
            }
            return;
        }

        // Non-empty → register once, then requestRender on subsequent updates.
        if (!this.widgetRegistered) {
            this.uiCtx.setWidget(
                WIDGET_KEY,
                (tui, theme) => {
                    this.tui = tui;
                    return {
                        render: (width: number) => this.renderWidget(theme, width),
                        invalidate: () => {
                            this.widgetRegistered = false;
                            this.tui = undefined;
                        },
                    };
                },
                { placement: "aboveEditor" },
            );
            this.widgetRegistered = true;
        } else {
            this.tui?.requestRender();
        }
    }

    /**
     * Build rendered rows. Called from the registered widget's render() closure,
     * so it reads live state each time via getTodos() rather than capturing it.
     * Preserves natural (insertion) order. On overflow, drops completed tasks
     * first (in-place — remaining items stay in natural order), then truncates
     * the non-completed tail if still overflowing.
     */
    private renderWidget(theme: Theme, width: number): string[] {
        const all = getTodos().filter((t) => t.status !== "deleted");
        if (all.length === 0) return [];

        const truncate = (line: string): string => truncateToWidth(line, width);

        const completedCount = all.filter((t) => t.status === "completed").length;
        const totalVisible = all.length;
        const hasActive = all.some(
            (t) => t.status === "in_progress" || t.status === "pending",
        );
        const showIds = all.some((t) => t.blockedBy && t.blockedBy.length > 0);

        const headingColor = hasActive ? "accent" : "dim";
        const headingIcon = hasActive ? "●" : "○";
        const headingText = `Todos (${completedCount}/${totalVisible})`;
        const heading = truncate(
            theme.fg(headingColor, headingIcon) +
                " " +
                theme.fg(headingColor, headingText),
        );

        const lines: string[] = [heading];
        const maxBody = MAX_WIDGET_LINES - 1;

        if (all.length <= maxBody) {
            for (const t of all) {
                lines.push(
                    truncate(
                        theme.fg("dim", "├─") + " " + this.formatTaskLine(t, theme, showIds),
                    ),
                );
            }
            const last = lines.length - 1;
            lines[last] = lines[last].replace("├─", "└─");
            return lines;
        }

        const budget = maxBody - 1;
        const nonCompleted = all.filter((t) => t.status !== "completed");

        let visible: Task[];
        let truncatedTailCount = 0;
        if (nonCompleted.length <= budget) {
            const kept = new Set<Task>(nonCompleted);
            for (const t of all) {
                if (kept.size >= budget) break;
                if (t.status === "completed") kept.add(t);
            }
            visible = all.filter((t) => kept.has(t));
        } else {
            visible = nonCompleted.slice(0, budget);
            truncatedTailCount = nonCompleted.length - budget;
        }

        for (const t of visible) {
            lines.push(
                truncate(
                    theme.fg("dim", "├─") + " " + this.formatTaskLine(t, theme, showIds),
                ),
            );
        }

        const shownCompleted = visible.filter((t) => t.status === "completed").length;
        const hiddenCompleted = completedCount - shownCompleted;
        const totalHidden = hiddenCompleted + truncatedTailCount;
        const overflowParts: string[] = [];
        if (hiddenCompleted > 0) overflowParts.push(`${hiddenCompleted} completed`);
        if (truncatedTailCount > 0) overflowParts.push(`${truncatedTailCount} pending`);
        lines.push(
            truncate(
                theme.fg("dim", "└─") +
                    " " +
                    theme.fg(
                        "dim",
                        overflowParts.length > 0
                            ? `+${totalHidden} more (${overflowParts.join(", ")})`
                            : `+${totalHidden} more`,
                    ),
            ),
        );
        return lines;
    }

    private formatTaskLine(t: Task, theme: Theme, showId: boolean): string {
        const glyph = statusGlyph(t.status, theme);
        const subjectColor =
            t.status === "completed" || t.status === "deleted" ? "dim" : "text";
        let subject = theme.fg(subjectColor, t.subject);
        if (t.status === "completed" || t.status === "deleted") {
            subject = theme.strikethrough(subject);
        }
        let line = `${glyph}`;
        if (showId) {
            line += ` ${theme.fg("accent", `#${t.id}`)}`;
        }
        line += ` ${subject}`;
        if (t.status === "in_progress" && t.activeForm) {
            line += " " + theme.fg("dim", `(${t.activeForm})`);
        }
        if (t.blockedBy && t.blockedBy.length > 0) {
            line +=
                " " +
                theme.fg(
                    "dim",
                    `⛓ ${t.blockedBy.map((id) => `#${id}`).join(",")}`,
                );
        }
        return line;
    }

    dispose(): void {
        if (this.uiCtx) {
            this.uiCtx.setWidget(WIDGET_KEY, undefined);
        }
        this.widgetRegistered = false;
        this.tui = undefined;
        this.uiCtx = undefined;
    }
}
```

### rpiv-todo/README.md — NEW

Plugin description, installation, `/todos` usage. No pi-permission-system mention per D3.

```markdown
# rpiv-todo

Pi extension that registers the `todo` tool, `/todos` slash command, and a
persistent TodoOverlay widget above the editor. Replaces Claude Code's
TaskCreate/TaskUpdate tool family.

## Installation

    pi install npm:rpiv-todo

Then restart your Pi session.

## Tool

- **`todo`** — create / update / list / get / delete / clear tasks. 4-state
  machine (pending → in_progress → completed, plus deleted tombstone).
  Supports `blockedBy` dependency tracking with cycle detection. Tasks persist
  via branch replay — survive session compact and `/reload`.

## Commands

- **`/todos`** — print the current todo list grouped by status.

## Overlay

The aboveEditor widget auto-renders whenever any non-deleted tasks exist.
12-line collapse threshold; completed tasks drop first on overflow, pending
tasks truncate last. Auto-hides when the list is empty.

## License

MIT
```

### rpiv-web-tools/package.json — NEW

Npm package manifest. No `@mariozechner/pi-ai` peer — web-tools uses truncation utilities from pi-coding-agent, not pi-ai.

```json
{
  "name": "rpiv-web-tools",
  "version": "0.1.0",
  "description": "Pi extension: web_search + web_fetch via the Brave Search API",
  "keywords": ["pi-package", "pi-extension", "rpiv", "web-search", "brave"],
  "type": "module",
  "pi": {
    "extensions": ["./index.ts"]
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-tui": "*",
    "@sinclair/typebox": "*"
  }
}
```

### rpiv-web-tools/index.ts — NEW

Pi extension entry point. Registers web_search tool + web_fetch tool + /web-search-config command. Verbatim body of `extensions/web-tools/index.ts` from rpiv-pi@7525a5d with a single edit: `CONFIG_PATH` changes from `~/.config/rpiv-pi/web-tools.json` to `~/.config/rpiv-web-tools/config.json` (line 39).

```typescript
/**
 * rpiv-web-tools — Pi extension
 *
 * Provides `web_search` and `web_fetch` tools backed by the Brave Search API.
 * Based on the user-local reference implementation at
 * ~/.pi/agent/extensions/web-search/index.ts (Tavily/Serper backends stripped,
 * Brave kept as default).
 *
 * API key resolution precedence (first wins):
 *   1. BRAVE_SEARCH_API_KEY environment variable
 *   2. apiKey field in ~/.config/rpiv-web-tools/config.json
 *
 * Use the /web-search-config slash command to set the key interactively.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
    DEFAULT_MAX_BYTES,
    DEFAULT_MAX_LINES,
    formatSize,
    truncateHead,
    type TruncationResult,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Config file persistence
// ---------------------------------------------------------------------------

interface WebToolsConfig {
    apiKey?: string;
}

const CONFIG_PATH = join(homedir(), ".config", "rpiv-web-tools", "config.json");

function loadConfig(): WebToolsConfig {
    if (!existsSync(CONFIG_PATH)) return {};
    try {
        return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as WebToolsConfig;
    } catch {
        return {};
    }
}

function saveConfig(config: WebToolsConfig): void {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
    try {
        chmodSync(CONFIG_PATH, 0o600);
    } catch {
        // chmod may fail on some filesystems — best effort only
    }
}

function resolveApiKey(): string | undefined {
    const envKey = process.env.BRAVE_SEARCH_API_KEY;
    if (envKey && envKey.trim()) return envKey.trim();
    const config = loadConfig();
    if (config.apiKey && config.apiKey.trim()) return config.apiKey.trim();
    return undefined;
}

// ---------------------------------------------------------------------------
// Brave Search API client
// ---------------------------------------------------------------------------

interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}

interface SearchResponse {
    results: SearchResult[];
    query: string;
}

async function searchBrave(
    query: string,
    maxResults: number,
    signal?: AbortSignal,
): Promise<SearchResponse> {
    const apiKey = resolveApiKey();
    if (!apiKey) {
        throw new Error(
            "BRAVE_SEARCH_API_KEY is not set. Run /web-search-config to configure, or export the env var.",
        );
    }

    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(maxResults));

    const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
            Accept: "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": apiKey,
        },
        signal,
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Brave Search API error (${res.status}): ${text}`);
    }

    const data = (await res.json()) as {
        web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
    };
    const results: SearchResult[] = (data.web?.results ?? []).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.description ?? "",
    }));

    return { results, query };
}

// ---------------------------------------------------------------------------
// HTML-to-text for web_fetch
// ---------------------------------------------------------------------------

function htmlToText(html: string): string {
    let text = html;
    text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
    text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
    text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
    text = text.replace(
        /<\/(p|div|h[1-6]|li|tr|br|blockquote|pre|section|article|header|footer|nav|details|summary)>/gi,
        "\n",
    );
    text = text.replace(/<br\s*\/?>/gi, "\n");
    text = text.replace(/<[^>]+>/g, " ");
    text = text.replace(/&amp;/g, "&");
    text = text.replace(/&lt;/g, "<");
    text = text.replace(/&gt;/g, ">");
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/&nbsp;/g, " ");
    text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
    text = text.replace(/[ \t]+/g, " ");
    text = text.replace(/\n{3,}/g, "\n\n");
    return text.trim();
}

function extractTitle(html: string): string | undefined {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (match) {
        return match[1].replace(/<[^>]+>/g, "").trim() || undefined;
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
    // =========================================================================
    // web_search tool
    // =========================================================================

    pi.registerTool({
        name: "web_search",
        label: "Web Search",
        description:
            "Search the web for information via the Brave Search API. Returns a list of results with titles, URLs, and snippets. Use when you need current information not in your training data.",
        promptSnippet: "Search the web for up-to-date information via Brave",
        promptGuidelines: [
            "Use web_search for information beyond your training data — recent events, current library versions, live API documentation.",
            "Use the current year from \"Current date:\" in your context when searching for recent information or documentation.",
            "After answering using search results, include a \"Sources:\" section listing relevant URLs as markdown hyperlinks: [Title](URL). Never skip this.",
            "Domain filtering is supported to include or block specific websites.",
            "If BRAVE_SEARCH_API_KEY is not set, ask the user to run /web-search-config before proceeding.",
        ],
        parameters: Type.Object({
            query: Type.String({
                description: "The search query. Be specific and use natural language.",
            }),
            max_results: Type.Optional(
                Type.Number({
                    description: "Maximum number of results to return (1-10). Default: 5.",
                    default: 5,
                    minimum: 1,
                    maximum: 10,
                }),
            ),
        }),

        async execute(_toolCallId, params, signal, onUpdate, _ctx) {
            const maxResults = Math.min(Math.max(params.max_results ?? 5, 1), 10);

            onUpdate?.({
                content: [{ type: "text", text: `Searching Brave for: "${params.query}"...` }],
            });

            try {
                const response = await searchBrave(params.query, maxResults, signal);

                if (response.results.length === 0) {
                    return {
                        content: [
                            { type: "text", text: `No results found for "${params.query}".` },
                        ],
                        details: { query: params.query, backend: "brave", resultCount: 0 },
                    };
                }

                let text = `**Search results for "${response.query}":**\n\n`;
                for (let i = 0; i < response.results.length; i++) {
                    const r = response.results[i];
                    text += `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}\n\n`;
                }

                return {
                    content: [{ type: "text", text: text.trimEnd() }],
                    details: {
                        query: params.query,
                        backend: "brave",
                        resultCount: response.results.length,
                        results: response.results,
                    },
                };
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                return {
                    content: [{ type: "text", text: `Web search failed: ${message}` }],
                    isError: true,
                    details: { query: params.query, backend: "brave", error: message },
                };
            }
        },

        renderCall(args, theme, _context) {
            let text = theme.fg("toolTitle", theme.bold("WebSearch "));
            text += theme.fg("accent", `"${args.query}"`);
            return new Text(text, 0, 0);
        },

        renderResult(result, { expanded, isPartial }, theme, _context) {
            if (isPartial) {
                return new Text(theme.fg("warning", "Searching..."), 0, 0);
            }
            const details = result.details as { resultCount?: number; results?: SearchResult[] };
            if (result.isError) {
                return new Text(theme.fg("error", "✗ Search failed"), 0, 0);
            }
            const count = details?.resultCount ?? 0;
            let text = theme.fg("success", `✓ ${count} result${count !== 1 ? "s" : ""}`);
            if (expanded && details?.results) {
                for (const r of details.results.slice(0, 5)) {
                    text += `\n  ${theme.fg("dim", `• ${r.title}`)}`;
                }
                if (details.results.length > 5) {
                    text += `\n  ${theme.fg("dim", `... and ${details.results.length - 5} more`)}`;
                }
            }
            return new Text(text, 0, 0);
        },
    });

    // =========================================================================
    // web_fetch tool
    // =========================================================================

    interface FetchDetails {
        url: string;
        title?: string;
        contentType?: string;
        contentLength?: number;
        truncation?: TruncationResult;
        fullOutputPath?: string;
    }

    pi.registerTool({
        name: "web_fetch",
        label: "Web Fetch",
        description:
            "Fetch the content of a specific URL. Returns text content for HTML pages (tags stripped), raw text for plain text or JSON. Supports http and https only. Content is truncated to avoid overwhelming the context window.",
        promptSnippet: "Fetch and read content from a specific URL",
        promptGuidelines: [
            "Use web_fetch to read the full content of a specific URL — documentation pages, blog posts, API references found via web_search.",
            "web_fetch is complementary to web_search: search finds URLs, fetch reads them.",
            "After answering using fetched content, include a \"Sources:\" section with a markdown hyperlink to the fetched URL.",
            "Large responses are truncated and spilled to a temp file — the temp path is reported in the result details.",
        ],
        parameters: Type.Object({
            url: Type.String({ description: "The URL to fetch. Must be http or https." }),
            raw: Type.Optional(
                Type.Boolean({
                    description: "If true, return the raw HTML instead of extracted text. Default: false.",
                    default: false,
                }),
            ),
        }),

        async execute(_toolCallId, params, signal, onUpdate, _ctx) {
            const { url, raw = false } = params;

            let parsedUrl: URL;
            try {
                parsedUrl = new URL(url);
            } catch {
                throw new Error(`Invalid URL: ${url}`);
            }
            if (!["http:", "https:"].includes(parsedUrl.protocol)) {
                throw new Error(
                    `Unsupported URL protocol: ${parsedUrl.protocol}. Only http and https are supported.`,
                );
            }

            onUpdate?.({ content: [{ type: "text", text: `Fetching: ${url}...` }] });

            const res = await fetch(url, {
                signal,
                redirect: "follow",
                headers: {
                    "User-Agent": "Mozilla/5.0 (compatible; rpiv-pi/1.0)",
                    Accept:
                        "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
                },
            });

            if (!res.ok) {
                throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
            }

            const contentType = res.headers.get("content-type") ?? "";
            const contentLength = res.headers.get("content-length");

            if (
                contentType.includes("image/") ||
                contentType.includes("video/") ||
                contentType.includes("audio/")
            ) {
                throw new Error(`Unsupported content type: ${contentType}. web_fetch supports text pages only.`);
            }

            const body = await res.text();

            let resultText: string;
            let title: string | undefined;

            if (contentType.includes("text/html") && !raw) {
                title = extractTitle(body);
                resultText = htmlToText(body);
            } else {
                resultText = body;
            }

            const truncation = truncateHead(resultText, {
                maxLines: DEFAULT_MAX_LINES,
                maxBytes: DEFAULT_MAX_BYTES,
            });

            const details: FetchDetails = {
                url,
                title,
                contentType,
                contentLength: contentLength ? Number(contentLength) : undefined,
            };

            let output = truncation.content;

            if (truncation.truncated) {
                const tempDir = await mkdtemp(join(tmpdir(), "rpiv-fetch-"));
                const tempFile = join(tempDir, "content.txt");
                await writeFile(tempFile, resultText, "utf8");
                details.truncation = truncation;
                details.fullOutputPath = tempFile;

                const truncatedLines = truncation.totalLines - truncation.outputLines;
                const truncatedBytes = truncation.totalBytes - truncation.outputBytes;
                output += `\n\n[Content truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
                output += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
                output += ` ${truncatedLines} lines (${formatSize(truncatedBytes)}) omitted.`;
                output += ` Full content saved to: ${tempFile}]`;
            }

            let header = `**Fetched:** ${url}`;
            if (title) header += `\n**Title:** ${title}`;
            if (contentType) header += `\n**Content-Type:** ${contentType}`;
            header += "\n\n";

            return {
                content: [{ type: "text", text: header + output }],
                details,
            };
        },

        renderCall(args, theme, _context) {
            let text = theme.fg("toolTitle", theme.bold("WebFetch "));
            text += theme.fg("accent", args.url);
            return new Text(text, 0, 0);
        },

        renderResult(result, { expanded, isPartial }, theme, _context) {
            if (isPartial) {
                return new Text(theme.fg("warning", "Fetching..."), 0, 0);
            }
            if (result.isError) {
                return new Text(theme.fg("error", "✗ Fetch failed"), 0, 0);
            }
            const details = result.details as FetchDetails | undefined;
            let text = theme.fg("success", "✓ Fetched");
            if (details?.title) {
                text += theme.fg("muted", `: ${details.title}`);
            }
            if (details?.truncation?.truncated) {
                text += theme.fg("warning", " (truncated)");
            }
            if (expanded) {
                const content = result.content[0];
                if (content?.type === "text") {
                    const lines = content.text.split("\n").slice(0, 15);
                    for (const line of lines) {
                        text += `\n  ${theme.fg("dim", line)}`;
                    }
                    if (content.text.split("\n").length > 15) {
                        text += `\n  ${theme.fg("muted", "... (use read tool to see full content)")}`;
                    }
                }
            }
            return new Text(text, 0, 0);
        },
    });

    // =========================================================================
    // /web-search-config slash command
    // =========================================================================

    pi.registerCommand("web-search-config", {
        description: "Configure the Brave Search API key used by web_search/web_fetch",
        handler: async (args, ctx) => {
            if (!ctx.hasUI) {
                ctx.ui?.notify?.("/web-search-config requires interactive mode", "error");
                return;
            }

            const current = loadConfig();
            const showMode = typeof args === "string" && args.includes("--show");

            if (showMode) {
                const masked = current.apiKey
                    ? `${current.apiKey.slice(0, 4)}...${current.apiKey.slice(-4)}`
                    : "(not set)";
                const envMasked = process.env.BRAVE_SEARCH_API_KEY
                    ? `${process.env.BRAVE_SEARCH_API_KEY.slice(0, 4)}...${process.env.BRAVE_SEARCH_API_KEY.slice(-4)}`
                    : "(not set)";
                ctx.ui.notify(
                    `Web search config:\n  config file: ${CONFIG_PATH}\n  apiKey: ${masked}\n  BRAVE_SEARCH_API_KEY env: ${envMasked}`,
                    "info",
                );
                return;
            }

            const input = await ctx.ui.input(
                "Brave Search API key",
                current.apiKey ? "(leave empty to keep existing)" : "sk-...",
            );

            if (input === undefined || input === null) {
                ctx.ui.notify("Web search config unchanged", "info");
                return;
            }

            const trimmed = input.trim();
            if (!trimmed) {
                ctx.ui.notify("Web search config unchanged", "info");
                return;
            }

            saveConfig({ ...current, apiKey: trimmed });
            ctx.ui.notify(`Saved Brave API key to ${CONFIG_PATH}`, "info");
        },
    });
}
```

### rpiv-web-tools/README.md — NEW

Plugin description, installation, `/web-search-config` usage, BRAVE_SEARCH_API_KEY env-var fallback, config-path migration note. No pi-permission-system mention per D3.

```markdown
# rpiv-web-tools

Pi extension that registers the `web_search` and `web_fetch` tools, backed by
the Brave Search API. Also ships `/web-search-config` for interactive API
key configuration.

## Installation

    pi install npm:rpiv-web-tools

Then restart your Pi session.

## Tools

- **`web_search`** — query the Brave Search API and return titled snippets.
  1–10 results per call.
- **`web_fetch`** — fetch an http/https URL, strip HTML to text (or return raw
  HTML with `raw: true`), truncate large responses with a temp-file spill for
  the full content.

## Commands

- **`/web-search-config`** — set the Brave API key interactively. Writes to
  `~/.config/rpiv-web-tools/config.json` (chmod 0600). Pass `--show` to see
  the current (masked) key and env var status.

## API key resolution

First match wins:

1. `BRAVE_SEARCH_API_KEY` environment variable
2. `apiKey` field in `~/.config/rpiv-web-tools/config.json`

## Migration from rpiv-pi ≤ 0.3.0

If you configured a Brave API key while rpiv-pi bundled this tool, it lived
at `~/.config/rpiv-pi/web-tools.json`. The new plugin reads
`~/.config/rpiv-web-tools/config.json` only — run `/web-search-config` once
to re-enter your key, or continue using the `BRAVE_SEARCH_API_KEY` env var
(which takes precedence and keeps working unchanged).

## License

MIT
```

### extensions/rpiv-core/ask-user-question.ts — DELETE

Removed. Moved to `rpiv-ask-user-question` plugin (Slice 1).

```text
# rm extensions/rpiv-core/ask-user-question.ts
```

### extensions/rpiv-core/advisor.ts — DELETE

Removed. Moved to `rpiv-advisor` plugin (Slice 2, with config-path edit).

```text
# rm extensions/rpiv-core/advisor.ts
```

### extensions/rpiv-core/todo.ts — DELETE

Removed. Moved to `rpiv-todo` plugin (Slice 3).

```text
# rm extensions/rpiv-core/todo.ts
```

### extensions/rpiv-core/todo-overlay.ts — DELETE

Removed. Moved to `rpiv-todo` plugin (Slice 3).

```text
# rm extensions/rpiv-core/todo-overlay.ts
```

### extensions/rpiv-core/permissions.ts — DELETE

Removed entirely. Pi is YOLO by default; `pi-permission-system` is a user choice, not a rpiv-pi concern (D3).

```text
# rm extensions/rpiv-core/permissions.ts
```

### extensions/rpiv-core/templates/pi-permissions.jsonc — DELETE

Removed entirely. Template was only consumed by `seedPermissionsFile()` which is also deleted. Remove the `templates/` directory if empty after this deletion.

```text
# rm extensions/rpiv-core/templates/pi-permissions.jsonc
# rmdir extensions/rpiv-core/templates  # if empty
```

### extensions/web-tools/index.ts — DELETE

Removed. Moved to `rpiv-web-tools` plugin (Slice 4, with config-path edit). Also remove the `extensions/web-tools/` directory.

```text
# rm extensions/web-tools/index.ts
# rmdir extensions/web-tools
```

### extensions/rpiv-core/package-checks.ts:1-40 — MODIFY

Adds four new probes (`hasRpivAskUserQuestionInstalled`, `hasRpivTodoInstalled`, `hasRpivAdvisorInstalled`, `hasRpivWebToolsInstalled`) following the existing pattern. Full rewrite for clarity (file stays ~55 LOC).

```typescript
/**
 * Package presence checks — detects whether sibling pi packages are installed.
 *
 * Pure utility. No ExtensionAPI interactions.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const PI_AGENT_SETTINGS = join(homedir(), ".pi", "agent", "settings.json");

// ---------------------------------------------------------------------------
// Package Detection
// ---------------------------------------------------------------------------

export function readInstalledPackages(): string[] {
    if (!existsSync(PI_AGENT_SETTINGS)) return [];
    try {
        const raw = readFileSync(PI_AGENT_SETTINGS, "utf-8");
        const settings = JSON.parse(raw) as { packages?: unknown };
        if (!Array.isArray(settings.packages)) return [];
        return settings.packages.filter((e): e is string => typeof e === "string");
    } catch {
        return [];
    }
}

export function hasPiSubagentsInstalled(): boolean {
    return readInstalledPackages().some((entry) => /@tintinweb\/pi-subagents/i.test(entry));
}

export function hasPiPermissionSystemInstalled(): boolean {
    return readInstalledPackages().some((entry) => /pi-permission-system/i.test(entry));
}

export function hasRpivAskUserQuestionInstalled(): boolean {
    return readInstalledPackages().some((entry) => /rpiv-ask-user-question/i.test(entry));
}

export function hasRpivTodoInstalled(): boolean {
    return readInstalledPackages().some((entry) => /rpiv-todo/i.test(entry));
}

export function hasRpivAdvisorInstalled(): boolean {
    return readInstalledPackages().some((entry) => /rpiv-advisor/i.test(entry));
}

export function hasRpivWebToolsInstalled(): boolean {
    return readInstalledPackages().some((entry) => /rpiv-web-tools/i.test(entry));
}
```

### extensions/rpiv-core/index.ts:1-268 — MODIFY

Full rewrite. Prunes extracted-module imports, removes todoOverlay closure + 5 hook touchpoints, drops `seedPermissionsFile`, removes `session_tree` and `tool_execution_end` handlers (both served todo exclusively), replaces single hardcoded sibling warning with aggregated 5-sibling loop, expands `/rpiv-setup` to install all 5 prerequisites. Keeps: guidance, git-context, thoughts scaffold, agent-copy, subagent tuning, `active_agent` workaround, `/rpiv-update-agents`.

```typescript
/**
 * rpiv-core — Orchestrator extension for the rpiv-pi package
 *
 * Provides:
 * - Guidance injection (replaces inject-guidance.js hook)
 * - Git context injection (replaces !`git ...` shell evaluation in skills)
 * - thoughts/ directory scaffolding on session start
 * - Bundled-agent auto-copy into <cwd>/.pi/agents/
 * - Subagent tuning (@tintinweb/pi-subagents maxTurns cap)
 * - active_agent seed workaround for pi-permission-system@0.4.1
 * - Aggregated session_start warning for missing sibling plugins
 * - /rpiv-update-agents, /rpiv-setup slash commands
 *
 * Tool-owning plugins are siblings: rpiv-ask-user-question, rpiv-todo,
 * rpiv-advisor, rpiv-web-tools. Install via /rpiv-setup.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { clearInjectionState, handleToolCallGuidance, injectRootGuidance } from "./guidance.js";
import { copyBundledAgents } from "./agents.js";
import {
    hasPiSubagentsInstalled,
    hasPiPermissionSystemInstalled,
    hasRpivAskUserQuestionInstalled,
    hasRpivTodoInstalled,
    hasRpivAdvisorInstalled,
    hasRpivWebToolsInstalled,
} from "./package-checks.js";
import { applySubagentTuning } from "./subagent-tuning.js";

export default function (pi: ExtensionAPI) {
    // ── Session Start ──────────────────────────────────────────────────────
    pi.on("session_start", async (_event, ctx) => {
        clearInjectionState();
        injectRootGuidance(ctx.cwd, pi);

        // Cap @tintinweb/pi-subagents' default maxTurns at 10 (silent no-op
        // when the peer dep is absent). Per-agent frontmatter can raise it.
        await applySubagentTuning(pi);

        // Seed a root `active_agent` session entry so pi-permission-system's
        // input handler can resolve the root context on the very first user
        // input. Without this, `/skill:<name>` as the first message of a fresh
        // session is blocked with "active agent context is unavailable" —
        // pi-permission-system@0.4.1 calls resolveAgentName(ctx) without
        // systemPrompt in its input handler, so it only checks session entries
        // and a stale cache, both empty before before_agent_start has fired.
        if (hasPiPermissionSystemInstalled()) {
            pi.appendEntry("active_agent", { name: "general-purpose" });
        }

        // Scaffold thoughts/ directory structure (artifact chain)
        const dirs = [
            "thoughts/shared/research",
            "thoughts/shared/questions",
            "thoughts/shared/designs",
            "thoughts/shared/plans",
            "thoughts/shared/handoffs",
        ];
        for (const dir of dirs) {
            mkdirSync(join(ctx.cwd, dir), { recursive: true });
        }

        // Auto-copy bundled agents into <cwd>/.pi/agents/
        const agentResult = copyBundledAgents(ctx.cwd, false);
        if (ctx.hasUI && agentResult.copied.length > 0) {
            ctx.ui.notify(
                `Copied ${agentResult.copied.length} rpiv-pi agent(s) to .pi/agents/`,
                "info",
            );
        }

        // Aggregated warning for any missing sibling plugins
        if (ctx.hasUI) {
            const missing: string[] = [];
            if (!hasPiSubagentsInstalled()) missing.push("@tintinweb/pi-subagents");
            if (!hasRpivAskUserQuestionInstalled()) missing.push("rpiv-ask-user-question");
            if (!hasRpivTodoInstalled()) missing.push("rpiv-todo");
            if (!hasRpivAdvisorInstalled()) missing.push("rpiv-advisor");
            if (!hasRpivWebToolsInstalled()) missing.push("rpiv-web-tools");
            if (missing.length > 0) {
                ctx.ui.notify(
                    `rpiv-pi requires ${missing.length} sibling extension(s): ${missing.join(", ")}. Run /rpiv-setup to install them.`,
                    "warning",
                );
            }
        }
    });

    // ── Session Compact — drop injection state, re-inject root guidance ────
    pi.on("session_compact", async (_event, ctx) => {
        clearInjectionState();
        injectRootGuidance(ctx.cwd, pi);
    });

    // ── Session Shutdown ───────────────────────────────────────────────────
    pi.on("session_shutdown", async (_event, _ctx) => {
        clearInjectionState();
    });

    // ── Guidance Injection ─────────────────────────────────────────────────
    pi.on("tool_call", async (event, ctx) => {
        handleToolCallGuidance(event, ctx, pi);
    });

    // ── Git Context Injection ──────────────────────────────────────────────
    pi.on("before_agent_start", async (_event, ctx) => {
        try {
            const branch = await pi.exec("git", ["branch", "--show-current"], { timeout: 5000 });
            const commit = await pi.exec("git", ["rev-parse", "--short", "HEAD"], { timeout: 5000 });

            if (branch.stdout.trim() || commit.stdout.trim()) {
                return {
                    message: {
                        customType: "rpiv-git-context",
                        content: `## Git Context\n- Branch: ${branch.stdout.trim() || "no-branch"}\n- Commit: ${commit.stdout.trim() || "no-commit"}`,
                        display: false,
                    },
                };
            }
        } catch {
            // Not a git repo — skip silently
        }
    });

    // ── /rpiv-update-agents Command ────────────────────────────────────────
    pi.registerCommand("rpiv-update-agents", {
        description: "Re-copy rpiv-pi's bundled agents into .pi/agents/, overwriting local edits",
        handler: async (_args, ctx) => {
            const result = copyBundledAgents(ctx.cwd, true);
            if (!ctx.hasUI) return;
            if (result.copied.length === 0) {
                ctx.ui.notify("No bundled agents found to copy", "warning");
                return;
            }
            ctx.ui.notify(
                `Refreshed ${result.copied.length} agent(s) in .pi/agents/: ${result.copied.join(", ")}`,
                "info",
            );
        },
    });

    // ── /rpiv-setup Command ────────────────────────────────────────────────
    pi.registerCommand("rpiv-setup", {
        description: "Install rpiv-pi's sibling extension plugins",
        handler: async (_args, ctx) => {
            if (!ctx.hasUI) {
                ctx.ui.notify("/rpiv-setup requires interactive mode", "error");
                return;
            }

            const missing: Array<{ pkg: string; reason: string }> = [];
            if (!hasPiSubagentsInstalled()) {
                missing.push({
                    pkg: "npm:@tintinweb/pi-subagents",
                    reason: "required — provides Agent / get_subagent_result / steer_subagent tools",
                });
            }
            if (!hasRpivAskUserQuestionInstalled()) {
                missing.push({
                    pkg: "npm:rpiv-ask-user-question",
                    reason: "required — provides the ask_user_question tool",
                });
            }
            if (!hasRpivTodoInstalled()) {
                missing.push({
                    pkg: "npm:rpiv-todo",
                    reason: "required — provides the todo tool + /todos command + overlay widget",
                });
            }
            if (!hasRpivAdvisorInstalled()) {
                missing.push({
                    pkg: "npm:rpiv-advisor",
                    reason: "required — provides the advisor tool + /advisor command",
                });
            }
            if (!hasRpivWebToolsInstalled()) {
                missing.push({
                    pkg: "npm:rpiv-web-tools",
                    reason: "required — provides web_search + web_fetch tools + /web-search-config",
                });
            }

            if (missing.length === 0) {
                ctx.ui.notify(
                    "All rpiv-pi sibling dependencies already installed.",
                    "info",
                );
                return;
            }

            const lines = [
                "rpiv-pi will install the following Pi packages via `pi install`:",
                "",
                ...missing.map((m) => `  • ${m.pkg}  (${m.reason})`),
                "",
                "Each install is a separate `pi install <pkg>` invocation. Your",
                "~/.pi/agent/settings.json will be updated. Proceed?",
            ];

            const confirmed = await ctx.ui.confirm("Install rpiv-pi dependencies?", lines.join("\n"));
            if (!confirmed) {
                ctx.ui.notify("/rpiv-setup cancelled", "info");
                return;
            }

            const succeeded: string[] = [];
            const failed: Array<{ pkg: string; error: string }> = [];
            for (const { pkg } of missing) {
                ctx.ui.notify(`Installing ${pkg}…`, "info");
                try {
                    const result = await pi.exec("pi", ["install", pkg], { timeout: 120_000 });
                    if (result.code === 0) {
                        succeeded.push(pkg);
                    } else {
                        failed.push({
                            pkg,
                            error: (result.stderr || result.stdout || `exit ${result.code}`).trim().slice(0, 300),
                        });
                    }
                } catch (err) {
                    failed.push({
                        pkg,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }

            const report: string[] = [];
            if (succeeded.length > 0) {
                report.push(`✓ Installed: ${succeeded.join(", ")}`);
            }
            if (failed.length > 0) {
                report.push(`✗ Failed:`);
                for (const { pkg, error } of failed) {
                    report.push(`  ${pkg}: ${error}`);
                }
            }
            if (succeeded.length > 0) {
                report.push("");
                report.push("Restart your Pi session to load the newly-installed extensions.");
            }
            ctx.ui.notify(report.join("\n"), failed.length > 0 ? "warning" : "info");
        },
    });
}
```

### package.json:1-20 — MODIFY

Move `@tintinweb/pi-subagents` from `dependencies` to `peerDependencies`; add four new siblings to `peerDependencies`. Bump version to 0.4.0 (breaking — requires sibling installs). Full rewrite.

```json
{
  "name": "rpiv-pi",
  "version": "0.4.0",
  "description": "Skill-based development workflow for Pi — research, design, plan, implement, review",
  "keywords": ["pi-package", "pi-extension"],
  "type": "module",
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"]
  },
  "peerDependencies": {
    "@mariozechner/pi-ai": "*",
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-tui": "*",
    "@sinclair/typebox": "*",
    "@tintinweb/pi-subagents": "*",
    "rpiv-ask-user-question": "*",
    "rpiv-todo": "*",
    "rpiv-advisor": "*",
    "rpiv-web-tools": "*"
  }
}
```

### README.md — MODIFY

Installation, Requirements, and Extensions sections rewritten to reflect the 5-sibling dependency chain. pi-permission-system "Recommended" section dropped per D3. New "Migration from 0.3.x" section guides upgrading users. Skills and agents tables unchanged.

```markdown
# rpiv-pi

Skill-based development workflow for Pi — research, design, plan, implement, review.

Version: 0.4.0

## Requirements

All dependencies are peer-dependencies — expected to be installed in the Pi environment.

### Runtime libraries
- `@mariozechner/pi-coding-agent` — the Pi CLI runtime
- `@mariozechner/pi-ai`
- `@mariozechner/pi-tui`
- `@sinclair/typebox`

### Sibling Pi plugins (hard-required)
- `@tintinweb/pi-subagents` — provides the `Agent` tool and the `/agents` command. Without it, every rpiv-pi skill that dispatches a named subagent silently falls back to `general-purpose`.
- `rpiv-ask-user-question` — provides the `ask_user_question` tool.
- `rpiv-todo` — provides the `todo` tool, `/todos` command, and overlay widget.
- `rpiv-advisor` — provides the `advisor` tool and `/advisor` command.
- `rpiv-web-tools` — provides the `web_search` and `web_fetch` tools and `/web-search-config` command.

rpiv-pi emits an aggregated warning on session start listing any missing siblings, and `/rpiv-setup` installs them all in one go.

## Installation

```bash
pi install /Users/sguslystyi/rpiv-pi
```

Then from inside a Pi session, install all siblings in one go:

```
/rpiv-setup
```

Or install them manually:

```bash
pi install npm:@tintinweb/pi-subagents
pi install npm:rpiv-ask-user-question
pi install npm:rpiv-todo
pi install npm:rpiv-advisor
pi install npm:rpiv-web-tools
```

After the first install of `rpiv-web-tools`, set the Brave Search API key from inside a Pi session:

```
/web-search-config
```

On first session start in any project, rpiv-pi auto-copies agent files to `<cwd>/.pi/agents/`.

## What's included

### Extension in this package

| Extension | Tools | Commands | Session hooks |
|-----------|-------|----------|---------------|
| `rpiv-core` | — | `/rpiv-update-agents`, `/rpiv-setup` | `session_start`, `session_compact`, `session_shutdown`, `tool_call`, `before_agent_start` |

Tool-owning plugins are shipped separately — see the Requirements section above.

### Skills (17)

Invoke via `/skill:<name>` from inside a Pi session.

| Skill | Description |
|---|---|
| `annotate-guidance` | Generate architecture.md guidance files in `.rpiv/guidance/` by analyzing architecture and patterns in parallel. |
| `annotate-inline` | Generate CLAUDE.md files across a project by analyzing architecture and patterns in parallel. |
| `code-review` | Conduct comprehensive code reviews by analyzing changes in parallel. |
| `commit` | Create structured git commits grouped by logical change. |
| `create-handoff` | Create context-preserving handoff documents for session transitions. |
| `design` | Design features through iterative vertical-slice decomposition with developer micro-checkpoints. Accepts research or solutions artifacts. |
| `implement-plan` | Execute approved implementation plans phase by phase. |
| `iterate-plan` | Update existing implementation plans based on feedback. |
| `migrate-to-guidance` | Migrate existing CLAUDE.md files to the `.rpiv/guidance/` system. |
| `outline-test-cases` | Discover testable features and create a folder outline under `.rpiv/test-cases/` with per-feature metadata. |
| `research` | Answer structured research questions via targeted parallel analysis agents. |
| `research-questions` | Generate trace-quality research questions from codebase discovery. |
| `research-solutions` | Analyze solution options for features or changes with pros/cons. |
| `resume-handoff` | Resume work from a handoff document. |
| `validate-plan` | Verify that an implementation plan was correctly executed. |
| `write-plan` | Create phased implementation plans from design artifacts. |
| `write-test-cases` | Generate manual test case specifications for a single feature by analyzing code in parallel. |

### Agents (9)

Dispatched via the `Agent` tool (provided by `@tintinweb/pi-subagents`) with `subagent_type: "<name>"`.

| Agent | Purpose |
|---|---|
| `codebase-analyzer` | Analyzes codebase implementation details for specific components. |
| `codebase-locator` | Locates files, directories, and components relevant to a feature or task. |
| `codebase-pattern-finder` | Finds similar implementations, usage examples, and existing patterns with concrete code. |
| `integration-scanner` | Finds inbound references, outbound dependencies, config registrations, and event subscriptions. |
| `precedent-locator` | Finds similar past changes in git history — commits, blast radius, follow-up fixes. |
| `test-case-locator` | Finds existing manual test cases in `.rpiv/test-cases/` and reports coverage stats. |
| `thoughts-analyzer` | Deep-dive analysis on research topics in `thoughts/`. |
| `thoughts-locator` | Discovers relevant documents in the `thoughts/` directory by topic. |
| `web-search-researcher` | Researches web-based information and modern documentation via `web_search` / `web_fetch`. |

## Typical workflow

```
/skill:research-questions "how does X work"
/skill:research thoughts/shared/questions/<latest>.md
/skill:design thoughts/shared/research/<latest>.md
/skill:write-plan thoughts/shared/designs/<latest>.md
/skill:implement-plan thoughts/shared/plans/<latest>.md Phase <N>
```

## Migration from 0.3.x

Users upgrading from rpiv-pi 0.3.x need to install the four extracted sibling plugins. The fastest path:

1. `pi install <path-to-rpiv-pi>@0.4.0`
2. Start a Pi session.
3. Run `/rpiv-setup` and confirm.
4. Restart the session.

Saved configuration at `~/.config/rpiv-pi/advisor.json` and `~/.config/rpiv-pi/web-tools.json` is no longer read. Re-run `/advisor` and `/web-search-config` once after installing their respective sibling plugins. The `BRAVE_SEARCH_API_KEY` env var continues to work unchanged.

## Notes

- Agent files live at `<cwd>/.pi/agents/` and are editable; `/rpiv-update-agents` refreshes them from the bundled defaults.
- Artifacts written by skills land under `thoughts/shared/{research,questions,designs,plans,handoffs,reviews,solutions}/` in the current project.
- `@tintinweb/pi-subagents` defaults to 4 concurrent background agents per session; raise it per-session via `/agents → Settings → Max concurrency → 48` if skills stall on wide fan-outs.
```

## Desired End State

```bash
# Fresh install
pi install npm:rpiv-pi
# User sees session_start warning:
#   "rpiv-pi requires 5 sibling extensions: @tintinweb/pi-subagents, rpiv-ask-user-question,
#    rpiv-todo, rpiv-advisor, rpiv-web-tools. Run /rpiv-setup to install them."

pi
> /rpiv-setup
# Prompts to install the 5 missing siblings; user confirms; each is `pi install`ed sequentially.

# After restart
pi
# Session loads with all five extensions active. `ask_user_question`, `todo`, `advisor`,
# `web_search`, `web_fetch` are registered. `/todos`, `/advisor`, `/web-search-config`,
# `/rpiv-setup`, `/rpiv-update-agents` are available.
# No ~/.pi/agent/pi-permissions.jsonc file is seeded (Pi is YOLO; users who want a
# permission extension own their policy file separately).
```

```typescript
// Consumer view: skills still invoke ask_user_question exactly as before
// skills/write-plan/SKILL.md:68 still reads:
//   "Use ask_user_question to confirm the plan before writing"
// — no change needed because the tool name is preserved.
```

## File Map

```
rpiv-ask-user-question/package.json                         # NEW — plugin manifest
rpiv-ask-user-question/index.ts                             # NEW — Pi default export
rpiv-ask-user-question/ask-user-question.ts                 # NEW — verbatim move
rpiv-ask-user-question/README.md                            # NEW — plugin docs

rpiv-advisor/package.json                                   # NEW — plugin manifest
rpiv-advisor/index.ts                                       # NEW — Pi default export
rpiv-advisor/advisor.ts                                     # NEW — verbatim + config path edit
rpiv-advisor/README.md                                      # NEW — plugin docs

rpiv-todo/package.json                                      # NEW — plugin manifest
rpiv-todo/index.ts                                          # NEW — Pi default export + 5 hooks
rpiv-todo/todo.ts                                           # NEW — verbatim move
rpiv-todo/todo-overlay.ts                                   # NEW — verbatim move
rpiv-todo/README.md                                         # NEW — plugin docs

rpiv-web-tools/package.json                                 # NEW — plugin manifest
rpiv-web-tools/index.ts                                     # NEW — verbatim + config path edit
rpiv-web-tools/README.md                                    # NEW — plugin docs

extensions/rpiv-core/ask-user-question.ts                   # DELETE
extensions/rpiv-core/advisor.ts                             # DELETE
extensions/rpiv-core/todo.ts                                # DELETE
extensions/rpiv-core/todo-overlay.ts                        # DELETE
extensions/rpiv-core/permissions.ts                         # DELETE
extensions/rpiv-core/templates/pi-permissions.jsonc         # DELETE
extensions/web-tools/index.ts                               # DELETE (+ dir)
extensions/rpiv-core/package-checks.ts                      # MODIFY — add 4 probes
extensions/rpiv-core/index.ts                               # MODIFY — prune, aggregate, expand /rpiv-setup
package.json                                                # MODIFY — peerDependencies
README.md                                                   # MODIFY — install list, ownership
```

## Ordering Constraints

- Slices 1-4 are independent of each other for plugin-internal correctness but each benefits from the previous slice as a pattern template (plugin `package.json`, plugin `index.ts` shape, README structure). Sequential build recommended.
- Slice 5 (orchestrator cleanup) MUST come last — until it runs, the rpiv-pi repo still contains the extracted modules inline. Installing any sibling plugin alongside the still-inlined rpiv-pi would cause a duplicate tool registration.
- Within each plugin slice: package.json → extensions/index.ts → verbatim-moved source file → README.md. README last because it references tool names + installation flow finalized by earlier files.
- No parallel execution across slices — the pattern template must be written once and reused.

## Verification Notes

- **Each plugin loads in isolation**: `pi install npm:rpiv-<name>` on a fresh Pi install (no rpiv-pi present) registers the expected tools and commands. Verifiable via `/tools` or equivalent listing.
- **Todo branch replay preserved**: a session with existing `todo` tool-result entries, after upgrading to rpiv-todo, displays the correct task list on `/todos` — confirms `reconstructTodoState` still matches `msg.toolName === "todo"`.
- **Todo overlay refresh intact**: calling `todo` from the agent updates the aboveEditor widget within one render cycle — confirms `tool_execution_end` handler is wired in the new plugin's index.ts.
- **Advisor default-OFF enforcement**: fresh session with no saved config has `advisor` stripped from `pi.getActiveTools()` on every `before_agent_start` — confirms `registerAdvisorBeforeAgentStart` runs in the extracted plugin's session.
- **Advisor silent cutover**: a user with `~/.config/rpiv-pi/advisor.json` sees advisor OFF on next session; `/advisor` reconfigure writes to `~/.config/rpiv-advisor/advisor.json`.
- **web-tools loud cutover**: first `web_search` call after upgrade throws `"BRAVE_SEARCH_API_KEY is not set. Run /web-search-config to configure, or export the env var."` — confirms config-path change is reached. `BRAVE_SEARCH_API_KEY` env var keeps working.
- **rpiv-pi session_start warning aggregation**: install rpiv-pi without any siblings; session_start emits one notification listing all five missing siblings. Verifiable by `grep -c "rpiv-pi requires" pi-output.txt` == 1.
- **/rpiv-setup installs all five**: on a bare install, `/rpiv-setup` confirms and runs five `pi install` invocations sequentially.
- **No pi-permissions.jsonc is seeded**: after fresh rpiv-pi install, `~/.pi/agent/pi-permissions.jsonc` absence is preserved.
- **active_agent workaround still fires**: with `pi-permission-system` installed, fresh rpiv-pi session writes `active_agent` entry before first user input — test by running `/skill:<name>` as the first message, must not error with "active agent context is unavailable".
- **Type-check passes**: `cd rpiv-ask-user-question && npx tsc --noEmit` (and per each plugin) exits 0. rpiv-pi orchestrator typechecks with extracted modules deleted.
- **No dangling imports in rpiv-core/index.ts**: `grep -E "(ask-user-question|todo|advisor|permissions)\.js" extensions/rpiv-core/index.ts` returns no matches.

## Performance Considerations

- `session_start` gains four additional `readInstalledPackages()` calls (one per new probe). Each is a single JSON parse of `~/.pi/agent/settings.json` — negligible, sub-millisecond.
- Aggregated warning replaces one conditional `notify` with one conditional `notify` over a 5-element loop — same asymptotic cost.
- `/rpiv-setup` runs 4× more `pi install` invocations (5 instead of 1) on fresh installs, each ~120s timeout (existing). Sequential by design (matches current code at `index.ts:231-249`).
- No hot-path code changes. Tool execute paths unchanged.

## Migration Notes

- **Existing rpiv-pi@0.3.0 users upgrading to the split release**:
  1. `pi install npm:rpiv-pi` (pulls the new version with extracted modules removed).
  2. First session_start emits an aggregated warning listing four missing rpiv-* siblings.
  3. User runs `/rpiv-setup`, which `pi install`s the four new plugins.
  4. User restarts pi.
  5. `todo` tool-call history in existing sessions replays correctly under rpiv-todo (tool name preserved; `reconstructTodoState` filter still matches).
  6. Saved `~/.config/rpiv-pi/advisor.json` is silently orphaned — user notices advisor OFF and reruns `/advisor`.
  7. Saved `~/.config/rpiv-pi/web-tools.json` is silently orphaned — first `web_search` call throws an actionable error; user reruns `/web-search-config`.
- **Rollback strategy**: downgrade `pi install npm:rpiv-pi@0.3.0` (pre-extraction version). Existing config files at old paths still present. Subagents (if on disk) continue to function. The four new sibling plugins remain installed but harmless — they register their own tools independently.
- **No schema migrations**: tool parameter schemas, `AgentToolResult.details` envelopes, and config-file JSON shapes are all unchanged. Only paths change.

## Pattern References

- `extensions/web-tools/index.ts:1-496` — the existing pattern for a self-contained Pi extension package (single `default export(pi)`, own config path, own slash command). All four new plugins model on this shape.
- `thoughts/shared/plans/2026-04-11_14-43-28_advisor-strategy-pattern.md` — blueprint for self-contained tool plugin (cited in research).
- `commit e4e03ab` — "Add advisor tool and /advisor command to rpiv-core" — closest precedent for adding a self-contained tool plugin.
- `commit be0a014` — "Strip advisor tool from active tools when disabled" — template for `before_agent_start` active-tool mutation under cross-plugin load ordering.
- `commit 8610ae5` — "Refactor rpiv-core extension into focused modules" — carved the `registerXxxTool(pi)` API surface that extraction lifts wholesale.
- `commit 33550c5` — "Add CC-parity todo tool and persistent overlay widget" — precedent for moving tool + overlay + `/todos` + replay hooks as one atomic unit.
- `commit a01a4a3` — "Initial rpiv-pi package" — established the `/rpiv-setup` + `readInstalledPackages` + session_start warning pattern now being extended to N=5.

## Developer Context

**Q (research checkpoint, Q1, `research.md:258-259`): Which of three architecture shapes — full decomposition / thin orchestrator / core-runtime + leaf plugins — should the design recommend?**
A: Full decomposition (3 independent plugins, extended to 4 in this design). Each plugin owns its own session_start/hook set.

**Q (research checkpoint, Q2, `research.md:261-262`): What should rpiv-advisor do with `~/.config/rpiv-pi/advisor.json`?**
A: Hard cutover to `~/.config/rpiv-advisor/advisor.json`. Users lose saved advisor-model config on upgrade — silent because `advisor.ts:139` early-returns when `modelKey` falsy.

**Q (research checkpoint, Q3, `research.md:264-265`): How should the research doc handle subagent inheritance of extracted plugins?**
A: Non-issue — `agents/*.md` have zero references to extracted tool names; agents delegate via skills. Dependency expressed via `peerDependencies` + runtime `session_start` check + `/rpiv-setup` hard-fail.

**Q (design checkpoint — permissions seeder ownership, `extensions/rpiv-core/permissions.ts:39-55`): Who owns the fragment-merge permissions seeder?**
A: None — drop the seeder entirely. Pi runs YOLO by default ([Zechner blog post](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)); `pi-permission-system` is a user choice whose policy file they already own. `@tintinweb/pi-subagents` ships with zero pi-permission-system coupling (precedent). Delete `permissions.ts`, `templates/pi-permissions.jsonc`, and the session_start call site. Each extracted plugin's README documents its tool name for users who independently install a permission extension.

**Q (design checkpoint — advisor config migration messaging, `extensions/rpiv-core/advisor.ts:55, 139`): Should rpiv-advisor emit a one-time migration notice if it detects the old file?**
A: Silent cutover, no notice. Matches research's stated default.

**Q (design checkpoint — package naming): Scoped or unscoped npm names?**
A: Unscoped `rpiv-*`. Matches rpiv-pi's current unscoped name. No npm org setup. Short install commands.

**Q (design checkpoint — add web-tools to extraction?): User requested adding `extensions/web-tools/` to the extraction as a 4th plugin.**
A: Yes, extract as `rpiv-web-tools`. Structurally simpler than advisor (no lifecycle hooks beyond tool/command registration). Silent hard cutover of config path from `~/.config/rpiv-pi/web-tools.json` to `~/.config/rpiv-web-tools/config.json`. `BRAVE_SEARCH_API_KEY` env var unchanged.

## Design History

- Slice 1: rpiv-ask-user-question plugin — approved with revision: README drops pi-permission-system section per developer feedback; D3 tightened to "zero mention in plugin READMEs"; flat package structure locked for slices 2-4
- Slice 2: rpiv-advisor plugin — approved as generated (one-line ADVISOR_CONFIG_PATH edit applied)
- Slice 3: rpiv-todo plugin — approved as generated
- Slice 4: rpiv-web-tools plugin — approved as generated (one-line CONFIG_PATH edit applied)
- Slice 5: rpiv-pi orchestrator cleanup — approved as generated (6 DELETE files + 1 DELETE dir; full rewrite of package-checks.ts, index.ts, package.json, README.md; version bump 0.3.0 → 0.4.0)

## References

- Research source: `thoughts/shared/research/2026-04-13_16-11-41_extract-rpiv-core-tools-into-prerequisite-plugins.md`
- Questions artifact: `thoughts/shared/questions/2026-04-13_15-33-01_extract-rpiv-core-tools-into-prerequisite-plugins.md`
- Related research — advisor persistence: `thoughts/shared/research/2026-04-11_17-27-55_advisor-strategy-pattern.md`
- Related research — subagent inheritance: `thoughts/shared/research/2026-04-11_07-16-31_pi-subagents-alt-library.md`
- Related research — todo propagation: `thoughts/shared/research/2026-04-13_08-51-45_todo-propagation-subagents.md`
- Prior design — advisor settings persistence: `thoughts/shared/designs/2026-04-12_12-21-43_advisor-settings-persistence.md`
- Prior design — todo CC parity: `thoughts/shared/designs/2026-04-10_22-34-39_todo-tool-cc-parity.md`
- Prior plan — todo overlay: `thoughts/shared/plans/2026-04-11_07-38-04_todo-list-overlay-above-input.md`
- Pi YOLO default: [Zechner blog](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)
- Pi extension model: [pi-mono packages.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md)
- Pi extensions docs: [pi-mono extensions.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- pi-permission-system repo: [MasuRii/pi-permission-system](https://github.com/MasuRii/pi-permission-system)
- pi-subagents repo: [tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents)
