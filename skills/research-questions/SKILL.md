---
name: research-questions
description: Generate trace-quality research questions from codebase discovery. Spawns discovery agents and reads key files for depth, then synthesizes into dense question paragraphs for the research skill. Produces question artifacts in thoughts/shared/questions/. Use as Phase 1 of the two-phase research pipeline.
argument-hint: [research question or task/ticket description]
---

## Git Context
- Branch: !`git branch --show-current 2>/dev/null || echo "no-branch (not a git repo)"`
- Commit: !`git rev-parse --short HEAD 2>/dev/null || echo "no-commit (not a git repo)"`

## Research Topic
$ARGUMENTS

# Research Questions

You are tasked with generating trace-quality research questions by running discovery agents, reading key files for depth, and synthesizing findings into dense question paragraphs. The questions artifact feeds directly into the `research` skill, which dispatches agents to answer each question.

## Initial Setup

When this command is invoked, respond with:
```
I'll discover the relevant codebase context and generate targeted research questions.
Please provide your research question or area of interest.
```

Then wait for the user's research query.

## Steps

### Step 1: Read Mentioned Files

- If the user mentions specific files (tickets, docs, JSON), read them FULLY first
- **IMPORTANT**: Use the Read tool WITHOUT limit/offset parameters
- **CRITICAL**: Read these files in the main context before spawning agents
- Extract requirements, constraints, and goals from the input

### Step 2: Decompose and Spawn Discovery Agents

1. **Analyze the research question:**
   - Break down the user's query into composable discovery areas
   - Identify specific components, patterns, or concepts to locate
   - Create a research plan using TaskCreate

2. **Spawn parallel discovery agents** using the Agent tool:

   - Use **rpiv-next:codebase-locator** — spawn one per decomposed area from Step 1. If the research decomposes into 3 areas, spawn 3 locators, each searching exhaustively within its area. A single broad locator misses files; multiple focused locators provide complete coverage.
   - Use **rpiv-next:thoughts-locator** to find existing docs, decisions, and plans about the topic
   - Use **rpiv-next:integration-scanner** to map connections — inbound refs, outbound deps, config/DI/event wiring

   Agent prompts should instruct locators to capture **function names, class/type names, and import paths** alongside file paths — not just locations. Example:
   - codebase-locator: "Find ALL files that [implement/call/emit/subscribe to/import] [specific component]. For each file, report the key function signatures, exported types, and import chains. Search exhaustively — grep for method names, class names, event strings."
   - integration-scanner: "What connects to [area] — inbound refs, outbound deps, config/DI/event wiring. For each connection, report the function/method that creates it."
   - thoughts-locator: "What existing docs/decisions exist about [topic]"

   Each agent works in isolation — provide complete context in the prompt, including specific directory paths when the target is known.

3. **Wait for ALL agents to complete** before proceeding.

### Step 3: Read Key Files for Depth

After discovery agents return, the orchestrator reads key files to gain the structural understanding needed for trace-quality questions.

1. **Compile all file references** from agent results into a single list.

2. **Rank and select 5-10 key files** using these priorities:
   - Files referenced by 2+ agents (cross-cutting, highest priority)
   - Entry points and main implementation files
   - Type definition / interface files (often short, high value)
   - Config, wiring, and registration files (from integration-scanner)

3. **Read each file** into main context using the Read tool:
   - Files under 300 lines: read FULLY (no limit/offset)
   - Files over 300 lines: read the first 150 lines to capture exports, function signatures, and type definitions
   - Cap at 10 files to avoid context bloat

4. **Build a mental model** of the code paths — understand how data flows from entry points through processing layers to outputs, which functions call which, and where the key types are defined and consumed.

### Step 4: Synthesize Discovery into Questions

Using the combined knowledge of WHERE files are (locators), WHAT connects to what (integration-scanner), and HOW the key files work (file reads), synthesize 5-10 dense research questions.

1. **Generate research questions as dense paragraphs.**

   Each question must be a **3-6 sentence paragraph** that:
   - Traces a complete code path through multiple files/layers
   - Names EVERY intermediate file, function, and type along the path
   - Explains WHY this trace matters for the research topic
   - Is completely self-contained — an agent receiving only this paragraph has enough context to begin work

   **Example questions** (adapt to the actual codebase):

   > Trace how a new user registration flows end-to-end — from the `POST /api/users` route handler in `src/routes/users.ts`, through the `UserService.createUser()` method in `src/services/UserService.ts`, the `UserRepository.save()` call in `src/repositories/UserRepository.ts`, the `User` entity definition in `src/entities/User.ts`, and the `user_created` event emission in `src/events/userEvents.ts`. Show the validation pipeline at each layer and how errors propagate back to the HTTP response.

   > Explain how the plugin system discovers, loads, and initializes extensions — from the `PluginRegistry.scan()` method in `src/plugins/registry.ts` that reads `plugins/` directory entries, through the `PluginManifest` interface in `src/plugins/types.ts`, the `PluginLoader.instantiate()` factory in `src/plugins/loader.ts`, and the lifecycle hooks (`onInit`, `onReady`, `onShutdown`) defined in `src/plugins/lifecycle.ts`. This matters because adding new extension points requires understanding the full initialization order and hook contract.

