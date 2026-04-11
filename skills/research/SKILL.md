---
name: research
description: Answer structured research questions via targeted parallel analysis agents. Consumes question artifacts from research-questions. Produces research documents in thoughts/shared/research/. Use as Phase 2 of the two-phase research pipeline — always requires a questions artifact.
argument-hint: [path to research-questions artifact]
---

## Questions Source

If the user has not already provided a specific research-questions artifact path, ask them for it before proceeding. Their input will appear as a follow-up paragraph after this skill body.

# Research

You are tasked with answering structured research questions by spawning targeted analysis agents and synthesizing their findings into a comprehensive research document. This skill consumes questions artifacts produced by the `research-questions` skill.

## Step 1: Read Questions Artifact

1. **Determine input:**

   **Questions artifact provided** (path to a `.md` file in `thoughts/`):
   - Read the questions artifact FULLY using the Read tool WITHOUT limit/offset
   - Extract: Discovery Summary, Questions (dense paragraphs), frontmatter metadata (topic, tags)
   - The Discovery Summary provides the file landscape overview — no need to re-discover

   **No arguments provided:**
   ```
   I'll answer research questions from a questions artifact. Please provide the path:
   `/skill:research thoughts/shared/questions/YYYY-MM-DD_HH-MM-SS_topic.md`

   This skill requires a questions artifact from research-questions.
   For standalone research, use research-codebase instead.
   ```
   Then wait for input.

2. **Read key shared files** referenced across multiple questions into main context — especially shared utilities, type definitions, and integration points that multiple questions mention.

3. **Analyze question overlap for grouping:**
   - Parse all question paragraphs and extract file references from each
   - Identify questions that share 2+ file references — these are candidates for grouping
   - Group related questions together (2-3 questions per group max)
   - Questions with no significant file overlap remain standalone
   - Target: 3-6 agent dispatches total (grouped + standalone)

4. **Report chained status:**
   ```
   [Chained]: Found research questions for "[topic]". [N] questions in [G] groups, [M] shared files.
   ```

## Step 2: Dispatch Analysis Agents

Spawn analysis agents using the Agent tool. All agents run in parallel.

**Default agent**: `codebase-analyzer` for all codebase questions. This agent has Read, Grep, Glob, LS — it can trace code paths, find patterns, and analyze integration points.

**Exception**: Questions that explicitly reference external documentation, web APIs, or third-party libraries → `web-search-researcher`.

**Agent prompt — question-as-prompt:**

Each agent receives the dense question paragraph(s) directly as its prompt. The question IS the instruction.

For standalone questions (no grouping):
```
Research topic: [topic from frontmatter]

Answer the following research question thoroughly with file:line references. Read the files mentioned, trace the code paths described, and provide a complete analysis.

[Full dense question paragraph]

Provide your analysis with exact file:line references. Focus on DEPTH — trace the actual code, don't just locate it.
```

For grouped questions:
```
Research topic: [topic from frontmatter]

Answer the following related research questions thoroughly with file:line references. These questions share overlapping code paths — use your cross-question context to provide deeper, more connected analysis.

Question 1: [Full dense question paragraph]

Question 2: [Full dense question paragraph]

For each question, provide your analysis with exact file:line references. Note connections between the questions where the same code serves multiple roles. Focus on DEPTH — trace the actual code, don't just locate it.
```

**Precedent sweep (always spawn):**
Spawn one `precedent-locator` agent alongside the question agents:
"Find similar past changes involving [list key files from Discovery Summary]. Search git log for commits that touched these files, similar commit messages, and follow-up fixes. Research topic: [original query]."

This agent runs with full knowledge of discovered files — its findings go into Precedents & Lessons, not tied to a specific question.

**Wait for ALL agents to complete** before proceeding.

## Step 3: Synthesize and Checkpoint

