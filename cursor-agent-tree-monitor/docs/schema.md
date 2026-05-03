# Agent Tree Monitor Schema

The core schema is environment-agnostic. Cursor-specific transcript paths, SDK run IDs, and other source fields belong in `metadata` or `evidence`, not in the portable graph contract.

## AgentSession

- `id`: Stable session or orchestrator identifier.
- `environment`: Source environment name, such as `cursor`.
- `label`: Optional human label for the process or workspace.
- `startedAt`: ISO timestamp when known.
- `now`: ISO timestamp used for rendering elapsed time.
- `refreshSeconds`: Polling cadence. The initial live monitor uses `2`.
- `sort`: Current sort mode, initially `tree`.
- `metadata`: Adapter-specific session fields.

## AgentNode

- `id`: Stable node identifier.
- `parentId`: Parent node identifier, or `null` for roots.
- `type`: Agent role or subagent type.
- `summary`: One-line kickoff task summary.
- `status`: `pending`, `running`, `waiting`, `stale`, `completed`, `failed`, `cancelled`, or `unknown`.
- `model`: `{ name, confidence }`, where confidence is `recorded`, `estimated`, or `unknown`.
- `context`: `{ usedTokens, limitTokens, confidence }` when known.
- `risk`: Derived by the core as `normal`, `warning`, `high`, or `unknown`.
- `metrics`: Aggregate `{ inputTokens, outputTokens, toolCount, errorCount }` when available.
- `source`: `{ adapter, confidence }` to make provenance visible.
- `evidence`: Short source references used to audit inferred fields.
- `metadata`: Adapter-specific node fields.

Cursor transcript nodes may include `metadata.tools`, an array of paired tool-use/tool-result records extracted from subagent JSONL files. Transcript-derived model names are recorded-only: the adapter displays explicit fields such as `model`, `modelName`, `model_name`, or a subagent tool input `model`, and otherwise leaves the model unknown.

## AgentEdge

- `parentId`: Parent node ID.
- `childId`: Child node ID.

Edges are derived from normalized node parentage so every renderer can consume the same graph shape.

## ContextRisk

- `unknown`: Missing or invalid context metrics.
- `normal`: Less than `75%` of the context limit.
- `warning`: At least `75%` and less than `90%`.
- `high`: At least `90%`.

Risk calculations preserve metric confidence. Transcript-derived context is normally `estimated`; SDK-instrumented context can be `recorded` when the wrapper captures enough telemetry. Cursor extension users can provide `agentTreeMonitor.modelContextLimits` keyed by exact recorded model name to override transcript context limits for known models.
