---
name: research-codebase
description: Conduct comprehensive codebase research by spawning parallel skills with integration scanning and developer checkpoint. Produces structured research documents in thoughts/shared/research/. Use when you need to understand how something works or explore before making changes. Replaces the scope + research-codebase two-step workflow.
argument-hint: [research question or task/ticket description]
---

## Research Question

If the user has not already provided a specific research question or task description, ask them for it before proceeding. Their input will appear as a follow-up paragraph after this skill body.

# Research Codebase

You are tasked with conducting comprehensive research across the codebase to answer user questions by invoking parallel skills and synthesizing their findings.

## Initial Setup:

When this command is invoked, respond with:
```
I'm ready to research the codebase. Please provide your research question or area of interest, and I'll analyze it thoroughly by exploring relevant components and connections.
```

Then wait for the user's research query.

## Steps to follow after receiving the research query:

1. **Read any directly mentioned files first:**
   - If the user mentions specific files (tickets, docs, JSON), read them FULLY first
   - **IMPORTANT**: Use the Read tool WITHOUT limit/offset parameters to read entire files
   - **CRITICAL**: Read these files yourself in the main context before spawning any skills
   - This ensures you have full context before decomposing the research

2. **Analyze and decompose the research question:**
   - Break down the user's query into composable research areas
   - Take time to ultrathink about the underlying patterns, connections, and architectural implications the user might be seeking
   - Identify specific components, patterns, or concepts to investigate
   - Consider which directories, files, or architectural patterns are relevant

3. **Spawn parallel agents for comprehensive research:**
   - Spawn multiple agents to research different aspects concurrently using the Agent tool
   **For codebase research:**
   - Use the **codebase-locator** agent to find WHERE files and components live
   - Use the **codebase-analyzer** agent to understand HOW specific code works
   - Use the **codebase-pattern-finder** agent if you need examples of similar implementations
   - Use the **integration-scanner** agent to find what CONNECTS to the affected area — inbound references, outbound dependencies, DI registrations, event subscriptions, config wiring. Always spawn this agent when researching a component that will be modified or extended.

   **For thoughts directory:**
   - Use the **thoughts-locator** agent to discover what documents exist about the topic
   - Use the **thoughts-analyzer** agent to extract key insights from specific documents

   **For change precedents (when research will feed into a plan):**
   - Use the **precedent-locator** agent to find WHAT WENT WRONG in similar past changes — commits, blast radius, follow-up fixes, and lessons from related thoughts/ docs. Spawn this when the research topic involves adding, modifying, or refactoring a component.

   **For web research (only if user explicitly asks):**
   - Use the **web-search-researcher** agent for external documentation and resources
   - IF you use web-research agents, instruct them to return LINKS with their findings, and please INCLUDE those links in your final report

   The key is to use these agents intelligently:
   - Start with locator agents to find what exists
   - Then use analyzer agents on the most promising findings
   - Always include integration-scanner when the research involves a component that will be changed
   - All agents inherit the session model by default
   - Run multiple agents in parallel when they're searching for different things
   - Each agent works in isolation — provide complete context in the prompt
   - Don't write detailed prompts about HOW to search - just tell it what you're looking for

