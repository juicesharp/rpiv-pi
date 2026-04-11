---
name: research-solutions
description: Analyze solution options for features or changes. Compares approaches with pros/cons and provides recommendations. Produces documents in thoughts/shared/solutions/. Use when multiple valid approaches exist.
argument-hint: [feature/change description]
---

# Research Solutions

You are tasked with analyzing solution options for new features or changes by invoking parallel skills and synthesizing their findings into actionable recommendations optimized for design consumption.

## Initial Setup:

When this command is invoked, respond with:
```
I'm ready to research solution options. Please provide:
- What feature/change you want to explore
- Any requirements or constraints you know about
- Reference to relevant ticket or research documents if available

I'll analyze the current codebase, generate solution options, and provide recommendations.
```

Then wait for the user's request.

## Steps to follow after receiving the request:

1. **Read context files and understand the problem:**
   - If user mentions tickets, research docs, or other files, read them FULLY first
   - **IMPORTANT**: Use Read tool WITHOUT limit/offset parameters
   - **CRITICAL**: Read these files in main context before invoking skills
   - Extract requirements, constraints, and goals
   - Identify what problem we're solving

2. **Research current state and analyze requirements:**
   - **ALWAYS spawn fresh research** - Never rely on old research docs as truth
   - Old research can be read as historical context but validate against current code
   - Think deeply about requirements, constraints, and integration points

   **Spawn parallel research agents using the Agent tool:**
   - Use the **codebase-locator** agent to find relevant components
   - Use the **codebase-analyzer** agent to understand current implementation
   - Use the **codebase-pattern-finder** agent to find similar patterns
   - Use the **thoughts-locator** agent to find historical context in thoughts/
   - Optional: Use the **web-search-researcher** agent for web research only if user requests

3. **Generate and compare solution options:**
   - Wait for ALL agents to complete
   - Generate 2-4 viable approaches when possible
   - If only 1 clear option exists, explain why alternatives aren't viable
   - For each option, document:
     - How it works and precedent in codebase
     - Pros/cons with evidence
     - Complexity and integration points
     - Risk factors
   - Cross-reference agent findings
   - Compare options systematically

4. **Make recommendation:**
   - Choose best option based on requirements, codebase fit, and complexity
   - Provide clear rationale with evidence
   - Explain why alternatives were not chosen
   - Identify conditions that would change recommendation

5. **Determine metadata and filename:**
   - Filename format: `thoughts/shared/solutions/YYYY-MM-DD_HH-MM-SS_[topic].md`
     - YYYY-MM-DD_HH-MM-SS: Current date and time (e.g., 2025-10-11_14-30-22)
     - [topic]: Brief kebab-case description
   - Repository name: from git root basename, or current directory basename if not a git repo
   - Determine branch and commit by running `git branch --show-current` and `git rev-parse --short HEAD`
   - Researcher: Use "Claude Code"
   - If metadata unavailable: use "unknown" for commit/branch

