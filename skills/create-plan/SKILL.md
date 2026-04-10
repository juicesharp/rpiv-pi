---
name: create-plan
description: Create detailed implementation plans through interactive collaboration. Produces phased plans with success criteria in thoughts/shared/plans/. Use when planning complex features or changes.
argument-hint: [task description or file path]
---

## Git Context
- Branch: !`git branch --show-current 2>/dev/null || echo "no-branch (not a git repo)"`
- Commit: !`git rev-parse --short HEAD 2>/dev/null || echo "no-commit (not a git repo)"`

## Task Input
$ARGUMENTS

# Implementation Plan

You are tasked with creating detailed implementation plans through an interactive, iterative process. You should be skeptical, thorough, and work collaboratively with the user to produce high-quality technical specifications.

## Initial Response

When this command is invoked:

1. **Check if parameters were provided**:
   - If a file path or ticket reference was provided as a parameter, skip the default message
   - Immediately read any provided files FULLY
   - Begin the research process

2. **If no parameters provided**, respond with:
```
I'll help you create a detailed implementation plan. Let me start by understanding what we're building.

Please provide:
1. The task/ticket description (or reference to a ticket file)
2. Any relevant context, constraints, or specific requirements
3. Links to related research or previous implementations

I'll analyze this information and work with you to create a comprehensive plan.

Tip: You can also invoke this command with a ticket file directly: `/rpiv-next:create-plan thoughts/me/tickets/eng_1234.md`
For deeper analysis, try: `/rpiv-next:create-plan think deeply about thoughts/me/tickets/eng_1234.md`
```

Then wait for the user's input.

## Process Steps

### Step 1: Context Gathering & Initial Analysis

1. **Read all mentioned files immediately and FULLY**:
   - Ticket files (e.g., `thoughts/me/tickets/eng_1234.md`)
   - Research documents
   - Related implementation plans
   - Any JSON/data files mentioned
   - **IMPORTANT**: Use the Read tool WITHOUT limit/offset parameters to read entire files
   - **CRITICAL**: DO NOT spawn agents before reading these files yourself in the main context
   - **NEVER** read files partially - if a file is mentioned, read it completely

2. **Spawn initial research agents to gather context**:
   Before asking the user any questions, use the Agent tool to spawn parallel research agents:

   - Use the **rpiv-next:codebase-locator** agent to find all files related to the ticket/task
   - Use the **rpiv-next:codebase-analyzer** agent to understand how the current implementation works
   - Use the **rpiv-next:integration-scanner** agent to find what CONNECTS to the affected area — inbound references, outbound dependencies, DI registrations, event subscriptions, config wiring. Always spawn this agent when planning changes to an existing component.
   - If relevant, use the **rpiv-next:thoughts-locator** agent to find any existing thoughts documents about this feature
   - Use the **rpiv-next:precedent-locator** agent to find similar past changes — what commits introduced comparable features, what broke, and what lessons apply to this plan

   These agents will:
   - Find relevant source files, configs, and tests
   - Identify the specific directories to focus on (e.g., if a specific module is mentioned, they'll focus on that module's directory)
   - Map integration points and dependencies (inbound refs, outbound deps, infrastructure wiring)
   - Trace data flow and key functions
   - Return detailed explanations with file:line references

3. **Read all files identified by research agents**:
   - After research agents complete, read ALL files they identified as relevant
   - Read them FULLY into the main context
   - This ensures you have complete understanding before proceeding

4. **Analyze and verify understanding**:
   - Cross-reference the ticket requirements with actual code
   - Identify any discrepancies or misunderstandings
   - Note assumptions that need verification
   - Determine true scope based on codebase reality

