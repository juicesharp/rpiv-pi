import { existsSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
function getSessionDir(sessionId) {
    const dataDir = process.env.CLAUDE_PLUGIN_DATA;
    if (!dataDir)
        throw new Error('CLAUDE_PLUGIN_DATA not set');
    return join(dataDir, 'sessions', sessionId);
}
/**
 * Hash a guidance relative path to a safe filename.
 * e.g., ".rpiv/guidance/src/core/architecture.md" -> "a1b2c3d4e5f6g7h8.marker"
 */
function markerName(relativePath) {
    return createHash('sha256').update(relativePath).digest('hex').slice(0, 16) + '.marker';
}
/**
 * Check if a guidance file has already been injected in this session.
 * Uses existsSync on a marker file — atomic, no read-modify-write.
 */
export function isInjected(sessionId, relativePath) {
    return existsSync(join(getSessionDir(sessionId), markerName(relativePath)));
}
/**
 * Mark a guidance file as injected. Creates a marker file.
 * If two processes race to create the same marker, both succeed — no conflict.
 */
export function markInjected(sessionId, relativePath) {
    const dir = getSessionDir(sessionId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, markerName(relativePath)), relativePath);
}
/**
 * Initialize a session directory with metadata.
 */
export function initSession(sessionId, projectDir) {
    const dir = getSessionDir(sessionId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '_meta.json'), JSON.stringify({
        session_id: sessionId,
        started_at: new Date().toISOString(),
        project_dir: projectDir,
    }, null, 2) + '\n');
}
/**
 * Clear all injection markers for a session (e.g., after compaction).
 * Preserves _meta.json so the session directory remains valid.
 */
export function clearMarkers(sessionId) {
    const dir = getSessionDir(sessionId);
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
        if (entry.endsWith('.marker')) {
            try { rmSync(join(dir, entry)); } catch { /* already gone */ }
        }
    }
}
/**
 * Delete session directory and all markers.
 */
export function deleteSession(sessionId) {
    try {
        rmSync(getSessionDir(sessionId), { recursive: true, force: true });
    }
    catch {
        // Already gone
    }
}
/**
 * Prune stale session directories older than maxAgeMs.
 */
export function pruneStaleSessionsSync(maxAgeMs = 24 * 60 * 60 * 1000) {
    const dataDir = process.env.CLAUDE_PLUGIN_DATA;
    if (!dataDir)
        return;
    const sessionsDir = join(dataDir, 'sessions');
    let entries;
    try {
        entries = readdirSync(sessionsDir);
    }
    catch {
        return;
    }
    const now = Date.now();
    for (const entry of entries) {
        const entryPath = join(sessionsDir, entry);
        try {
            const stat = statSync(entryPath);
            if (stat.isDirectory() && now - stat.mtimeMs > maxAgeMs) {
                rmSync(entryPath, { recursive: true, force: true });
            }
        }
        catch {
            // Skip entries we can't stat
        }
    }
}
