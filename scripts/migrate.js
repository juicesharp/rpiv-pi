import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative, sep } from 'path';
import { execSync } from 'child_process';
// --- CLI Argument Parsing ---
function parseArgs(argv) {
    let projectDir = process.cwd();
    let deleteOriginals = false;
    let dryRun = false;
    let force = false;
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === '--project-dir' && argv[i + 1]) {
            projectDir = argv[++i];
        }
        else if (argv[i] === '--delete-originals') {
            deleteOriginals = true;
        }
        else if (argv[i] === '--dry-run') {
            dryRun = true;
        }
        else if (argv[i] === '--force') {
            force = true;
        }
    }
    return { projectDir, deleteOriginals, dryRun, force };
}
// --- Discovery ---
const HARDCODED_EXCLUDES = new Set([
    'node_modules', 'dist', 'build', '.git', 'vendor', '.rpiv',
    '.next', '.nuxt', '.output', 'coverage', '__pycache__', '.venv',
]);
function discoverClaudeMdFiles(projectDir) {
    const gitDir = join(projectDir, '.git');
    if (existsSync(gitDir)) {
        return discoverViaGit(projectDir);
    }
    return discoverViaWalk(projectDir);
}
function discoverViaGit(projectDir) {
    try {
        const output = execSync('git ls-files --cached --others --exclude-standard', {
            cwd: projectDir,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
        });
        return output
            .split('\n')
            .filter((f) => f.endsWith('/CLAUDE.md') || f === 'CLAUDE.md')
            .filter((f) => !f.startsWith('.rpiv/'));
    }
    catch {
        // git command failed — fall back to walk
        return discoverViaWalk(projectDir);
    }
}
function discoverViaWalk(projectDir) {
    const results = [];
    function walk(dir) {
        let entries;
        try {
            entries = readdirSync(dir);
        }
        catch {
            return; // permission error, skip
        }
        for (const entry of entries) {
            if (HARDCODED_EXCLUDES.has(entry))
                continue;
            const fullPath = join(dir, entry);
            let stat;
            try {
                stat = statSync(fullPath);
            }
            catch {
                continue;
            }
            if (stat.isDirectory()) {
                walk(fullPath);
            }
            else if (entry === 'CLAUDE.md') {
                const rel = relative(projectDir, fullPath).split(sep).join('/');
                if (!rel.startsWith('.rpiv/')) {
                    results.push(rel);
                }
            }
        }
    }
    walk(projectDir);
    return results;
}
// --- Path Mapping ---
function computeTargetPath(claudeMdRelative) {
    const dir = dirname(claudeMdRelative);
    if (dir === '.') {
        return '.rpiv/guidance/architecture.md';
    }
    return join('.rpiv', 'guidance', dir, 'architecture.md').split(sep).join('/');
}
function transformContent(content, targetPath) {
    let refsTransformed = 0;
    const warnings = [];
    // Pattern 1: Backtick-wrapped path references like `src/core/CLAUDE.md`
    let transformed = content.replace(/`((?:[\w][\w./-]*\/)?CLAUDE\.md)`/g, (_match, claudePath) => {
        const replacement = claudePathToGuidancePath(claudePath);
        refsTransformed++;
        return '`' + replacement + '`';
    });
    // Pattern 2: Bare path references (with directory prefix) not inside backticks
    // Match things like "src/core/CLAUDE.md" but not already-backtick-wrapped
    transformed = transformed.replace(/(?<!`)([\w][\w./-]*\/CLAUDE\.md)(?!`)/g, (_match, claudePath) => {
        const replacement = claudePathToGuidancePath(claudePath);
        refsTransformed++;
        return replacement;
    });
    // Pattern 3: Standalone "CLAUDE.md" that references the root file
    // Only match when it looks like a file reference (not part of a longer word)
    // Avoid matching inside paths already transformed above
    transformed = transformed.replace(/(?<![/\w`])CLAUDE\.md(?![/\w`])/g, () => {
        refsTransformed++;
        return '.rpiv/guidance/architecture.md';
    });
    // Scan for remaining prose references that might need manual attention
    const lines = transformed.split('\n');
    for (let i = 0; i < lines.length; i++) {
        // Look for prose patterns like "see X CLAUDE.md" or "X layer CLAUDE.md"
        if (/\b\w+\s+CLAUDE\.md\b/i.test(content.split('\n')[i] ?? '') &&
            !/(src|lib|app|packages|apps)\//.test(content.split('\n')[i] ?? '')) {
            // Check if this line still has an untransformed prose reference
            if (/CLAUDE\.md/i.test(lines[i])) {
                warnings.push({
                    file: targetPath,
                    line: i + 1,
                    message: `Prose reference to CLAUDE.md may need manual update: "${lines[i].trim()}"`,
                });
            }
        }
    }
    return { content: transformed, refsTransformed, warnings };
}
function claudePathToGuidancePath(claudePath) {
    const dir = dirname(claudePath);
    if (dir === '.') {
        return '.rpiv/guidance/architecture.md';
    }
    return '.rpiv/guidance/' + dir + '/architecture.md';
}
// --- Main ---
function main() {
    const { projectDir, deleteOriginals, dryRun, force } = parseArgs(process.argv);
    process.stderr.write(`[rpiv:migrate] scanning ${projectDir} for CLAUDE.md files\n`);
    const claudeFiles = discoverClaudeMdFiles(projectDir);
    if (claudeFiles.length === 0) {
        const report = {
            migrated: [],
            conflicts: [],
            warnings: [],
            originalsDeleted: false,
            dryRun,
        };
        process.stdout.write(JSON.stringify(report, null, 2));
        return;
    }
    process.stderr.write(`[rpiv:migrate] found ${claudeFiles.length} CLAUDE.md file(s)\n`);
    const migrated = [];
    const conflicts = [];
    const allWarnings = [];
    const writtenFiles = [];
    for (const source of claudeFiles) {
        const target = computeTargetPath(source);
        const targetAbs = join(projectDir, target);
        // Check for conflicts
        if (existsSync(targetAbs) && !force) {
            conflicts.push(target);
            continue;
        }
        // Read source content
        const sourceAbs = join(projectDir, source);
        let content;
        try {
            content = readFileSync(sourceAbs, 'utf-8');
        }
        catch (err) {
            allWarnings.push({
                file: source,
                line: 0,
                message: `Failed to read: ${err instanceof Error ? err.message : String(err)}`,
            });
            continue;
        }
        if (content.trim().length === 0) {
            allWarnings.push({
                file: source,
                line: 0,
                message: 'Empty file, skipped',
            });
            continue;
        }
        // Transform content
        const { content: transformed, refsTransformed, warnings } = transformContent(content, target);
        const lines = transformed.split('\n').length;
        migrated.push({ source, target, lines, refsTransformed });
        allWarnings.push(...warnings);
        if (!dryRun) {
            writtenFiles.push({ targetAbs, content: transformed });
        }
    }
    // Write all files (all-or-nothing approach for safety)
    if (!dryRun) {
        for (const { targetAbs, content } of writtenFiles) {
            mkdirSync(dirname(targetAbs), { recursive: true });
            writeFileSync(targetAbs, content, 'utf-8');
        }
        process.stderr.write(`[rpiv:migrate] wrote ${writtenFiles.length} file(s)\n`);
    }
    // Delete originals only after all writes succeed
    let originalsDeleted = false;
    if (!dryRun && deleteOriginals && writtenFiles.length > 0) {
        for (const entry of migrated) {
            const sourceAbs = join(projectDir, entry.source);
            try {
                unlinkSync(sourceAbs);
            }
            catch (err) {
                allWarnings.push({
                    file: entry.source,
                    line: 0,
                    message: `Failed to delete original: ${err instanceof Error ? err.message : String(err)}`,
                });
            }
        }
        originalsDeleted = true;
        process.stderr.write(`[rpiv:migrate] deleted ${migrated.length} original CLAUDE.md file(s)\n`);
    }
    const report = {
        migrated,
        conflicts,
        warnings: allWarnings,
        originalsDeleted,
        dryRun,
    };
    process.stdout.write(JSON.stringify(report, null, 2));
}
main();