6. **Generate solutions document:**
   - Use the metadata gathered in step 5
   - Structure the document with YAML frontmatter followed by content:
     ```markdown
     ---
     date: [Current date and time with timezone in ISO format]
     researcher: [Researcher name]
     git_commit: [Current commit hash]
     branch: [Current branch name]
     repository: [Repository name]
     topic: "[Feature/Problem]"
     confidence: high | medium | low
     complexity: low | medium | high
     status: ready | awaiting_input | blocked
     tags: [solutions, component-names]
     last_updated: [Current date in YYYY-MM-DD format]
     last_updated_by: [Researcher name]
     ---

     # Solution Analysis: [Feature/Problem]

     **Date**: [Current date and time with timezone from step 5]
     **Researcher**: [Researcher name from step 5]
     **Git Commit**: [Current commit hash from step 5]
     **Branch**: [Current branch name from step 5]
     **Repository**: [Repository name]

     ## Research Question
     [Original user query]

     ## Summary
     **Problem**: [What we're solving]
     **Recommended**: [Option name] - [One sentence why]
     **Effort**: [Low/Med/High] ([N days])
     **Confidence**: [High/Med/Low]

     ## Problem Statement

     **Requirements:**
     - [Requirement 1]
     - [Requirement 2]

     **Constraints:**
     - [Hard constraint - must respect]
     - [Soft constraint - should consider]

     **Success criteria:**
     - [What "done" looks like]

     ## Current State

     **Existing implementation:**
     [What exists with file:line references]

     **Relevant patterns:**
     - [Pattern 1]: `file.ext:line` - Used in [N] places
     - [Pattern 2]: `file.ext:line` - Used in [N] places

     **Integration points:**
     - `file.ext:line` - [Where feature hooks in]
     - `file.ext:line` - [Another integration point]

     ## Solution Options

     ### Option 1: [Name]
     **How it works:**
     [2-3 sentence description + implementation approach]

     **Pros:**
     - [Advantage with evidence from codebase]
     - [Advantage with evidence]

     **Cons:**
     - [Disadvantage with impact]

     **Complexity:** [Low/Med/High] (~[N] days)
     - Files to create: [N] (~[X] lines)
     - Files to modify: [N] (~[X] lines)
     - Risk level: [Low/Med/High]

     ### Option 2: [Alternative Name]
     [Same structure as Option 1]

     ### Option 3: [Another Alternative]
     [Same structure as Option 1]

     ## Comparison

     | Criteria | Option 1 | Option 2 | Option 3 |
     |----------|----------|----------|----------|
     | Complexity | [L/M/H] | [L/M/H] | [L/M/H] |
     | Codebase fit | [H/M/L] | [H/M/L] | [H/M/L] |
     | Risk | [L/M/H] | [L/M/H] | [L/M/H] |

     ## Recommendation

     **Selected:** [Option N]

     **Rationale:**
     - [Key reason with evidence]
     - [Key reason with evidence]
     - ...

     **Why not alternatives:**
     - Option X: [Reason]

     **Trade-offs:**
     - Accepting [limitation] for [benefit]

     **Implementation approach:**
     1. [Phase 1] - [What to build]
     2. ...

     **Integration points:**
     - `file.ext:line` - [Specific change]
     - `file.ext:line` - [Specific change]

     **Patterns to follow:**
     - [Pattern]: `file.ext:line`

     **Risks:**
     - [Risk]: [Mitigation]

     ## Scope Boundaries
     - [What we're building]
     - [What we're NOT doing]

     ## Testing Strategy

     **Unit tests:**
     - [Key test scenario 1]
     - ...

     **Integration tests:**
     - [End-to-end scenario 1]
     - ...

     **Manual verification:**
     - [ ] [Manual test 1]
     - [ ] ...

     ## Open Questions
     **Resolved during research:**
     - [Question that was answered] - [Answer with evidence from file:line]

     **Requires user input:**
     - [Business or design question] - [Default assumption for planning]

     **Blockers:**
     - [Critical unknown that prevents implementation] - [How to unblock]

     ## References

     - `thoughts/shared/research/[file].md` - [Context]
     - `src/file.ext:line` - [Similar implementation]
     - `thoughts/shared/[file].md` - [Historical decision]
     ```

7. **Present findings:**
   - Present concise summary with clear recommendation
   - Highlight key integration points
   - Ask if they want to proceed to /skill:design with the chosen option or need clarification

8. **Handle follow-up questions:**
   - If user has questions, append to same document
   - Update frontmatter: `last_updated` and `last_updated_by`
   - Add section: `## Follow-up Analysis [timestamp]`
   - Spawn additional agents as needed

## Important notes:
- Always use parallel Agent tool calls to maximize efficiency and minimize context usage
- Always spawn fresh research to validate current state - never rely on old research docs as source of truth
- Old research documents can provide historical context but must be validated against current code
- Focus on generating 2-4 viable solution options with specific file:line references
- Solutions documents should be self-contained with all necessary context
- Each agent prompt should be specific and focused on targeted research questions
- Quantify pattern precedent - count usage in codebase, don't just say "follows pattern"
- Ground complexity estimates in actual similar work from git history
- Think like a software architect - you're setting up design for success by landing on one chosen approach with evidence
- Keep the main agent focused on synthesis and comparison, not deep implementation details
- Encourage agents to find existing patterns and examples, not just describe possibilities
- Resolve technical unknowns during research - don't leave critical questions for design
- **File reading**: Always read mentioned files FULLY (no limit/offset) before invoking skills
- **Critical ordering**: Follow the numbered steps exactly
  - ALWAYS read mentioned files first before invoking skills (step 1)
  - ALWAYS spawn fresh research to validate current state (step 2)
  - ALWAYS wait for all agents to complete before synthesizing (step 3)
  - ALWAYS gather metadata before writing the document (step 5 before step 6)
  - NEVER write the solutions document with placeholder values
