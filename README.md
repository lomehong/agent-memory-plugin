# agent-memory-plugin

OpenClaw memory plugin for [agent-memory](https://github.com/lomehong/agent-memory) self-hosted memory system.

## Features

- **autoRecall**: Automatically inject relevant memories before each agent turn
- **autoCapture**: Intelligently extract and store valuable facts after each conversation
  - 3-layer architecture: Filter → Extract → Quality Gate
  - Filters 20+ noise patterns (Feishu metadata, heartbeat prompts, JSON blocks, etc.)
  - Detects valuable content via 15+ heuristic signals (IPs, URLs, configs, decisions, preferences)
  - In-batch deduplication
- **Agent Isolation**: Each OpenClaw Agent gets its own memory space via `X-User-Id` header
- **Tools**: memory_store, memory_search, memory_list, memory_get, memory_forget, memory_report

## Agent Mapping

| OpenClaw Agent | agentId | userId | Backend Agent |
|---------------|---------|--------|---------------|
| M10S | main | m10s | OpenClaw-M10S |
| DevForge | dev | devforge | OpenClaw-DevForge |
| Sage | researcher | sage | OpenClaw-Sage |
| Clara | secretary | clara | OpenClaw-Clara |
| QBot | tester | qbot | OpenClaw-QBot |

## Configuration

Add to `openclaw.json`:

```json
{
  "plugins": {
    "slots": {
      "memory": "agent-memory-plugin"
    },
    "entries": {
      "agent-memory-plugin": {
        "enabled": true,
        "config": {
          "host": "http://YOUR_SERVER:8101",
          "apiKey": "your-api-key",
          "userId": "default",
          "autoRecall": true,
          "autoCapture": true,
          "topK": 5
        }
      }
    }
  }
}
```

### Config Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| host | string | ✅ | agent-memory server URL |
| apiKey | string | ✅ | API key for authentication |
| userId | string | ❌ | Default user ID (overridden per-agent automatically) |
| autoRecall | boolean | ❌ | Inject memories before agent turn (default: true) |
| autoCapture | boolean | ❌ | Store memories after agent turn (default: true) |
| topK | number | ❌ | Max memories to retrieve (default: 5) |

## How Agent Isolation Works

1. `before_tool_call` hook captures the current `agentId`
2. Agent ID is mapped to userId via `AGENT_USER_MAP`
3. `X-User-Id` header is set on all API requests
4. Backend resolves the userId to the correct agent record

## autoCapture Filtering

The capture system filters out noise before storing:

- **Feishu metadata**: `Conversation info`, `Sender`, `[message_id:` blocks
- **JSON blocks**: code fences, bare objects, key-value lines
- **System prompts**: heartbeat instructions, `<relevant-memories>` context
- **Low-value content**: single-word replies, commands under 15 chars
- **Content quality**: only stores messages matching 1+ positive signal (URLs, IPs, configs, decisions, preferences, etc.)

## Development

```bash
npm install
# Plugin is loaded by OpenClaw from the extensions directory
```

## License

MIT