5. **Present informed understanding and focused questions**:
   ```
   Based on the ticket and my research of the codebase, I understand we need to [accurate summary].

   I've found that:
   - [Current implementation detail with file:line reference]
   - [Relevant pattern or constraint discovered]
   - [Potential complexity or edge case identified]

   Questions that my research couldn't answer:
   - [Specific technical question that requires human judgment]
   - [Business logic clarification]
   - [Design preference that affects implementation]
   ```

   Only ask questions that you genuinely cannot answer through code investigation.

### Step 2: Research & Discovery

After getting initial clarifications:

1. **If the user corrects any misunderstanding**:
   - DO NOT just accept the correction
   - Spawn new research agents to verify the correct information
   - Read the specific files/directories they mention
   - Only proceed once you've verified the facts yourself

2. **Create a research task list** using TaskCreate to track exploration tasks

3. **Spawn parallel agents for comprehensive research**:
   - Spawn multiple agents to research different aspects concurrently using the Agent tool
   **For deeper investigation:**
   - Use the **rpiv-next:codebase-locator** agent to find more specific files (e.g., "find all files that handle [specific component]")
   - Use the **rpiv-next:codebase-analyzer** agent to understand implementation details (e.g., "analyze how [system] works")
   - Use the **rpiv-next:codebase-pattern-finder** agent to find similar features we can model after
   - Use the **rpiv-next:integration-scanner** agent to find what connects to the affected area (inbound refs, outbound deps, DI, events, config wiring)

   **For historical context:**
   - Use the **rpiv-next:thoughts-locator** agent to find any research, plans, or decisions in thoughts/ about this area
   - Use the **rpiv-next:thoughts-analyzer** agent to extract key insights from the most relevant documents

   Each agent will:
   - Find the right files and code patterns
   - Identify conventions and patterns to follow
   - Look for integration points and dependencies
   - Return specific file:line references
   - Find tests and examples

3. **Wait for ALL agents to complete** before proceeding

4. **Present findings and design options**:
   ```
   Based on my research, here's what I found:

   **Current State:**
   - [Key discovery about existing code]
   - [Pattern or convention to follow]

   **Design Options:**
   1. [Option A] - [pros/cons]
   2. [Option B] - [pros/cons]

   **Open Questions:**
   - [Technical uncertainty]
   - [Design decision needed]

   Which approach aligns best with your vision?
   ```

   When presenting design options, use **AskUserQuestion** if you have 2-4 concrete options:

   ```
   questions:
     - question: "[Summary]. Which approach?"
       header: "Approach"
       multiSelect: false
       options:
         - label: "[Option A name] (Recommended)"
           description: "[One-line pro/con summary]"
         - label: "[Option B name]"
           description: "[One-line pro/con summary]"
   ```

### Step 3: Plan Structure Development

Once aligned on approach:

1. **Create initial plan outline**:
   ```
   Here's my proposed plan structure:

   ## Overview
   [1-2 sentence summary]

   ## Implementation Phases:
   1. [Phase name] - [what it accomplishes]
   2. [Phase name] - [what it accomplishes]
   3. [Phase name] - [what it accomplishes]

   Does this phasing make sense? Should I adjust the order or granularity?
   ```

   Use **AskUserQuestion** to confirm the phase structure:

   ```
   questions:
     - question: "[N] phases. Does this structure work?"
       header: "Phases"
       multiSelect: false
       options:
         - label: "Proceed (Recommended)"
           description: "Write the detailed implementation plan"
         - label: "Adjust phases"
           description: "Split, merge, or reorder phases before writing"
         - label: "Change scope"
           description: "Add or remove items from the plan"
   ```

2. **Get feedback on structure** before writing details

### Step 4: Detailed Plan Writing

After structure approval:

1. **Write the plan** to `thoughts/shared/plans/YYYY-MM-DD_HH-MM-SS_description.md`
   - Format: `YYYY-MM-DD_HH-MM-SS_description.md` where:
     - YYYY-MM-DD is today's date
     - HH-MM-SS is the current time in 24-hour format
     - description is a brief kebab-case description (may include ticket number)
   - Examples:
     - With ticket: `2025-01-08_14-30-00_ENG-1478-parent-child-tracking.md`
     - Without ticket: `2025-01-08_14-30-00_improve-error-handling.md`

