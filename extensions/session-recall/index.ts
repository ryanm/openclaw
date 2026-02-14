/**
 * OpenClaw Session Recall Plugin
 *
 * Searches recent sessions for context relevant to the current message.
 * Injects findings as prependContext before each agent turn.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { execSync } from "node:child_process";
import { statSync } from "node:fs";
import { z } from "zod";

// ============================================================================
// Configuration
// ============================================================================

export const sessionRecallConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxResults: z.number().min(1).max(20).default(5),
  minScore: z.number().min(0).max(1).default(0.5),
  minPromptLength: z.number().default(10),
  agentId: z.string().default("main"),
});

export type SessionRecallConfig = z.infer<typeof sessionRecallConfigSchema>;

// ============================================================================
// Types
// ============================================================================

type SearchResult = {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: string;
};

type SearchResponse = {
  results: SearchResult[];
};

type DecayedResult = SearchResult & {
  rawScore: number;
  ageInDays: number;
  decayFactor: number;
};

// ============================================================================
// Decay Configuration
// ============================================================================

const DECAY_TIERS = [
  { maxDays: 7, factor: 1.0 }, // Last week: full weight
  { maxDays: 30, factor: 0.8 }, // Last month: 80%
  { maxDays: 90, factor: 0.5 }, // Last quarter: 50%
  { maxDays: Infinity, factor: 0.2 }, // Older: 20%
];

// ============================================================================
// Plugin
// ============================================================================

const sessionRecallPlugin = {
  id: "session-recall",
  name: "Session Recall",
  description: "Injects relevant context from recent sessions before each turn",
  kind: "hook" as const,
  configSchema: sessionRecallConfigSchema,

  register(api: OpenClawPluginApi) {
    const rawConfig = api.pluginConfig ?? {};
    const cfg = sessionRecallConfigSchema.parse(rawConfig);

    if (!cfg.enabled) {
      api.logger.info("session-recall: disabled by config");
      return;
    }

    api.logger.info(
      `session-recall: registered (maxResults=${cfg.maxResults}, minScore=${cfg.minScore})`,
    );

    // ========================================================================
    // Lifecycle Hook: before_agent_start
    // ========================================================================

    api.on("before_agent_start", async (event) => {
      if (!event.prompt || event.prompt.length < cfg.minPromptLength) {
        return;
      }

      // Skip if prompt looks like system/heartbeat
      const promptLower = event.prompt.toLowerCase();
      if (promptLower.includes("heartbeat") || promptLower.startsWith("[system")) {
        return;
      }

      try {
        const results = searchSessions(event.prompt, cfg);

        if (results.length === 0) {
          api.logger.debug?.("session-recall: no relevant sessions found");
          return;
        }

        const context = formatContext(results);
        api.logger.info?.(`session-recall: injecting ${results.length} session snippets`);

        return {
          prependContext: context,
        };
      } catch (err) {
        api.logger.warn?.(`session-recall: search failed: ${String(err)}`);
      }
    });

    // ========================================================================
    // Service
    // ========================================================================

    api.registerService({
      id: "session-recall",
      start: () => {
        api.logger.info("session-recall: started");
      },
      stop: () => {
        api.logger.info("session-recall: stopped");
      },
    });
  },
};

// ============================================================================
// Decay Utilities
// ============================================================================

function getFileAgeInDays(filePath: string): number {
  try {
    const stats = statSync(filePath);
    const now = Date.now();
    const mtime = stats.mtimeMs;
    return (now - mtime) / (1000 * 60 * 60 * 24);
  } catch {
    // If we can't stat the file, assume it's recent
    return 0;
  }
}

function getDecayFactor(ageInDays: number): number {
  for (const tier of DECAY_TIERS) {
    if (ageInDays <= tier.maxDays) {
      return tier.factor;
    }
  }
  return DECAY_TIERS[DECAY_TIERS.length - 1].factor;
}

function applyDecay(results: SearchResult[]): DecayedResult[] {
  return results.map((r) => {
    const ageInDays = getFileAgeInDays(r.path);
    const decayFactor = getDecayFactor(ageInDays);
    return {
      ...r,
      rawScore: r.score,
      ageInDays,
      decayFactor,
      score: r.score * decayFactor,
    };
  });
}

// ============================================================================
// Search
// ============================================================================

function searchSessions(query: string, cfg: SessionRecallConfig): DecayedResult[] {
  // Escape query for shell
  const escapedQuery = query.replace(/'/g, "'\\''");

  const cmd = [
    "openclaw",
    "memory",
    "search",
    `'${escapedQuery}'`,
    "--agent",
    cfg.agentId,
    "--max-results",
    String(cfg.maxResults * 3), // Get more to account for decay filtering
    "--min-score",
    String(cfg.minScore * 0.5), // Lower threshold, let decay handle it
    "--json",
  ].join(" ");

  try {
    // Redirect stderr to /dev/null to suppress plugin loading messages
    const output = execSync(`${cmd} 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 10000,
      maxBuffer: 1024 * 1024, // 1MB
    });

    // Extract JSON from output (skip any non-JSON lines)
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return [];
    }

    const response: SearchResponse = JSON.parse(jsonMatch[0]);

    // Filter to sessions, apply decay, re-sort, and limit
    const sessionResults = response.results.filter((r) => r.source === "sessions");
    const decayed = applyDecay(sessionResults);

    return decayed
      .filter((r) => r.score >= cfg.minScore) // Filter by decayed score
      .sort((a, b) => b.score - a.score) // Sort by decayed score
      .slice(0, cfg.maxResults);
  } catch {
    return [];
  }
}

// ============================================================================
// Formatting
// ============================================================================

function formatContext(results: DecayedResult[]): string {
  const snippets = results.map((r, i) => {
    // Extract session filename for reference
    const sessionFile = r.path.split("/").pop() ?? r.path;
    const scorePercent = Math.round(r.score * 100);
    const ageLabel = formatAge(r.ageInDays);

    // Clean up snippet (remove excessive whitespace, truncate)
    let snippet = r.snippet.trim();
    if (snippet.length > 500) {
      snippet = snippet.slice(0, 500) + "...";
    }

    return `[${i + 1}] (${scorePercent}%, ${ageLabel})\n${snippet}`;
  });

  return `<session-recall>
The following excerpts from recent sessions may be relevant:

${snippets.join("\n\n")}
</session-recall>`;
}

function formatAge(days: number): string {
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 7) return `${Math.round(days)}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

export default sessionRecallPlugin;
