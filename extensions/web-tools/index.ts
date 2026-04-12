/**
 * rpiv-pi web-tools extension
 *
 * Provides `web_search` and `web_fetch` tools backed by the Brave Search API.
 * Based on the user-local reference implementation at
 * ~/.pi/agent/extensions/web-search/index.ts (Tavily/Serper backends stripped,
 * Brave kept as default).
 *
 * API key resolution precedence (first wins):
 *   1. BRAVE_SEARCH_API_KEY environment variable
 *   2. apiKey field in ~/.config/rpiv-pi/web-tools.json
 *
 * Use the /web-search-config slash command to set the key interactively.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
	type TruncationResult,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Config file persistence
// ---------------------------------------------------------------------------

interface WebToolsConfig {
	apiKey?: string;
}

const CONFIG_PATH = join(homedir(), ".config", "rpiv-pi", "web-tools.json");

function loadConfig(): WebToolsConfig {
	if (!existsSync(CONFIG_PATH)) return {};
	try {
		return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as WebToolsConfig;
	} catch {
		return {};
	}
}

function saveConfig(config: WebToolsConfig): void {
	mkdirSync(dirname(CONFIG_PATH), { recursive: true });
	writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
	try {
		chmodSync(CONFIG_PATH, 0o600);
	} catch {
		// chmod may fail on some filesystems — best effort only
	}
}

function resolveApiKey(): string | undefined {
	const envKey = process.env.BRAVE_SEARCH_API_KEY;
	if (envKey && envKey.trim()) return envKey.trim();
	const config = loadConfig();
	if (config.apiKey && config.apiKey.trim()) return config.apiKey.trim();
	return undefined;
}

// ---------------------------------------------------------------------------
// Brave Search API client
// ---------------------------------------------------------------------------

interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

interface SearchResponse {
	results: SearchResult[];
	query: string;
}

async function searchBrave(
	query: string,
	maxResults: number,
	signal?: AbortSignal,
): Promise<SearchResponse> {
	const apiKey = resolveApiKey();
	if (!apiKey) {
		throw new Error(
			"BRAVE_SEARCH_API_KEY is not set. Run /web-search-config to configure, or export the env var.",
		);
	}

	const url = new URL("https://api.search.brave.com/res/v1/web/search");
	url.searchParams.set("q", query);
	url.searchParams.set("count", String(maxResults));

	const res = await fetch(url.toString(), {
		method: "GET",
		headers: {
			Accept: "application/json",
			"Accept-Encoding": "gzip",
			"X-Subscription-Token": apiKey,
		},
		signal,
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Brave Search API error (${res.status}): ${text}`);
	}

	const data = (await res.json()) as {
		web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
	};
	const results: SearchResult[] = (data.web?.results ?? []).map((r) => ({
		title: r.title ?? "",
		url: r.url ?? "",
		snippet: r.description ?? "",
	}));

	return { results, query };
}

// ---------------------------------------------------------------------------
// HTML-to-text for web_fetch
// ---------------------------------------------------------------------------

function htmlToText(html: string): string {
	let text = html;
	text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
	text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
	text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
	text = text.replace(
		/<\/(p|div|h[1-6]|li|tr|br|blockquote|pre|section|article|header|footer|nav|details|summary)>/gi,
		"\n",
	);
	text = text.replace(/<br\s*\/?>/gi, "\n");
	text = text.replace(/<[^>]+>/g, " ");
	text = text.replace(/&amp;/g, "&");
	text = text.replace(/&lt;/g, "<");
	text = text.replace(/&gt;/g, ">");
	text = text.replace(/&quot;/g, '"');
	text = text.replace(/&#39;/g, "'");
	text = text.replace(/&nbsp;/g, " ");
	text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
	text = text.replace(/[ \t]+/g, " ");
	text = text.replace(/\n{3,}/g, "\n\n");
	return text.trim();
}

function extractTitle(html: string): string | undefined {
	const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	if (match) {
		return match[1].replace(/<[^>]+>/g, "").trim() || undefined;
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	// =========================================================================
	// web_search tool
	// =========================================================================

	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web for information via the Brave Search API. Returns a list of results with titles, URLs, and snippets. Use when you need current information not in your training data.",
		promptSnippet: "Search the web for up-to-date information via Brave",
		promptGuidelines: [
			"Use web_search for information beyond your training data — recent events, current library versions, live API documentation.",
			"Use the current year from \"Current date:\" in your context when searching for recent information or documentation.",
			"After answering using search results, include a \"Sources:\" section listing relevant URLs as markdown hyperlinks: [Title](URL). Never skip this.",
			"Domain filtering is supported to include or block specific websites.",
			"If BRAVE_SEARCH_API_KEY is not set, ask the user to run /web-search-config before proceeding.",
		],
		parameters: Type.Object({
			query: Type.String({
				description: "The search query. Be specific and use natural language.",
			}),
			max_results: Type.Optional(
				Type.Number({
					description: "Maximum number of results to return (1-10). Default: 5.",
					default: 5,
					minimum: 1,
					maximum: 10,
				}),
			),
		}),

		async execute(_toolCallId, params, signal, onUpdate, _ctx) {
			const maxResults = Math.min(Math.max(params.max_results ?? 5, 1), 10);

			onUpdate?.({
				content: [{ type: "text", text: `Searching Brave for: "${params.query}"...` }],
			});

			try {
				const response = await searchBrave(params.query, maxResults, signal);

				if (response.results.length === 0) {
					return {
						content: [
							{
								type: "text",
								text: `No results found for "${params.query}".`,
							},
						],
						details: { query: params.query, backend: "brave", resultCount: 0 },
					};
				}

				let text = `**Search results for "${response.query}":**\n\n`;
				for (let i = 0; i < response.results.length; i++) {
					const r = response.results[i];
					text += `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}\n\n`;
				}

				return {
					content: [{ type: "text", text: text.trimEnd() }],
					details: {
						query: params.query,
						backend: "brave",
						resultCount: response.results.length,
						results: response.results,
					},
				};
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [
						{
							type: "text",
							text: `Web search failed: ${message}`,
						},
					],
					isError: true,
					details: { query: params.query, backend: "brave", error: message },
				};
			}
		},

		renderCall(args, theme, _context) {
			let text = theme.fg("toolTitle", theme.bold("WebSearch "));
			text += theme.fg("accent", `"${args.query}"`);
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme, _context) {
			if (isPartial) {
				return new Text(theme.fg("warning", "Searching..."), 0, 0);
			}
			const details = result.details as { resultCount?: number; results?: SearchResult[] };
			if (result.isError) {
				return new Text(theme.fg("error", "✗ Search failed"), 0, 0);
			}
			const count = details?.resultCount ?? 0;
			let text = theme.fg("success", `✓ ${count} result${count !== 1 ? "s" : ""}`);
			if (expanded && details?.results) {
				for (const r of details.results.slice(0, 5)) {
					text += `\n  ${theme.fg("dim", `• ${r.title}`)}`;
				}
				if (details.results.length > 5) {
					text += `\n  ${theme.fg("dim", `... and ${details.results.length - 5} more`)}`;
				}
			}
			return new Text(text, 0, 0);
		},
	});

	// =========================================================================
	// web_fetch tool
	// =========================================================================

	interface FetchDetails {
		url: string;
		title?: string;
		contentType?: string;
		contentLength?: number;
		truncation?: TruncationResult;
		fullOutputPath?: string;
	}

	pi.registerTool({
		name: "web_fetch",
		label: "Web Fetch",
		description:
			"Fetch the content of a specific URL. Returns text content for HTML pages (tags stripped), raw text for plain text or JSON. Supports http and https only. Content is truncated to avoid overwhelming the context window.",
		promptSnippet: "Fetch and read content from a specific URL",
		promptGuidelines: [
			"Use web_fetch to read the full content of a specific URL — documentation pages, blog posts, API references found via web_search.",
			"web_fetch is complementary to web_search: search finds URLs, fetch reads them.",
			"After answering using fetched content, include a \"Sources:\" section with a markdown hyperlink to the fetched URL.",
			"Large responses are truncated and spilled to a temp file — the temp path is reported in the result details.",
		],
		parameters: Type.Object({
			url: Type.String({
				description: "The URL to fetch. Must be http or https.",
			}),
			raw: Type.Optional(
				Type.Boolean({
					description: "If true, return the raw HTML instead of extracted text. Default: false.",
					default: false,
				}),
			),
		}),

		async execute(_toolCallId, params, signal, onUpdate, _ctx) {
			const { url, raw = false } = params;

			let parsedUrl: URL;
			try {
				parsedUrl = new URL(url);
			} catch {
				throw new Error(`Invalid URL: ${url}`);
			}
			if (!["http:", "https:"].includes(parsedUrl.protocol)) {
				throw new Error(
					`Unsupported URL protocol: ${parsedUrl.protocol}. Only http and https are supported.`,
				);
			}

			onUpdate?.({
				content: [{ type: "text", text: `Fetching: ${url}...` }],
			});

			const res = await fetch(url, {
				signal,
				redirect: "follow",
				headers: {
					"User-Agent": "Mozilla/5.0 (compatible; rpiv-pi/1.0)",
					Accept:
						"text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
				},
			});

			if (!res.ok) {
				throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
			}

			const contentType = res.headers.get("content-type") ?? "";
			const contentLength = res.headers.get("content-length");

			if (
				contentType.includes("image/") ||
				contentType.includes("video/") ||
				contentType.includes("audio/")
			) {
				throw new Error(`Unsupported content type: ${contentType}. web_fetch supports text pages only.`);
			}

			const body = await res.text();

			let resultText: string;
			let title: string | undefined;

			if (contentType.includes("text/html") && !raw) {
				title = extractTitle(body);
				resultText = htmlToText(body);
			} else {
				resultText = body;
			}

			const truncation = truncateHead(resultText, {
				maxLines: DEFAULT_MAX_LINES,
				maxBytes: DEFAULT_MAX_BYTES,
			});

			const details: FetchDetails = {
				url,
				title,
				contentType,
				contentLength: contentLength ? Number(contentLength) : undefined,
			};

			let output = truncation.content;

			if (truncation.truncated) {
				const tempDir = await mkdtemp(join(tmpdir(), "rpiv-fetch-"));
				const tempFile = join(tempDir, "content.txt");
				await writeFile(tempFile, resultText, "utf8");
				details.truncation = truncation;
				details.fullOutputPath = tempFile;

				const truncatedLines = truncation.totalLines - truncation.outputLines;
				const truncatedBytes = truncation.totalBytes - truncation.outputBytes;
				output += `\n\n[Content truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
				output += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
				output += ` ${truncatedLines} lines (${formatSize(truncatedBytes)}) omitted.`;
				output += ` Full content saved to: ${tempFile}]`;
			}

			let header = `**Fetched:** ${url}`;
			if (title) header += `\n**Title:** ${title}`;
			if (contentType) header += `\n**Content-Type:** ${contentType}`;
			header += "\n\n";

			return {
				content: [{ type: "text", text: header + output }],
				details,
			};
		},

		renderCall(args, theme, _context) {
			let text = theme.fg("toolTitle", theme.bold("WebFetch "));
			text += theme.fg("accent", args.url);
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme, _context) {
			if (isPartial) {
				return new Text(theme.fg("warning", "Fetching..."), 0, 0);
			}
			if (result.isError) {
				return new Text(theme.fg("error", "✗ Fetch failed"), 0, 0);
			}
			const details = result.details as FetchDetails | undefined;
			let text = theme.fg("success", "✓ Fetched");
			if (details?.title) {
				text += theme.fg("muted", `: ${details.title}`);
			}
			if (details?.truncation?.truncated) {
				text += theme.fg("warning", " (truncated)");
			}
			if (expanded) {
				const content = result.content[0];
				if (content?.type === "text") {
					const lines = content.text.split("\n").slice(0, 15);
					for (const line of lines) {
						text += `\n  ${theme.fg("dim", line)}`;
					}
					if (content.text.split("\n").length > 15) {
						text += `\n  ${theme.fg("muted", "... (use read tool to see full content)")}`;
					}
				}
			}
			return new Text(text, 0, 0);
		},
	});

	// =========================================================================
	// /web-search-config slash command
	// =========================================================================

	pi.registerCommand("web-search-config", {
		description: "Configure the Brave Search API key used by web_search/web_fetch",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui?.notify?.("/web-search-config requires interactive mode", "error");
				return;
			}

			const current = loadConfig();
			const showMode = typeof args === "string" && args.includes("--show");

			if (showMode) {
				const masked = current.apiKey
					? `${current.apiKey.slice(0, 4)}...${current.apiKey.slice(-4)}`
					: "(not set)";
				const envMasked = process.env.BRAVE_SEARCH_API_KEY
					? `${process.env.BRAVE_SEARCH_API_KEY.slice(0, 4)}...${process.env.BRAVE_SEARCH_API_KEY.slice(-4)}`
					: "(not set)";
				ctx.ui.notify(
					`Web search config:\n  config file: ${CONFIG_PATH}\n  apiKey: ${masked}\n  BRAVE_SEARCH_API_KEY env: ${envMasked}`,
					"info",
				);
				return;
			}

			const input = await ctx.ui.input(
				"Brave Search API key",
				current.apiKey ? "(leave empty to keep existing)" : "sk-...",
			);

			if (input === undefined || input === null) {
				ctx.ui.notify("Web search config unchanged", "info");
				return;
			}

			const trimmed = input.trim();
			if (!trimmed) {
				ctx.ui.notify("Web search config unchanged", "info");
				return;
			}

			saveConfig({ ...current, apiKey: trimmed });
			ctx.ui.notify(`Saved Brave API key to ${CONFIG_PATH}`, "info");
		},
	});
}