2. **Use this template structure**:

```markdown
---
date: [Current date and time with timezone in ISO format]
planner: Claude Code
git_commit: [Current commit hash]
branch: [Current branch name]
repository: [Repository name]
topic: "[Feature/Task Name]"
tags: [plan, relevant-component-names]
status: draft
last_updated: [Current date in YYYY-MM-DD format]
last_updated_by: Claude Code
---

# [Feature/Task Name] Implementation Plan

## Overview

[Brief description of what we're implementing and why]

## Current State Analysis

[What exists now, what's missing, key constraints discovered]

## Desired End State

[A Specification of the desired end state after this plan is complete, and how to verify it]

### Key Discoveries:
- [Important finding with file:line reference]
- [Pattern to follow]
- [Constraint to work within]

## What We're NOT Doing

[Explicitly list out-of-scope items to prevent scope creep]

## Implementation Approach

[High-level strategy and reasoning]

## Phase 1: [Descriptive Name]

### Overview
[What this phase accomplishes]

### Changes Required:

#### 1. [Component/File Group]
**File**: `path/to/file.ext`
**Changes**: [Summary of changes]

```[language]
// Specific code to add/modify
```

### Success Criteria:

#### Automated Verification:
- [ ] Migration applies cleanly: `make migrate`
- [ ] Unit tests pass: `make test-component`
- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `make lint`
- [ ] Integration tests pass: `make test-integration`

#### Manual Verification:
- [ ] Feature works as expected when tested via UI
- [ ] Performance is acceptable under load
- [ ] Edge case handling verified manually
- [ ] No regressions in related features

---

## Phase 2: [Descriptive Name]

[Similar structure with both automated and manual success criteria...]

---

## Testing Strategy

### Unit Tests:
- [What to test]
- [Key edge cases]

### Integration Tests:
- [End-to-end scenarios]

### Manual Testing Steps:
1. [Specific step to verify feature]
2. [Another verification step]
3. [Edge case to test manually]

## Performance Considerations

[Any performance implications or optimizations needed]

## Migration Notes

[If applicable, how to handle existing data/systems]

## References

- Original ticket: `thoughts/me/tickets/eng_XXXX.md`
- Related research: `thoughts/shared/research/[relevant].md`
- Similar implementation: `[file:line]`
```

### Step 5: Review

1. **Present the draft plan location**:
   ```
   I've created the initial implementation plan at:
   `thoughts/shared/plans/[filename].md`

   Please review it and let me know:
   - Are the phases properly scoped?
   - Are the success criteria specific enough?
   - Any technical details that need adjustment?
   - Missing edge cases or considerations?
   ```

2. **Iterate based on feedback** - be ready to:
   - Add missing phases
   - Adjust technical approach
   - Clarify success criteria (both automated and manual)
   - Add/remove scope items

3. **Continue refining** until the user is satisfied

## Important Guidelines

1. **Be Skeptical**:
   - Question vague requirements
   - Identify potential issues early
   - Ask "why" and "what about"
   - Don't assume - verify with code

2. **Be Interactive**:
   - Don't write the full plan in one shot
   - Get buy-in at each major step
   - Allow course corrections
   - Work collaboratively

3. **Be Thorough**:
   - Read all context files COMPLETELY before planning
   - Research actual code patterns using parallel skills
   - Include specific file paths and line numbers
   - Write measurable success criteria with clear automated vs manual distinction
   - automated steps should use `make` whenever possible - for example `make -C <module> check` instead of `cd <module> && bun run fmt`

4. **Be Practical**:
   - Focus on incremental, testable changes
   - Consider migration and rollback
   - Think about edge cases
   - Include "what we're NOT doing"

