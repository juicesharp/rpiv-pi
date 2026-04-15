# skills/

## Responsibility
User-invocable AI workflow definitions. Each `SKILL.md` is a structured prompt injected as system context when a user runs `/skill:<name>`. Skills own the orchestration logic for multi-step workflows: research, design, planning, implementation, annotation, and test generation. No executable code — pure prompt engineering.

## Dependencies
- **Pi framework**: reads `"skills": ["./skills"]` from `package.json`; injects SKILL.md body as system context on invocation
- **Sibling plugins**: provide the tools skills call — `ask_user_question` (`@juicesharp/rpiv-ask-user-question`), `todo` (`@juicesharp/rpiv-todo`), `advisor` (`@juicesharp/rpiv-advisor`), `web_search`/`web_fetch` (`@juicesharp/rpiv-web-tools`), `Agent` (`@tintinweb/pi-subagents`)
- **`extensions/rpiv-core/`**: session-time scaffolding (`thoughts/` dirs), guidance injection, git-context injection, bundled-agent sync

## Consumers
- **Users**: `/skill:<name>` invokes the matching skill
- **Pipeline**: several skills require upstream artifacts — `research` requires `discover` output; `design` requires `research`; `plan` requires `design`; `implement` requires `plan`

## Module Structure
```
commit/, code-review/                         — Plain skills: SKILL.md only; no external files
research/, discover/, explore/
design/, plan/, revise/, implement/, validate/
create-handoff/, resume-handoff/, migrate-to-guidance/
annotate-guidance/, annotate-inline/          — SKILL.md + templates/ + examples/
outline-test-cases/, write-test-cases/        — SKILL.md + templates/ + examples/
```

## SKILL.md Frontmatter Schema

```yaml
---
name: my-skill            # kebab-case; matches folder name; maps to /skill:my-skill
description: "What it does. Use when [trigger]."
argument-hint: "[what the user passes]"
allowed-tools: Bash(git *), Read, Glob, Grep   # omit entirely to inherit all tools + Agent
# disable-model-invocation: true               # rare — implement, create-handoff only
---
```

`allowed-tools` is a security boundary. Omit when the skill needs the `Agent` tool — agent-orchestrating skills never declare `allowed-tools`.

## Skill Body Structure

```markdown
## Input Guard       ← BEFORE the H1 when an argument is required; instructs Claude to wait

# Skill Title        ← H1 after the guard

[Workflow map]       ← bulleted step summary for multi-step skills

## Step 1: Name
1. Guard clause / bail-out first
2. Call `ask_user_question` tool for developer checkpoints (never prose "ask the user"):
   Question: "…", Header: "…", Options: ["Option A (Recommended)", "Option B"]

## Step 2: Spawn Agents (parallel agents)      ← "(parallel agents)" tag in heading
- subagent_type: `codebase-analyzer`
- Prompt: "…"
Wait for ALL agents to complete before proceeding.  ← explicit sync barrier

## Important Notes   ← last section: ALWAYS/NEVER ordering rules and prohibitions
```

## templates/ and examples/ Purpose

Skills that produce **structured artifacts consumed by other skills or agents** ship a `templates/` subfolder. The template defines the exact frontmatter fields and section names that downstream agents grep for — it is the inter-skill contract. Skills read templates at runtime via the `Read` tool; they are not inlined in SKILL.md.

`examples/` provides few-shot reference outputs. SKILL.md cites each by relative path followed by a "What makes this example good" annotation block. Examples are also read at runtime via `Read`.

## Architectural Boundaries
- **NO tool logic in SKILL.md** — skills describe workflows; extensions provide tools
- **NO template content inlined** — when `templates/` exists, the skill reads it at runtime; never copy it inline
- **Pipeline skills declare their chain position** — in `description`: "Always requires a [upstream] artifact"

<important if="you are adding a new skill to this layer">
## Adding a New Skill
1. Create `skills/my-skill/SKILL.md` with frontmatter: `name`, `description`, `argument-hint`
2. Include `allowed-tools` only to restrict the tool set; omit to inherit everything (required for `Agent` tool)
3. If skill requires an argument: add an input guard block BEFORE the H1 title
4. If multi-step: add a workflow map after H1; use `## Step N:` headings
5. For parallel agent steps: append `(parallel agents)` to the heading; close with an explicit sync barrier line
6. Developer checkpoints: use `ask_user_question` tool for 2-4 concrete options; `❓ Question:` free-text prefix for open-ended — one question at a time, wait for answer before asking the next
7. Prohibitions and ordering rules go in `## Important Notes` as the final section
8. If the skill produces structured artifacts consumed downstream: create `templates/` subfolder; cite in SKILL.md as `Read the full template at templates/my-template.md`
9. If output quality benefits from examples: create `examples/` subfolder; cite with a "What makes this example good" annotation block
10. Pipeline skills: declare chain position in `description` and make the upstream artifact path the `argument-hint`
</important>
