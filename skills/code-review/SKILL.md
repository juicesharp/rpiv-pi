---
name: code-review
description: Conduct comprehensive code reviews by analyzing changes in parallel. Produces review documents in thoughts/shared/reviews/. Use when changes are ready for review.
argument-hint: [scope]
allowed-tools: Read, Bash(git *), Glob, Grep, Agent
---

# Code Review System

You are tasked with conducting comprehensive code reviews by invoking parallel skills to analyze changes and synthesize their findings into actionable feedback.

## Initial Setup:

When this command is invoked, respond with:
```
I'm ready to perform a code review. Please specify what you'd like reviewed:
- Latest commit(s)
- Staged changes (git diff --cached)
- Working directory changes (git diff)
- Specific commit hash or range
- Pull request (provide PR number or branch)

You can also specify focus areas or review depth.
```

Then wait for the user's review request.

## Steps to follow after receiving the review request:

1. **Read the changes to review:**
   - Determine what needs reviewing based on user input
   - Use appropriate git commands to get the diff:
     - Latest commit: `git diff HEAD~1 HEAD`
     - Staged: `git diff --cached`
     - Working: `git diff`
   - **IMPORTANT**: Read the full diff output FIRST before invoking any skills
   - Get list of changed files and understand the scope
   - Note commit messages for context

2. **Analyze and decompose the review:**
   - Break down the changes into reviewable areas
   - Take time to ultrathink about patterns, security implications, and architectural impacts
   - Identify which components are affected
   - Create a review plan using the `todo` tool to track all aspects
   - Consider which existing patterns and historical decisions are relevant

3. **Spawn parallel agents for comprehensive review:**
   - Plan first then spawn multiple agents to review different aspects concurrently using the Agent tool. Those MUST be run simultaneously to boost efficiency.
    **For codebase research:**
   - Use the **codebase-locator** agent to find WHERE files and components live
   - Use the **codebase-analyzer** agent to understand HOW specific code works
   - Use the **codebase-pattern-finder** agent if you need examples of similar implementations

   **For thoughts directory:**
   - Use the **thoughts-locator** agent to discover what documents exist about the topic
   - Use the **thoughts-analyzer** agent to extract key insights from specific documents

   **For web research (only if user explicitly asks):**
   - Use the **web-search-researcher** agent for external documentation and resources
   - IF you use web-research agents, instruct them to return LINKS with their findings, and please INCLUDE those links in your final report

   The key is to use these agents intelligently:
   1. Start with locator agents to understand scope and find context
   2. Then use analyzer agents on the most critical changes
   - Run multiple agents in parallel when reviewing different aspects
   - Each agent works in isolation — provide complete context in the prompt

4. **Wait for all agents to complete and synthesize findings:**
   - IMPORTANT: Wait for ALL agent invocations to complete before proceeding
   - Compile all findings from agents
   - Classify issues by severity:
     - 🔴 Critical: Security vulnerabilities, data loss, crashes
     - 🟡 Important: Bugs, performance issues, pattern violations
     - 🔵 Suggestions: Style improvements, minor optimizations
     - 💭 Discussion: Architecture decisions, trade-offs
   - Cross-reference patterns found by agents with actual changes
   - Check if historical decisions are being respected
   - Verify test coverage based on existing patterns

5. **Determine metadata and filename:**
   - Filename format: `thoughts/shared/reviews/YYYY-MM-DD_HH-MM-SS_[scope].md`
     - YYYY-MM-DD_HH-MM-SS: Current date and time (e.g., 2025-10-11_14-30-22)
     - [scope]: Brief kebab-case description of what was reviewed
   - Repository name: from git root basename, or current directory basename if not a git repo
   - Use the git branch and commit from the git context injected at the start of the session (or run `git branch --show-current` / `git rev-parse --short HEAD` directly); falls back to "no-branch" / "no-commit" if not a git repo
   - Reviewer: use the User from the git context injected at the start of the session (fallback: "unknown")
   - If metadata unavailable: use "unknown" for commit/branch

6. **Generate review document:**
   - Use the metadata gathered in step 5
   - Structure the document with YAML frontmatter followed by content:
     ```markdown
     ---
     date: [Current date and time with timezone]
     reviewer: [Reviewer name]
     repository: [Repository name]
     branch: [Current branch]
     commit: [Commit hash]
     review_type: [commit|pr|staged|working]
     scope: "[What was reviewed]"
     files_changed: [Number]
     critical_issues: [Count]
     important_issues: [Count]
     suggestions: [Count]
     status: [approved|needs_changes|requesting_changes]
     tags: [code-review, relevant-components]
     last_updated: [Current date in YYYY-MM-DD format]
     last_updated_by: [Reviewer name]
     ---

     # Code Review: [Scope Description]

     **Date**: [Current date and time]
     **Reviewer**: [Reviewer name]
     **Repository**: [Repository]
     **Branch**: [Branch name]
     **Commit**: [Commit hash]

     ## Review Summary
     [Overall assessment of the changes]

     ## Issues Found

     ### Critical Issues (Must Fix)
     [None | List of critical issues with file:line references and suggested fixes]

     ### Important Issues (Should Fix)
     [List of important issues with evidence from skills]

     ### Suggestions
     [Minor improvements and optimizations]

     ## Pattern Analysis
     [How changes align with existing patterns found by pattern-finder]

     ## Impact Assessment
     [Files and tests affected based on locator findings]

     ## Historical Context
     [Relevant decisions and past issues from thoughts/]

     ## Recommendation
     [Clear verdict: Approved / Needs Changes / Requesting Changes]
     ```

7. **Present findings:**
   - Present a concise summary to the user
   - Include the most critical issues first
   - Provide concrete examples from the codebase
   - Ask if they need clarification on any findings

8. **Handle follow-up questions:**
   - If the user has follow-up questions, append to the same review document
   - Update the frontmatter fields `last_updated` and `last_updated_by`
   - Add a new section: `## Follow-up [timestamp]`
   - Spawn new agents as needed for deeper investigation
   - Continue updating the document and syncing

## Important notes:
- Always use parallel Agent tool calls to maximize efficiency
- Always read the diff FULLY before spawning agents
- Focus on finding concrete issues with evidence from agents
- Review documents should be actionable with specific fixes
- Each agent prompt should be focused on specific analysis
- Consider patterns, security, performance, and maintainability
- Include historical context when relevant
- Keep the main agent focused on synthesis, not deep analysis
- Encourage agents to find examples and patterns, not make judgments
- **Critical ordering**: Follow the numbered steps exactly
  - ALWAYS read diff first before spawning agents (step 1)
  - ALWAYS wait for all agents to complete before synthesizing (step 4)
  - ALWAYS gather metadata before writing the document (step 5 before step 6)
- **Agent roles:**
  - **codebase-locator**: WHERE code lives (find files)
  - **codebase-analyzer**: HOW code works (implementation details)
  - **codebase-pattern-finder**: Examples of similar code
  - **thoughts-locator**: Find historical documentation
  - **thoughts-analyzer**: Extract insights from documents
  - **web-search-researcher**: External sources (sparingly)
- **Severity classification**:
  - Use evidence from agents to justify each issue's severity
  - Provide specific file:line references for all issues
  - Include examples of correct patterns when available
  - Suggest concrete fixes, not vague improvements