5. **Track Progress**:
   - Use TaskCreate/TaskUpdate to track planning tasks
   - Update todos as you complete research
   - Mark planning tasks complete when done

6. **No Open Questions in Final Plan**:
   - If you encounter open questions during planning, STOP
   - Research or ask for clarification immediately
   - Do NOT write the plan with unresolved questions
   - The implementation plan must be complete and actionable
   - Every decision must be made before finalizing the plan

## Success Criteria Guidelines

**Always separate success criteria into two categories:**

1. **Automated Verification** (can be run by execution agents):
   - Commands that can be run: `make test`, `npm run lint`, etc.
   - Specific files that should exist
   - Code compilation/type checking
   - Automated test suites

2. **Manual Verification** (requires human testing):
   - UI/UX functionality
   - Performance under real conditions
   - Edge cases that are hard to automate
   - User acceptance criteria

**Format example:**
```markdown
### Success Criteria:

#### Automated Verification:
- [ ] Database migration runs successfully: `make migrate`
- [ ] All unit tests pass: `go test ./...`
- [ ] No linting errors: `golangci-lint run`
- [ ] API endpoint returns 200: `curl localhost:8080/api/new-endpoint`

#### Manual Verification:
- [ ] New feature appears correctly in the UI
- [ ] Performance is acceptable with 1000+ items
- [ ] Error messages are user-friendly
- [ ] Feature works correctly on mobile devices
```

## Common Patterns

### For Database Changes:
- Start with schema/migration
- Add store methods
- Update business logic
- Expose via API
- Update clients

### For New Features:
- Research existing patterns first
- Start with data model
- Build backend logic
- Add API endpoints
- Implement UI last

### For Refactoring:
- Document current behavior
- Plan incremental changes
- Maintain backwards compatibility
- Include migration strategy

## Agent Invocation Best Practices

When spawning research agents:

1. **Spawn multiple agents in parallel** for efficiency using the Agent tool
2. **Each agent should be focused** on a specific area
3. **Provide detailed instructions** including:
   - Exactly what to search for
   - Which directories to focus on
   - What information to extract
   - Expected output format
4. **Be EXTREMELY specific about directories**:
   - If the ticket mentions a specific module, specify that module's directory explicitly
   - Never use generic terms when a specific directory name exists
   - Include the full path context in your prompts
5. **Use named agents** — `rpiv-next:codebase-locator`, `rpiv-next:codebase-analyzer`, `rpiv-next:codebase-pattern-finder`, `rpiv-next:thoughts-locator`, `rpiv-next:thoughts-analyzer`, `rpiv-next:web-search-researcher`
6. **Request specific file:line references** in responses
7. **Wait for all agents to complete** before synthesizing
8. **Verify agent results**:
   - If an agent returns unexpected results, spawn follow-up agents
   - Cross-check findings against the actual codebase
   - Don't accept results that seem incorrect

Example of spawning multiple agents:

To spawn multiple agents concurrently, use multiple Agent tool calls in a single response:

1. Agent (rpiv-next:codebase-locator): "Find all database-related files in [directory]..."
2. Agent (rpiv-next:codebase-analyzer): "Analyze the API request handling in [directory]..."
3. Agent (rpiv-next:integration-scanner): "Find what connects to the order processing module in [directory]..."
4. Agent (rpiv-next:codebase-pattern-finder): "Find UI component patterns in [directory]..."
5. Agent (rpiv-next:thoughts-locator): "Find test-related research and plans in thoughts/..."

Each agent runs in an isolated context and returns its findings independently.

## Example Interaction Flow

```
User: /rpiv-next:create-plan
Assistant: I'll help you create a detailed implementation plan...

User: We need to add parent-child tracking for Claude sub-tasks. See thoughts/me/tickets/eng_1478.md
Assistant: Let me read that ticket file completely first...

[Reads file fully]

Based on the ticket, I understand we need to [summary of the task]. Before I start planning, I have some questions...

[Interactive process continues...]
```