2. **thoughts/ docs are NOT questions** — thoughts-locator findings provide historical context. They should be mentioned in the Discovery Summary, not turned into questions that ask an agent to summarize a document.

3. **Aim for 5-10 questions** — enough to cover the research topic thoroughly, few enough that each gets focused analysis.

4. **Coverage check**: Every key file read in Step 3 should appear in at least one question. Files that were read but don't appear in any question indicate either an unnecessary read or a missing question.

### Step 5: Developer Checkpoint

Present the generated questions to the developer for review.

1. **Present the questions:**

   ```
   ## Research Questions for: [Topic]

   Based on discovery across [N] files and reading [K] key files for depth:

   1. [First sentence of question, truncated to ~100 chars]...
   2. [First sentence of question, truncated to ~100 chars]...
   ...

   <full question text for each, numbered to match>
   ```

2. **Ask for review** using AskUserQuestion:

   ```
   questions:
     - question: "[N] trace-quality research questions generated from discovery across [M] files. Review and adjust?"
       header: "Questions"
       multiSelect: false
       options:
         - label: "Looks good (Recommended)"
           description: "Proceed to write the questions artifact as-is"
         - label: "I want to adjust"
           description: "Add, remove, or modify questions before proceeding"
   ```

3. **Handle developer input:**

   **"Looks good"**: Proceed to Step 6.

   **"I want to adjust"**: Ask follow-up:
   - Question: Which questions would you like to add, remove, or modify?
   - Incorporate changes. If the developer mentions a new area, spawn a targeted rescan (max 2 agents: codebase-locator + integration-scanner on the new area) and read any newly discovered key files.
   - Re-present the updated questions list and confirm again.

   **"Other" (free-text)**: Parse as corrections/additions. Incorporate and re-present if significant changes.

### Step 6: Write Questions Artifact

1. **Determine metadata:**
   - Filename: `thoughts/shared/questions/YYYY-MM-DD_HH-MM-SS_[topic].md`
     - YYYY-MM-DD_HH-MM-SS: Current date and time
     - topic: Brief kebab-case description
   - Repository name: from git root basename, or current directory basename if not a git repo
   - Use the git branch and commit from the "Git Context" section above
   - Researcher: "Claude Code"
   - If metadata unavailable: use "unknown" for commit/branch

2. **Write the artifact** using this template:

   ```markdown
   ---
   date: [Current date and time with timezone in ISO format]
   researcher: Claude Code
   git_commit: [Current commit hash]
   branch: [Current branch name]
   repository: [Repository name]
   topic: "[User's research topic]"
   tags: [research-questions, relevant-component-names]
   status: complete
   last_updated: [Current date in YYYY-MM-DD format]
   last_updated_by: Claude Code
   ---

   # Research Questions: [Topic]

   ## Discovery Summary
   [3-5 sentences: what discovery agents found, which key files were read for depth, the overall shape of the codebase area being researched]

   ## Questions

   1. [Dense 3-6 sentence paragraph. Traces a code path naming specific files, functions, and types at each step. Explains why this matters for the research topic.]

   2. [Dense 3-6 sentence paragraph...]

   ...
   ```

### Step 7: Present and Chain

Present the artifact location and chain to the next skill:

```
Research questions written to:
`thoughts/shared/questions/[filename].md`

[N] trace-quality questions generated from [M] discovery findings across [K] files.

When ready, run `/rpiv-next:research thoughts/shared/questions/[filename].md` to answer these questions.
```

### Step 8: Handle Follow-ups

- If the developer asks to add/modify questions, use the Edit tool to update the artifact in-place
- Update frontmatter: `last_updated` and `last_updated_by`
- Add `last_updated_note: "Updated [brief description]"` to frontmatter
- If new areas are mentioned, spawn targeted discovery agents (max 2) and read any newly discovered key files

## Important Notes

- **Depth through reading**: After discovery agents return, always read 5-10 key files in main context. This structural understanding is what makes trace-quality questions possible — locators find WHERE, file reads reveal HOW.
- **Question density**: Each question must name specific files, functions, and types — not generic titles. If a question doesn't reference at least 3 specific code artifacts (files, functions, types), it's too thin.
- **File reading**: Always read mentioned files FULLY (no limit/offset) before spawning agents
- **Critical ordering**: Follow the numbered steps exactly
  - ALWAYS read mentioned files first (Step 1)
  - ALWAYS wait for all agents to complete (Step 2)
  - ALWAYS read key files for depth before writing questions (Step 3)
  - ALWAYS present questions to developer before writing (Step 5)
  - NEVER write the artifact with placeholder values
- **Frontmatter consistency**: Always include frontmatter, use snake_case for multi-word fields, keep tags relevant
- CC auto-loads CLAUDE.md files when agents read files in a directory — no need to scan for them explicitly