1. **Compile findings:**
   - Match each agent's response to the question(s) it answered
   - Cross-reference findings across questions — look for patterns, conflicts, and connections
   - Prioritize live codebase findings as primary source of truth
   - Use thoughts/ findings as supplementary historical context
   - Include specific file paths and line numbers
   - Build Code References as jump-table entries for the planner, not narrative (file:startLine-endLine format)
   - No multi-line code blocks (>3 lines) — use file:line refs + prose. No implementation recipes — facts only.
   - No artifact summaries — link plans/designs in Historical Context, don't summarize their contents. Research describes current codebase state.

2. **Developer checkpoint — grounded questions one at a time:**

   Start with grounded questions referencing real findings with file:line evidence. Ask ONE question at a time, waiting for the answer before the next. Use a **Question:** prefix. Each question must pull NEW information from the developer — not confirm what you already found:

   Every question MUST embed at least one `file:line` reference in the question text — not just in surrounding context. Examples:

   - "Question: `src/events/orders.ts:45-67` has 3 event hooks but no error recovery path. Is there a retry mechanism elsewhere I'm not seeing?"
   - "Question: Pattern-finder found manual mapping at `src/services/OrderService.ts:45` (8 uses) vs AutoMapper at `src/services/UserService.ts:12` (2 uses). Which should new code follow?"
   - "Question: Precedent commit `abc123` required a follow-up fix at `src/handlers/key.ts:158` for connection leak. Should we account for that pattern in this design?"

   Anti-patterns — NEVER ask these:
   - "Is this research to understand X or prepare for Y?" — confirmatory, pulls zero new information
   - "Does this look correct?" / "Should I continue?" — asks developer to validate YOUR work instead of providing NEW context
   - Questions without `file:line` — if you can't ground it in code, it's not a research question

   **Choosing question format:**

   - **ask_user_question tool** — when your question has 2-4 concrete options from analysis (pattern conflicts, integration choices, scope boundaries). The user can always pick "Other" for free-text.
   - **Free-text with Question: prefix** — when the question is open-ended and options can't be predicted.

   **Batching**: When you have 2-4 independent questions (answers don't depend on each other), you MAY batch them in a single `ask_user_question` call. Keep dependent questions sequential.

   **CRITICAL**: Ask ONE question at a time. Wait for the answer before asking the next. Lead with your most significant finding.

3. **Present compiled scan** (under 30 lines):
   ```
   Task: [one-line summary]
   Scope: [N files across M layers, K integration points]

   [Layer name] — [key files and what they do]
   [Layer name] — [key files and what they do]
   Integration — [N inbound, M outbound, K wiring. Top concern if any]
   History — [N relevant docs. Key insight if any]

   Best template: [implementation to model after]
   Precedents — [N similar changes found. Top lesson if any]
   Inconsistencies: [count] found ([short names])
   ```

   Wait for the developer's response before proceeding.

4. **Incorporate developer input:**

   Classify each response:

   **Corrections** (e.g., "skip the job scheduler", "use CreateProduct not GetUser"):
   - Incorporate directly into synthesis. Record in Developer Context.

   **New areas** (e.g., "you missed the events module"):
   - Spawn targeted rescan: **codebase-locator** + **codebase-analyzer** on the new area (max 2 agents).
   - Merge results into synthesis. Record in Developer Context.

   **Decisions** (e.g., "yes, hook into that event chain"):
   - Record in Developer Context. Remove corresponding item from Open Questions.

   **Scope/focus** (e.g., "focus on API layer, UI is out of scope"):
   - Record in Developer Context.

   After incorporating all input, proceed to Step 4.

## Step 4: Write Research Document

1. **Determine metadata:**
   - Filename: `thoughts/shared/research/YYYY-MM-DD_HH-MM-SS_[topic].md`
     - YYYY-MM-DD_HH-MM-SS: Current date and time
     - topic: Brief kebab-case description
   - Repository name: from git root basename, or current directory basename if not a git repo
   - Determine branch and commit by running `git branch --show-current` and `git rev-parse --short HEAD`
   - Researcher: "Claude Code"
   - If metadata unavailable: use "unknown" for commit/branch

2. **Write the research document** — this document is compressed context for a new session. Include everything the planner needs to make architectural decisions without re-researching:

   ```markdown
   ---
   date: [Current date and time with timezone in ISO format]
   researcher: Claude Code
   git_commit: [Current commit hash]
   branch: [Current branch name]
   repository: [Repository name]
   topic: "[User's Research Topic]"
   tags: [research, codebase, relevant-component-names]
   status: complete
   questions_source: "[path to questions artifact]"
   last_updated: [Current date in YYYY-MM-DD format]
   last_updated_by: Claude Code
   ---

   # Research: [User's Research Topic]

   ## Research Question
   [Original user query from questions artifact]

   ## Summary
   [High-level findings answering the user's question]

   ## Detailed Findings

   ### [Component/Area 1]
   - Finding with reference (`file.ext:line`)
   - Connection to other components
   - Implementation details

   ### [Component/Area 2]
   ...

   ## Code References
   - `path/to/file.py:123` — Description of what's there
   - `another/file.ts:45-67` — Description of the code block

   ## Integration Points
   [All connections to the researched area. Enumerate each consumer, dependency, and wiring point with file:line. Source from the questions artifact's Discovery Summary + new connections found by analysis agents.]

   ### Inbound References
   - `path/to/consumer.ext:line` — [What references the component and how]

   ### Outbound Dependencies
   - `path/to/dependency.ext:line` — [What the component depends on]

   ### Infrastructure Wiring
   - `path/to/config.ext:line` — [DI, routes, events, jobs, middleware]

   ## Architecture Insights
   [Patterns, conventions, and design decisions discovered]

   ## Precedents & Lessons
   [N] similar past changes analyzed. Key commits: `hash` (description).

   - [Composite lesson 1 — with relevant `commit hash` inline]
   - [Composite lesson 2]

   ## Historical Context (from thoughts/)
   [Links only — one line per doc, no summaries of their contents]
   - `thoughts/shared/something.md` — [one-line description of what this doc covers]
   ## Developer Context
   **Q (`file.ext:line`): [Question grounded in specific code reference]**
   A: [Developer's answer]

   ## Related Research
   - Questions source: `[path to questions artifact]`
   - [Links to other research documents]

   ## Open Questions
   [Only questions NOT resolved during checkpoint]
   ```

## Step 5: Present and Chain

```
Research document written to:
`thoughts/shared/research/[filename].md`

[N] questions answered, [M] findings across [K] files.

Please review and let me know if you have follow-up questions.

When ready:
- For complex features: `/skill:design-feature thoughts/shared/research/[filename].md`
- For complex multi-layer features (6+ files): `/skill:design-feature-iterative thoughts/shared/research/[filename].md`
- For straightforward changes: `/skill:create-plan thoughts/shared/research/[filename].md`
```

## Step 6: Handle Follow-ups

- If the user has follow-up questions, append to the same research document
- Update frontmatter: `last_updated` and `last_updated_by`
- Add `last_updated_note: "Added follow-up research for [brief description]"` to frontmatter
- Add section: `## Follow-up Research [timestamp]`
- Spawn new analysis agents as needed

## Important Notes

- **Analysis only**: This skill answers questions. It does NOT discover what to ask — that's research-questions' job.
- **Always chained**: This skill requires a questions artifact. For standalone research, use research-codebase.
- **Grouped dispatch**: Related questions are batched per agent based on file overlap. Default agent: codebase-analyzer. This reduces token waste from redundant file reads and lets agents build cross-question context.
- **Same output format**: Research documents match research-codebase output — downstream consumers (design-feature, create-plan) work unchanged.
- **File reading**: Always read the questions artifact FULLY (no limit/offset) before dispatching agents
- **Critical ordering**: Follow the numbered steps exactly
  - ALWAYS read the questions artifact first (Step 1)
  - ALWAYS analyze question overlap for grouping (Step 1)
  - ALWAYS wait for all agents to complete (Step 2)
  - ALWAYS run developer checkpoint before writing (Step 3)
  - ALWAYS gather metadata before writing (Step 4)
  - NEVER write the document with placeholder values
- **Frontmatter consistency**: Always include frontmatter, use snake_case fields, include `questions_source`
- CC auto-loads CLAUDE.md files when agents read files in a directory — no need to scan for them explicitly
