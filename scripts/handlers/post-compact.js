import { readStdin } from '../lib/stdin.js';
import { clearMarkers } from '../lib/session-state.js';

async function main() {
    const input = await readStdin();
    if (input.hook_event_name !== 'PostCompact') return;

    clearMarkers(input.session_id);
    process.stderr.write(
        `[rpiv:debug] compaction detected — cleared injection markers for session ${input.session_id}\n`
    );
}

main().catch((err) => {
    process.stderr.write(`[rpiv] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(0);
});
