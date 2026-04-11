import { existsSync, readFileSync } from 'fs';
import { join, dirname, relative, sep, isAbsolute } from 'path';
/**
 * Resolve architecture.md guidance files for a given file path.
 * Walks from the file's directory up to project root, checking
 * .rpiv/guidance/{dir}/architecture.md at each level.
 *
 * Returns files ordered root-first (general → specific).
 */
export function resolveGuidance(filePath, projectDir) {
    const fileDir = dirname(filePath);
    const relativeDir = relative(projectDir, fileDir);
    // Guard: file is outside project root — no guidance to resolve
    if (relativeDir.startsWith('..') || isAbsolute(relativeDir)) {
        return [];
    }
    const parts = relativeDir ? relativeDir.split(sep) : [];
    const results = [];
    // Check from root (0 parts) to deepest (all parts)
    for (let depth = 0; depth <= parts.length; depth++) {
        const subPath = parts.slice(0, depth).join(sep);
        const guidanceRelative = subPath
            ? join('.rpiv', 'guidance', subPath, 'architecture.md')
            : join('.rpiv', 'guidance', 'architecture.md');
        const guidanceAbsolute = join(projectDir, guidanceRelative);
        if (existsSync(guidanceAbsolute)) {
            results.push({
                relativePath: guidanceRelative.split(sep).join('/'),
                absolutePath: guidanceAbsolute,
                content: readFileSync(guidanceAbsolute, 'utf-8'),
            });
        }
    }
    return results;
}
