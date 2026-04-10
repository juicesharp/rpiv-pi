```markdown
# [Layer/Component Name]

## Responsibility
[1-2 sentences: what this layer does, where it sits in architecture]

## Dependencies
[List only architectural dependencies — frameworks and libraries that shape how you write code in this layer.
Do NOT list utility libraries discoverable from package.json/imports (e.g., lodash, moment, xlsx).
A dependency is worth listing if it imposes patterns, constraints, or conventions on the code.]
- **[dep]**: Why it's used

## Consumers
- **[consumer]**: How it uses this layer

## Module Structure
[Compact directory tree — aim for 4-7 top-level entries, not 15.
Group related files on one line (e.g., "Service.ts, Handler.ts").
Use architectural annotations for directories (e.g., "# One repo per entity", "# Domain schemas").
DO NOT enumerate individual files inside directories — describe the convention.
When a layer has many directories (10+), group related concerns on one line
(e.g., "guards/, interceptors/, pipes/ — infrastructure plumbing") rather than listing each separately.
The structure must stay valid when non-architectural files are added.]

## [Pattern Name] ([Key Constraint or Characterization])
[Each distinct pattern gets its own H2 section — NOT a generic "## Key Patterns" umbrella.
Include a fenced code block with an idiomatic, generalized example showing:
- Constructor / dependencies
- Key method signatures and return types
- Error handling / wrapping conventions
- Inline comments for important conventions (e.g., "// throws on error — service wraps in Result")
If a pattern spans a layer boundary, show both sides briefly.
Multiple patterns = multiple H2 sections.]

## [Additional Pattern Name]
[Second pattern with code block if applicable]

## Architectural Boundaries
- **NO [X]**: [Why]
- **NO [Y]**: [Why]

<important if="you are adding a new [entity type] to this layer">
## Adding a New [Entity Type]
[Step-by-step checklist inferred from existing code:
1. Create file following naming convention
2. Extend/implement base class or interface
3. Register in factory/container/index
4. Add related artifacts (schema, test, migration)]
</important>

<important if="you are writing or modifying tests for this layer">
## Testing Conventions
[Test patterns, helpers, fixture locations, mocking approach — if detectable from code]
</important>
```

Conditional sections are OPTIONAL — only include them if the pattern-finder skill detects testable patterns or clear "add new entity" workflows. Conditions must be narrow and action-specific. These sections contain checklists/recipes, not code examples (those stay in the unconditional pattern sections). Conditional sections do NOT count toward the 100-line budget for unconditional content.
