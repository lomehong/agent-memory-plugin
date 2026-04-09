/**
 * Agent-Memory Plugin for OpenClaw
 *
 * Self-hosted AI agent memory system with:
 * - Auto-classification (identity/principle/knowledge/working)
 * - Semantic deduplication with per-category thresholds
 * - TTL lifecycle management (active → degraded → archived)
 * - Multi-dimensional scoring (similarity, priority, access, category, urgency)
 * - Visibility control (private/team/user)
 *
 * Connects to agent-memory REST API server.
 */

import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

// ============================================================================
// Types
// ============================================================================

interface AgentMemoryConfig {
  host: string;
  apiKey: string;
  userId: string;
  autoRecall: boolean;
  autoCapture: boolean;
  topK: number;
}

interface MemoryRecord {
  id: string;
  user_id: string;
  agent_id: string;
  team: string;
  visibility: string;
  content: string;
  category: string;
  priority: number;
  source: string;
  confidence: number;
  ttl: string;
  tags: string[] | null;
  version: number;
  status: string;
  created_at: string;
  updated_at: string;
  last_accessed: string;
  access_count: number;
  merged_from: string[];
}

interface WriteSuggestion {
  recommended_category: string;
  recommended_visibility: string;
  recommended_priority: number;
  recommended_ttl: string;
  dedup_hit: boolean;
  dedup_memory_id?: string;
  dedup_score?: number;
}

interface WriteResult {
  memory: MemoryRecord;
  suggestion: WriteSuggestion;
}

interface SearchResult {
  id: string;
  user_id: string;
  agent_id: string;
  team: string;
  visibility: string;
  content: string;
  category: string;
  priority: number;
  source: string;
  confidence: number;
  ttl: string;
  tags: string[] | null;
  version: number;
  status: string;
  created_at: string;
  updated_at: string;
  last_accessed: string;
  access_count: number;
  merged_from: string[];
  score: number;
}

interface SearchResponse {
  count: number;
  results: SearchResult[];
}

interface ListResponse {
  count: number;
  memories: MemoryRecord[];
}

interface HealthReport {
  total_count: number;
  by_category: Record<string, number>;
  by_status: Record<string, number>;
  top_accessed: MemoryRecord[];
  zero_access: MemoryRecord[];
  stale_memories: MemoryRecord[] | null;
}

// ============================================================================
// Agent-Memory HTTP Client
// ============================================================================

class AgentMemoryClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(host: string, apiKey: string) {
    this.baseUrl = host.replace(/\/+$/, "");
    this.apiKey = apiKey;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-API-Key": this.apiKey,
    };

    const opts: RequestInit = { method, headers };
    if (body !== undefined) {
      opts.body = JSON.stringify(body);
    }

    const resp = await fetch(url, opts);
    const data = await resp.json();

    if (!resp.ok) {
      throw new Error(
        data?.error || `HTTP ${resp.status}: ${resp.statusText}`,
      );
    }

    return data as T;
  }

  async health(): Promise<{ status: string }> {
    return this.request("GET", "/api/v1/health");
  }

  async store(
    content: string,
    options?: {
      category?: string;
      visibility?: string;
      priority?: number;
      tags?: string[];
    },
  ): Promise<WriteResult> {
    const body: Record<string, unknown> = { content };
    if (options?.category) body.category = options.category;
    if (options?.visibility) body.visibility = options.visibility;
    if (options?.priority) body.priority = options.priority;
    if (options?.tags) body.tags = options.tags;
    return this.request("POST", "/api/v1/memories", body);
  }

  async search(
    query: string,
    options?: { category?: string; topK?: number },
  ): Promise<SearchResponse> {
    const params = new URLSearchParams({ query });
    if (options?.category) params.set("category", options.category);
    if (options?.topK) params.set("top_k", String(options.topK));
    return this.request(
      "GET",
      `/api/v1/memories/search?${params.toString()}`,
    );
  }

  async list(options?: {
    category?: string;
    status?: string;
    limit?: number;
  }): Promise<ListResponse> {
    const params = new URLSearchParams();
    if (options?.category) params.set("category", options.category);
    if (options?.status) params.set("status", options.status);
    if (options?.limit) params.set("limit", String(options.limit));
    const qs = params.toString();
    return this.request(
      "GET",
      `/api/v1/memories${qs ? `?${qs}` : ""}`,
    );
  }

  async get(id: string): Promise<MemoryRecord> {
    return this.request("GET", `/api/v1/memories/${id}`);
  }

  async update(
    id: string,
    updates: {
      content?: string;
      category?: string;
      priority?: number;
      visibility?: string;
      ttl?: string;
      tags?: string[];
      status?: string;
    },
  ): Promise<MemoryRecord> {
    return this.request("PUT", `/api/v1/memories/${id}`, updates);
  }

  async forget(id: string): Promise<{ status: string; id: string }> {
    return this.request("DELETE", `/api/v1/memories/${id}`);
  }

  async report(): Promise<HealthReport> {
    return this.request("GET", "/api/v1/memories/report");
  }
}

