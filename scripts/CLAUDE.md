# scripts/

## Responsibility
Two distinct roles: (1) `migrate.js` — the CLI tool that migrates CLAUDE.md files to the `.rpiv/guidance/` shadow tree format, actively invoked by the `migrate-to-guidance` skill. (2) `handlers/` — Claude Code lifecycle hook scripts for injecting `.rpiv/guidance/` files as context, serving as an alternate delivery path for Claude Code environments (not yet well battle-tested).

## Dependencies
Node.js built-ins only — `fs`, `path`, `crypto`, `child_process`. Zero npm dependencies.

## Consumers
- **`migrate-to-guidance` skill**: runs `node scripts/migrate.js --project-dir "${CWD}"` directly
- **Claude Code hooks configuration**: `handlers/*.js` are designed to be wired as `PreToolUse` / `PostCompact` / session hooks — not currently wired in this repo

## Module Structure
```
migrate.js            — Standalone CLI: discovers CLAUDE.md files, maps to .rpiv/guidance/ targets, writes output
lib/
  stdin.js            — readStdin(): buffers and JSON-parses Claude Code hook event payloads
  resolver.js         — resolveGuidance(): walks ancestry collecting .rpiv/guidance/**/*.md, root-first order
  session-state.js    — Filesystem marker store for per-session injection deduplication
handlers/
  inject-guidance.js  — PreToolUse: resolves and injects guidance files via stdout JSON response
  post-compact.js     — PostCompact: clears injection markers after context compaction
  session-start.js, session-end.js  — Init / cleanup session directory + prune stale sessions
```

## Hook Handler Entry Point

```js
import { readStdin } from '../lib/stdin.js';

async function main() {
    const input = await readStdin();                    // always the first line
    if (input.hook_event_name !== 'PreToolUse') return; // event guard before any work

    const filePath = input.tool_input.file_path ?? input.tool_input.path;
    if (!filePath) return;

    // ... work using input.session_id, input.cwd ...

    // Protocol response to Claude Code — no console.log, no trailing newline
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { additionalContext: "…" } }));
    process.stderr.write('[rpiv:debug] injected 2 files\n');  // diagnostics always to stderr
}

main().catch((err) => {
    process.stderr.write(`[rpiv] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(0);   // always exit 0 — hook errors must never kill Claude Code
});
```

## Guidance Resolution (`resolver.js`)

Walks from project root to the file's directory, collecting `.rpiv/guidance/**/*.md` in root-first order (general → specific). Returns `[]` if the file is outside the project root — no path traversal.

```js
resolveGuidance(filePath, projectDir)
// → [{ relativePath, absolutePath, content }, …]  root-first, deduped by caller via session-state.js
```

## Architectural Boundaries
- **stdout = protocol, stderr = diagnostics** — never mix; `process.stdout.write` carries only JSON, no newline; all log lines go to stderr with `[rpiv:tag]` prefix
- **exit 0 on all errors** — handlers never block Claude Code; every catch block exits 0
- **migrate.js writes all-or-nothing** — collects all target paths before writing; deletes originals only after all writes succeed

<important if="you are adding a new Claude Code hook handler">
## Adding a New Hook Handler
1. Create `scripts/handlers/<event-slug>.js`
2. Import `readStdin` from `'../lib/stdin.js'`; add lib imports as needed
3. `async function main()` — first line is always `const input = await readStdin()`
4. Add `if (input.hook_event_name !== 'YourEvent') return;` immediately after
5. Use `process.stdout.write(JSON.stringify(output))` for protocol responses; `process.stderr.write('[rpiv:tag] …\n')` for diagnostics
6. Close with: `main().catch((err) => { process.stderr.write(`[rpiv] ${…}\n`); process.exit(0); })`
7. Register the script path in Claude Code hooks configuration
</important>

<important if="you are adding a new standalone CLI script to this layer">
## Adding a CLI Utility Script
1. Create `scripts/my-name.js`; write a `parseArgs(argv)` function for manual `argv` parsing (no third-party parser)
2. Use `// --- Section Name ---` comment dividers between logical phases
3. Write a `function main()` (sync) or `async function main()` (if async I/O needed)
4. Progress output: `process.stderr.write('[rpiv:my-name] …\n')`
5. Final machine-readable result: `process.stdout.write(JSON.stringify(report, null, 2))` — pretty-printed; all report fields always present, no optional keys
6. Call `main()` at the bottom; add `.catch` only for async main
</important>
