# Cursor Packaging Path

The monitor core is not Cursor-specific. Cursor packaging should consume normalized graph snapshots from the core instead of importing transcript parser internals directly.

## Version 1: CLI Live Monitor

Use the CLI for the first running version:

```bash
node src/cli.js --root /path/to/agent-transcripts --session latest --refresh 2
```

This keeps the first iteration portable and testable. The CLI uses the same adapter contract that future non-Cursor environments can implement.

## Version 2: Canvas Wrapper

Use a Cursor Canvas only when a side-window artifact is enough. The Canvas should embed the ASCII snapshot or a precomputed graph JSON payload. It should not own parsing, risk scoring, or polling logic.

Choose Canvas when:

- A static or manually refreshed side-window view is sufficient.
- The user wants the monitor visible beside chat.
- The graph core and risk rules are already reliable enough to present.

## Version 3: Cursor Plugin Or Webview

Move to a plugin/webview when the monitor needs Cursor-specific runtime behavior:

- File watching instead of polling.
- Commands such as refresh, choose session, copy node evidence, or open transcript.
- Installation and reuse across workspaces.
- Long-lived state independent of an agent-created artifact.

The plugin/webview should still depend on the portable core and Cursor adapters through the adapter interface. That keeps future environments from inheriting Cursor-only assumptions.