// ============================================================================
// Config
// ============================================================================

function parseConfig(raw: unknown): AgentMemoryConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("agent-memory-plugin config is required");
  }
  const cfg = raw as Record<string, unknown>;

  const host = typeof cfg.host === "string" ? resolveEnv(cfg.host) : "";
  const apiKey = typeof cfg.apiKey === "string" ? resolveEnv(cfg.apiKey) : "";
  if (!host) throw new Error("agent-memory-plugin: host is required");
  if (!apiKey) throw new Error("agent-memory-plugin: apiKey is required");

  return {
    host,
    apiKey,
    userId:
      typeof cfg.userId === "string" && cfg.userId ? cfg.userId : "default",
    autoRecall: cfg.autoRecall !== false,
    autoCapture: cfg.autoCapture !== false,
    topK: typeof cfg.topK === "number" ? cfg.topK : 5,
  };
}

function resolveEnv(val: string): string {
  return val.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g,
    (_, name, fallback) => process.env[name] || fallback || "",
  );
}

// ============================================================================
// Helpers
// ============================================================================

function categoryEmoji(cat: string): string {
  switch (cat) {
    case "identity":
      return "🪪";
    case "principle":
      return "📐";
    case "knowledge":
      return "📚";
    case "working":
      return "🔧";
    default:
      return "📝";
  }
}

function visibilityLabel(vis: string): string {
  switch (vis) {
    case "private":
      return "🔒private";
    case "team":
      return "👥team";
    case "user":
      return "🌐user";
    default:
      return vis;
  }
}

function ttlLabel(ttl: string): string {
  switch (ttl) {
    case "permanent":
      return "∞permanent";
    case "year":
      return "📅year";
    case "month":
      return "📆month";
    case "week":
      return "🗓week";
    case "session":
      return "⏱session";
    default:
      return ttl;
  }
}

function formatMemory(m: MemoryRecord | SearchResult): string {
  const score =
    "score" in m && typeof m.score === "number"
      ? ` (score: ${(m.score * 100).toFixed(0)}%)`
      : "";
  const tags = m.tags?.length ? ` [${m.tags.join(", ")}]` : "";
  return `${categoryEmoji(m.category)} [${m.category}] ${m.content}${tags}${score}`;
}

// ============================================================================
// Plugin Definition
// ============================================================================