4. **Process and validate findings:**

   4.1. **Synthesize agent results:**
   - IMPORTANT: Wait for ALL agent invocations to complete before proceeding
   - Compile all agent results (both codebase and thoughts findings)
   - Prioritize live codebase findings as primary source of truth
   - Use thoughts/ findings as supplementary historical context
   - Connect findings across different components
   - Include integration-scanner results: organize into inbound refs, outbound deps, and infrastructure wiring
   - Include precedent-locator results: organize into precedents found, composite lessons, and specific warnings for the planner
   - Include specific file paths and line numbers for reference
   - Build Code References from codebase-locator results — these are jump-table entries for the planner, not narrative (file:startLine-endLine format)
   - Verify all thoughts/ paths are correct (e.g., thoughts/me/ not thoughts/shared/ for personal files)
   - Highlight patterns, connections, and architectural decisions
   - Answer the user's specific questions with concrete evidence
   - **Do NOT write the research document yet** — proceed to developer checkpoint first (Step 4.2)

   4.2. **Developer checkpoint — ask grounded questions, then present summary:**

   Start with grounded questions — one at a time, waiting for the developer's answer before asking the next. Ask as many as the findings warrant — one per significant ambiguity or decision point. Use a **❓ Question:** prefix so the developer knows their input is needed. Each question must reference real findings with file:line evidence and pull NEW information from the developer — not confirm what you already found:

   Example grounded questions:
   - "I traced the data flow through `src/events/orders.ts:45` and found 3 event hooks. What else hooks into this chain that I should know about?"
   - "Found 3 candidate templates: CreateProduct (12 tests, full CRUD), GetUser (8 tests, read-only), AuditLog (5 tests, write-only) — which best matches what you're building, and why?"
   - "Integration scanner found no background job registration for this area. Is that expected, or is there async processing I'm not seeing?"

   **CRITICAL**: Ask ONE question at a time. Wait for the answer before asking the next. Lead with your most significant finding — do NOT ask the developer to pick an area or present a menu of options. They will redirect you if needed.

   **Choosing question format:**

   - **ask_user_question tool** — when your question has 2-4 concrete options from code analysis (pattern conflicts, integration choices, scope boundaries, priority overrides). The user can always pick "Other" for free-text. Example: use `ask_user_question` with question "Found 2 mapping approaches — which should new code follow?", header "Pattern", options "Manual mapping (Recommended)" (Used in OrderService (src/services/OrderService.ts:45) — 8 occurrences); "AutoMapper" (Used in UserService (src/services/UserService.ts:12) — 2 occurrences).

   - **Free-text with ❓ Question: prefix** — when the question is open-ended and options can't be predicted (discovery, "what am I missing?", corrections). Example:
     "❓ Question: Integration scanner found no background job registration for this area. Is that expected, or is there async processing I'm not seeing?"

   **Batching**: When you have 2-4 independent questions (answers don't depend on each other), you MAY batch them in a single `ask_user_question` call. Keep dependent questions sequential.

   After all grounded questions, present the compiled scan. Keep it under 30 lines — one line per layer, no sub-bullets. The full detail goes in the research document.

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

   Wait for the developer's response before proceeding to Step 4.3.

   4.3. **Incorporate developer input:**

   Classify each response:

   **Corrections** (e.g., "skip the job scheduler", "use CreateProduct not GetUser"):
   - Incorporate directly into synthesis. Record in Developer Context.

   **New areas** (e.g., "you missed the events module", "check the notification pipeline"):
   - Spawn targeted rescan: **codebase-locator** + **codebase-analyzer** on the new area (max 2 agents).
   - Merge results into synthesis. Record in Developer Context.

   **Decisions** (e.g., "yes, hook into that event chain", "no, leave that as-is"):
   - Record in Developer Context. Remove corresponding item from Open Questions.

   **Scope/focus** (e.g., "focus on API layer, UI is out of scope"):
   - Record in Developer Context.

   After incorporating all input, proceed to Step 5.

5. **Determine metadata and filename:**
   - Filename format: `thoughts/shared/research/YYYY-MM-DD_HH-MM-SS_topic.md`
     - YYYY-MM-DD_HH-MM-SS: Current date and time (e.g., 2025-10-11_14-30-22)
     - topic: Brief kebab-case description of the research topic
   - Repository name: from git root basename, or current directory basename if not a git repo
   - Determine branch and commit by running `git branch --show-current` and `git rev-parse --short HEAD`
   - Researcher: Use "Claude Code"
   - If metadata unavailable: use "unknown" for commit/branch

6. **Generate research document:**
   - This document is compressed context for a new session — include everything the planner needs to make architectural decisions without re-researching
   - Use the metadata gathered in step 5
   - Structure the document with YAML frontmatter followed by content:
     ```markdown
     ---
     date: [Current date and time with timezone in ISO format]
     researcher: [Researcher name from step 5]
     git_commit: [Current commit hash]
     branch: [Current branch name]
     repository: [Repository name]
     topic: "[User's Question/Topic]"
     tags: [research, codebase, relevant-component-names]
     status: complete
     last_updated: [Current date in YYYY-MM-DD format]
     last_updated_by: [Researcher name]
     ---

     # Research: [User's Question/Topic]

     ## Research Question
     [Original user query]

     ## Summary
     [High-level findings answering the user's question]

     ## Detailed Findings

     ### [Component/Area 1]
     - Finding with reference ([file.ext:line](link))
     - Connection to other components
     - Implementation details

     ### [Component/Area 2]
     ...

     ## Code References
     - `path/to/file.py:123` - Description of what's there
     - `another/file.ts:45-67` - Description of the code block

     ## Integration Points
     [From integration-scanner: what connects to the affected area]

     ### Inbound References
     - `path/to/consumer.ext:line` - [What references the component and how]

     ### Outbound Dependencies
     - `path/to/dependency.ext:line` - [What the component depends on]

     ### Infrastructure Wiring
     - `path/to/config.ext:line` - [DI, routes, events, jobs, middleware]

     ## Architecture Insights
     [Patterns, conventions, and design decisions discovered]

     ## Precedents & Lessons
     [N] similar past changes analyzed. Key commits: `hash` (description), `hash` (description).

     - [Composite lesson 1 — with relevant `commit hash` inline where planner would want to git show]
     - [Composite lesson 2 — with relevant `commit hash` inline]
     - [Composite lesson 3]

     ## Historical Context (from thoughts/)
     [Relevant insights from thoughts/ directory with references]
     - `thoughts/shared/something.md` - Historical decision about X
     - `thoughts/local/notes.md` - Past exploration of Y
     ## Developer Context
     [Record each checkpoint question you asked and the developer's answer as a Q&A pair. Include corrections, decisions, scope, and focus/skip areas.]

     ## Related Research
     [Links to other research documents in thoughts/shared/research/]

     ## Open Questions
     [Only questions NOT resolved during the checkpoint. Answered questions belong in Developer Context.]
     ```

7. **Present findings:**
   - Present a concise summary of findings to the user
   - Include key file references for easy navigation
   - Ask if they have follow-up questions or need clarification

8. **Handle follow-up questions:**
   - If the user has follow-up questions, append to the same research document
   - Update the frontmatter fields `last_updated` and `last_updated_by` to reflect the update
   - Add `last_updated_note: "Added follow-up research for [brief description]"` to frontmatter
   - Add a new section: `## Follow-up Research [timestamp]`
   - Spawn new agents as needed for additional investigation
   - Continue updating the document and syncing

## Important notes:
- Always run fresh codebase research — never rely solely on existing documents
- Research documents should be self-contained with all necessary context
- Focus on concrete file paths and line numbers for developer reference
- Encourage agents to find examples and usage patterns, not just definitions
- Explore all of thoughts/ directory, not just research subdirectory
- Link to GitHub when possible for permanent references
- CC auto-loads CLAUDE.md files when agents read files in a directory — no need to scan for them explicitly
- Never skip the developer checkpoint — developer input is the highest-value signal in the pipeline
- Answered questions belong in Developer Context, not Open Questions
- **File reading**: Always read mentioned files FULLY (no limit/offset) before invoking skills
- **Critical ordering**: Follow the numbered steps exactly
  - ALWAYS read mentioned files first before invoking skills (step 1)
  - ALWAYS wait for all agents to complete before synthesizing (step 4)
  - ALWAYS gather metadata before writing the document (step 5 before step 6)
  - NEVER write the research document with placeholder values
- **Frontmatter consistency**:
  - Always include frontmatter at the beginning of research documents
  - Keep frontmatter fields consistent across all research documents
  - Update frontmatter when adding follow-up research
  - Use snake_case for multi-word field names (e.g., `last_updated`, `git_commit`)
  - Tags should be relevant to the research topic and components studied