const agentMemoryPlugin = {
  id: "agent-memory-plugin",
  name: "Agent Memory",
  description:
    "Self-hosted AI agent memory with auto-classification, semantic dedup, and TTL lifecycle management",
  kind: "memory" as const,
  configSchema: {
    parse: parseConfig,
  },

  register(api: OpenClawPluginApi) {
    const cfg = parseConfig(api.pluginConfig);
    const client = new AgentMemoryClient(cfg.host, cfg.apiKey);

    api.logger.info(
      `agent-memory-plugin: registered (host: ${cfg.host}, user: ${cfg.userId}, autoRecall: ${cfg.autoRecall}, autoCapture: ${cfg.autoCapture}, topK: ${cfg.topK})`,
    );

    // Verify connectivity
    client
      .health()
      .then(() =>
        api.logger.info("agent-memory-plugin: server health check OK"),
      )
      .catch((err) =>
        api.logger.warn(
          `agent-memory-plugin: server health check failed: ${err}`,
        ),
      );

    // ========================================================================
    // Tools
    // ========================================================================

    api.registerTool(
      {
        name: "memory_search",
        label: "Memory Search",
        description:
          "Search through long-term memories with semantic similarity. Use when you need context about user preferences, past decisions, project details, or previously discussed topics. Memories are auto-classified into identity/principle/knowledge/working categories.",
        parameters: Type.Object({
          query: Type.String({
            description: "Search query — use natural language for best results",
          }),
          category: Type.Optional(
            Type.Union(
              [
                Type.Literal("identity"),
                Type.Literal("principle"),
                Type.Literal("knowledge"),
                Type.Literal("working"),
              ],
              {
                description:
                  "Filter by category: identity (personal info), principle (preferences/rules), knowledge (tech/domain), working (task/project)",
              },
            ),
          ),
          limit: Type.Optional(
            Type.Number({
              description: `Max results (default: ${cfg.topK})`,
            }),
          ),
        }),
        async execute(_toolCallId, params) {
          const { query, category, limit } = params as {
            query: string;
            category?: string;
            limit?: number;
          };

          try {
            const result = await client.search(query, {
              category,
              topK: limit ?? cfg.topK,
            });

            if (!result.results || result.results.length === 0) {
              return {
                content: [{ type: "text", text: "No relevant memories found." }],
                details: { count: 0 },
              };
            }

            const text = result.results
              .map((r, i) => `${i + 1}. ${formatMemory(r)}`)
              .join("\n");

            const sanitized = result.results.map((r) => ({
              id: r.id,
              content: r.content,
              category: r.category,
              priority: r.priority,
              visibility: r.visibility,
              score: r.score,
              created_at: r.created_at,
            }));

            return {
              content: [
                {
                  type: "text",
                  text: `Found ${result.count} memories:\n\n${text}`,
                },
              ],
              details: { count: result.count, memories: sanitized },
            };
          } catch (err) {
            return {
              content: [
                {
                  type: "text",
                  text: `Memory search failed: ${String(err)}`,
                },
              ],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "memory_search" },
    );

    api.registerTool(
      {
        name: "memory_store",
        label: "Memory Store",
        description:
          "Save important information in long-term memory. The system auto-classifies memories into categories (identity/principle/knowledge/working), infers visibility and TTL, and deduplicates against existing memories. Use for preferences, facts, decisions, and anything worth remembering.",
        parameters: Type.Object({
          text: Type.String({
            description: "Information to remember",
          }),
          category: Type.Optional(
            Type.Union(
              [
                Type.Literal("identity"),
                Type.Literal("principle"),
                Type.Literal("knowledge"),
                Type.Literal("working"),
              ],
              {
                description:
                  "Override auto-classification: identity (personal info), principle (preferences/rules), knowledge (tech/domain), working (task/project)",
              },
            ),
          ),
          priority: Type.Optional(
            Type.Integer({
              description: "Priority 1-5 (1=highest, 5=lowest). Auto-inferred from category if omitted.",
              minimum: 1,
              maximum: 5,
            }),
          ),
          tags: Type.Optional(
            Type.Array(Type.String(), {
              description: "Optional tags for this memory",
            }),
          ),
        }),
        async execute(_toolCallId, params) {
          const { text, category, priority, tags } = params as {
            text: string;
            category?: string;
            priority?: number;
            tags?: string[];
          };

          try {
            const result = await client.store(text, {
              category,
              priority,
              tags,
            });

            const mem = result.memory;
            const sug = result.suggestion;

            const action = sug.dedup_hit
              ? `Updated existing memory (${sug.dedup_memory_id}, score: ${(sug.dedup_score! * 100).toFixed(0)}%)`
              : `Created new memory (${mem.id})`;

            return {
              content: [
                {
                  type: "text",
                  text: `Stored: ${action}\n${categoryEmoji(mem.category)} [${mem.category}] ${visibilityLabel(mem.visibility)} priority=${mem.priority} ttl=${ttlLabel(mem.ttl)}\n"${mem.content}"`,
                },
              ],
              details: {
                action: sug.dedup_hit ? "merged" : "created",
                memory: mem,
                suggestion: sug,
              },
            };
          } catch (err) {
            return {
              content: [
                {
                  type: "text",
                  text: `Memory store failed: ${String(err)}`,
                },
              ],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "memory_store" },
    );

    api.registerTool(
      {
        name: "memory_get",
        label: "Memory Get",
        description:
          "Retrieve a specific memory by its ID. Returns full details including category, priority, visibility, TTL, and access history.",
        parameters: Type.Object({
          memoryId: Type.String({
            description: "The memory ID to retrieve",
          }),
        }),
        async execute(_toolCallId, params) {
          const { memoryId } = params as { memoryId: string };

          try {
            const mem = await client.get(memoryId);

            return {
              content: [
                {
                  type: "text",
                  text: `Memory ${mem.id}:\n${categoryEmoji(mem.category)} Category: ${mem.category}\n${visibilityLabel(mem.visibility)} Priority: ${mem.priority} (1-5)\n${ttlLabel(mem.ttl)} Version: ${mem.version}\nAccessed: ${mem.access_count} times\nCreated: ${mem.created_at}\nUpdated: ${mem.updated_at}\n\nContent: ${mem.content}`,
                },
              ],
              details: { memory: mem },
            };
          } catch (err) {
            return {
              content: [
                {
                  type: "text",
                  text: `Memory get failed: ${String(err)}`,
                },
              ],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "memory_get" },
    );

    api.registerTool(
      {
        name: "memory_list",
        label: "Memory List",
        description:
          "List all stored memories with optional filtering. Use to review what has been remembered.",
        parameters: Type.Object({
          category: Type.Optional(
            Type.Union(
              [
                Type.Literal("identity"),
                Type.Literal("principle"),
                Type.Literal("knowledge"),
                Type.Literal("working"),
              ],
              {
                description: "Filter by category",
              },
            ),
          ),
          status: Type.Optional(
            Type.Union(
              [
                Type.Literal("active"),
                Type.Literal("degraded"),
                Type.Literal("archived"),
              ],
              {
                description: "Filter by status",
              },
            ),
          ),
          limit: Type.Optional(
            Type.Number({
              description: "Max results (default: 20)",
            }),
          ),
        }),
        async execute(_toolCallId, params) {
          const { category, status, limit } = params as {
            category?: string;
            status?: string;
            limit?: number;
          };

          try {
            const result = await client.list({ category, status, limit });

            if (!result.memories || result.memories.length === 0) {
              return {
                content: [
                  { type: "text", text: "No memories found." },
                ],
                details: { count: 0 },
              };
            }

            const text = result.memories
              .map((m, i) => `${i + 1}. ${formatMemory(m)}`)
              .join("\n");

            const sanitized = result.memories.map((m) => ({
              id: m.id,
              content: m.content,
              category: m.category,
              priority: m.priority,
              visibility: m.visibility,
              status: m.status,
              created_at: m.created_at,
            }));

            return {
              content: [
                {
                  type: "text",
                  text: `${result.count} memories:\n\n${text}`,
                },
              ],
              details: { count: result.count, memories: sanitized },
            };
          } catch (err) {
            return {
              content: [
                {
                  type: "text",
                  text: `Memory list failed: ${String(err)}`,
                },
              ],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "memory_list" },
    );

    api.registerTool(
      {
        name: "memory_forget",
        label: "Memory Forget",
        description:
          "Delete a specific memory by ID. GDPR-compliant permanent deletion.",
        parameters: Type.Object({
          memoryId: Type.String({
            description: "The memory ID to permanently delete",
          }),
        }),
        async execute(_toolCallId, params) {
          const { memoryId } = params as { memoryId: string };

          try {
            const result = await client.forget(memoryId);
            return {
              content: [
                {
                  type: "text",
                  text: `Memory ${memoryId} permanently deleted.`,
                },
              ],
              details: { action: "deleted", id: result.id },
            };
          } catch (err) {
            return {
              content: [
                {
                  type: "text",
                  text: `Memory forget failed: ${String(err)}`,
                },
              ],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "memory_forget" },
    );

    api.registerTool(
      {
        name: "memory_report",
        label: "Memory Report",
        description:
          "Get a comprehensive health report of the memory system including statistics by category, status, top accessed memories, and stale memories.",
        parameters: Type.Object({}),
        async execute(_toolCallId, _params) {
          try {
            const report = await client.report();

            const lines: string[] = [
              `📊 Memory Health Report`,
              ``,
              `Total: ${report.total_count} memories`,
            ];

            if (report.by_category && Object.keys(report.by_category).length > 0) {
              lines.push(`\nBy Category:`);
              for (const [cat, count] of Object.entries(report.by_category)) {
                lines.push(`  ${categoryEmoji(cat)} ${cat}: ${count}`);
              }
            }

            if (report.by_status && Object.keys(report.by_status).length > 0) {
              lines.push(`\nBy Status:`);
              for (const [status, count] of Object.entries(report.by_status)) {
                lines.push(`  ${status === "active" ? "🟢" : status === "degraded" ? "🟡" : "🔴"} ${status}: ${count}`);
              }
            }

            if (report.top_accessed?.length > 0) {
              lines.push(`\nTop Accessed:`);
              for (const m of report.top_accessed.slice(0, 5)) {
                lines.push(`  ${m.access_count}x ${m.content.slice(0, 60)}`);
              }
            }

            if (report.stale_memories?.length > 0) {
              lines.push(`\n⚠️ Stale (not accessed in 30 days): ${report.stale_memories.length}`);
            }

            if (report.zero_access?.length > 0) {
              lines.push(`\nZero Access: ${report.zero_access.length} memories never accessed`);
            }

            return {
              content: [
                {
                  type: "text",
                  text: lines.join("\n"),
                },
              ],
              details: { report },
            };
          } catch (err) {
            return {
              content: [
                {
                  type: "text",
                  text: `Memory report failed: ${String(err)}`,
                },
              ],
              details: { error: String(err) },
            };
          }
        },
      },
      { name: "memory_report" },
    );

    // ========================================================================
    // CLI Commands
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const mem = program
          .command("agent-memory")
          .description("Agent-memory plugin commands");

        mem
          .command("search")
          .description("Search memories")
          .argument("<query>", "Search query")
          .option("--limit <n>", "Max results", String(cfg.topK))
          .option(
            "--category <cat>",
            "Filter by category",
          )
          .action(
            async (query: string, opts: { limit: string; category?: string }) => {
              try {
                const result = await client.search(query, {
                  topK: parseInt(opts.limit, 10),
                  category: opts.category,
                });
                if (!result.results?.length) {
                  console.log("No memories found.");
                  return;
                }
                console.log(
                  JSON.stringify(
                    result.results.map((r) => ({
                      id: r.id,
                      content: r.content,
                      category: r.category,
                      score: r.score,
                      created_at: r.created_at,
                    })),
                    null,
                    2,
                  ),
                );
              } catch (err) {
                console.error(`Search failed: ${String(err)}`);
              }
            },
          );

        mem
          .command("report")
          .description("Show memory health report")
          .action(async () => {
            try {
              const report = await client.report();
              console.log(JSON.stringify(report, null, 2));
            } catch (err) {
              console.error(`Report failed: ${String(err)}`);
            }
          });

        mem
          .command("stats")
          .description("Show memory statistics")
          .action(async () => {
            try {
              const result = await client.list({ limit: 1 });
              console.log(`Host: ${cfg.host}`);
              console.log(`User: ${cfg.userId}`);
              console.log(`Auto-recall: ${cfg.autoRecall}`);
              console.log(`Auto-capture: ${cfg.autoCapture}`);
              // List all with high limit to get total count
              const all = await client.list({ limit: 10000 });
              console.log(`Total memories: ${all.count}`);
            } catch (err) {
              console.error(`Stats failed: ${String(err)}`);
            }
          });
      },
      { commands: ["agent-memory"] },
    );

    // ========================================================================
    // Lifecycle Hooks
    // ========================================================================

    // Auto-recall: inject relevant memories before agent starts
    if (cfg.autoRecall) {
      api.on("before_agent_start", async (event) => {
        if (!event.prompt || event.prompt.length < 5) return;

        try {
          const result = await client.search(event.prompt, {
            topK: cfg.topK,
          });

          if (!result.results || result.results.length === 0) return;

          const memoryContext = result.results
            .map(
              (r) =>
                `- [${r.category}] ${r.content} (score: ${(r.score * 100).toFixed(0)}%)`,
            )
            .join("\n");

          api.logger.info(
            `agent-memory-plugin: injecting ${result.count} memories into context`,
          );

          return {
            systemPrompt: `<relevant-memories>\nThe following memories may be relevant to this conversation:\n${memoryContext}\n</relevant-memories>`,
          };
        } catch (err) {
          api.logger.warn(
            `agent-memory-plugin: recall failed: ${String(err)}`,
          );
        }
      });
    }

    // Auto-capture: extract and store key facts after agent ends
    if (cfg.autoCapture) {
      api.on("agent_end", async (event) => {
        if (!event.success || !event.messages || event.messages.length === 0)
          return;

        try {
          // Extract meaningful text from user messages
          const userTexts: string[] = [];
          for (const msg of event.messages.slice(-10)) {
            if (!msg || typeof msg !== "object") continue;
            const msgObj = msg as Record<string, unknown>;
            if (msgObj.role !== "user") continue;

            let text = "";
            const content = msgObj.content;
            if (typeof content === "string") {
              text = content;
            } else if (Array.isArray(content)) {
              for (const block of content) {
                if (
                  block &&
                  typeof block === "object" &&
                  "type" in block &&
                  (block as Record<string, unknown>).type === "text"
                ) {
                  text += (block as Record<string, unknown>).text + " ";
                }
              }
            }

            if (!text || text.length < 5) continue;

            // Filter out noise: metadata JSON blocks, system prompts, memory context
            const cleaned = text
              .split("\n")
              .filter((line) => {
                const trimmed = line.trim();
                if (!trimmed) return false;
                // Skip metadata blocks (conversation info, sender, message_id)
                if (
                  trimmed.startsWith("Conversation info") ||
                  trimmed.startsWith("Sender (") ||
                  trimmed.startsWith("[message_id:")
                )
                  return false;
                // Skip JSON metadata blocks
                if (trimmed.startsWith("```json")) return false;
                if (trimmed.startsWith("```")) return false;
                if (/^\s*\{.*\}$/.test(trimmed)) return false;
                // Skip system-injected memory context
                if (trimmed.includes("<relevant-memories>")) return false;
                if (trimmed.includes("</relevant-memories>")) return false;
                // Skip lines that are pure JSON key-value pairs
                if (/^\s*"[^"]+"\s*:/.test(trimmed)) return false;
                // Skip lines that are just labels like [message_id: ...]
                if (/^\[message_id:\s/.test(trimmed)) return false;
                return true;
              })
              .join("\n")
              .trim();

            if (cleaned.length >= 5) {
              userTexts.push(cleaned);
            }
          }

          // Store cleaned user messages
          let captured = 0;
          for (const msg of userTexts) {
            if (msg.length < 10) continue;
            try {
              await client.store(msg);
              captured++;
            } catch {
              // Dedup is expected for repeated messages
            }
          }

          if (captured > 0) {
            api.logger.info(
              `agent-memory-plugin: auto-captured ${captured} memories`,
            );
          }
        } catch (err) {
          api.logger.warn(
            `agent-memory-plugin: capture failed: ${String(err)}`,
          );
        }
      });
    }

    // ========================================================================
    // Service
    // ========================================================================

    api.registerService({
      id: "agent-memory-plugin",
      start: () => {
        api.logger.info(
          `agent-memory-plugin: started (host: ${cfg.host}, user: ${cfg.userId})`,
        );
      },
      stop: () => {
        api.logger.info("agent-memory-plugin: stopped");
      },
    });
  },
};

export default agentMemoryPlugin;
