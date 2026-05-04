#!/usr/bin/env python3
"""
tree.py — Build the agent tree by reading transcripts directly.

Source of truth: Claude Code's JSONL transcripts on disk. No state file mutation.
Caches per (path, mtime, size) so repeated refreshes only re-parse changed files.
"""

import json
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

DEFAULT_MAX_TOKENS = 200_000
EXTENDED_MAX_TOKENS = 1_000_000
RUNNING_GRACE_SECONDS = 30  # transcript untouched for >30s ⇒ completed


def model_max_tokens(model: str) -> int:
    """Context window for a given model id. Models with the [1m] suffix are
    1M-context variants (e.g. claude-opus-4-7[1m]); everything else is 200k."""
    if model and "[1m]" in model:
        return EXTENDED_MAX_TOKENS
    return DEFAULT_MAX_TOKENS


@dataclass
class Node:
    agent_id: str
    parent_id: Optional[str]
    agent_type: str
    description: str
    transcript_path: Path
    peak_input_tokens: int = 0
    last_input_tokens: int = 0
    output_tokens: int = 0
    model: str = "claude-sonnet-4-6"
    status: str = "running"
    started_at: str = ""
    last_activity_at: float = 0.0
    children: list[str] = field(default_factory=list)
    depth: int = 0


# (path) -> (mtime, size, parsed_dict)
_cache: dict[Path, tuple[float, int, dict]] = {}


def _read_jsonl(path: Path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue
    except (FileNotFoundError, PermissionError):
        return


def _parse(path: Path) -> dict:
    """Parse a transcript JSONL. Returns:
        {
          peak: int,           # max total input tokens across deduped API calls
          last: int,           # most recent assistant entry's total input tokens
          output: int,         # cumulative output tokens
          model: str,
          first_assistant_at: str | None,
          child_links: {child_agent_id: {subagent_type, description, prompt}}
        }
    Cached by (mtime, size). Only re-parses on change.
    """
    try:
        st = path.stat()
    except OSError:
        return {"peak": 0, "last": 0, "output": 0, "model": "claude-sonnet-4-6",
                "first_assistant_at": None, "child_links": {}}

    cached = _cache.get(path)
    if cached and cached[0] == st.st_mtime and cached[1] == st.st_size:
        return cached[2]

    api_calls: dict[str, dict] = {}  # dedupe by requestId
    last_total = 0
    cumulative_output = 0
    model = "claude-sonnet-4-6"
    first_assistant_at: Optional[str] = None
    tool_use_map: dict[str, dict] = {}   # tool_use_id → spawn info
    agent_links: dict[str, dict] = {}    # agent_id → {tool_use_id, subagent_type, description}

    for entry in _read_jsonl(path):
        etype = entry.get("type")

        if etype == "assistant":
            if first_assistant_at is None:
                first_assistant_at = entry.get("timestamp") or ""

            msg = entry.get("message") or {}
            entry_model = msg.get("model")
            if entry_model:
                model = entry_model

            usage = msg.get("usage")
            if usage:
                total_input = (
                    (usage.get("input_tokens") or 0)
                    + (usage.get("cache_creation_input_tokens") or 0)
                    + (usage.get("cache_read_input_tokens") or 0)
                )
                output = usage.get("output_tokens") or 0
                cumulative_output += output
                last_total = total_input
                key = (
                    entry.get("requestId")
                    or (msg.get("id") if (msg.get("id") or "").startswith("msg_") else None)
                    or f"{path}:{entry.get('uuid', '')}"
                )
                prev = api_calls.get(key)
                if not prev or output >= prev["output_tokens"]:
                    api_calls[key] = {"total_input": total_input, "output_tokens": output}

            for block in (msg.get("content") or []):
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "tool_use" and block.get("name") in ("Agent", "Task"):
                    tuid = block.get("id")
                    if tuid:
                        inp = block.get("input") or {}
                        tool_use_map[tuid] = {
                            "subagent_type": inp.get("subagent_type") or "general-purpose",
                            "description": (inp.get("description") or "")[:200],
                            "prompt": (inp.get("prompt") or "")[:200],
                        }

        elif etype == "user":
            tur = entry.get("toolUseResult") or {}
            agent_id = tur.get("agentId") if isinstance(tur, dict) else None
            if agent_id:
                content = (entry.get("message") or {}).get("content") or []
                tu_id = content[0].get("tool_use_id") if (content and isinstance(content[0], dict)) else None
                info = tool_use_map.get(tu_id or "", {})
                agent_links[agent_id] = {
                    "tool_use_id": tu_id,
                    "subagent_type": info.get("subagent_type", "general-purpose"),
                    "description": info.get("description", ""),
                    "prompt": info.get("prompt", ""),
                    "result_status": tur.get("status", "completed") if isinstance(tur, dict) else "completed",
                }

    peak = max((v["total_input"] for v in api_calls.values()), default=0)

    result = {
        "peak": peak,
        "last": last_total,
        "output": cumulative_output,
        "model": model,
        "first_assistant_at": first_assistant_at,
        "child_links": agent_links,
        "tool_use_pending": tool_use_map,  # tool calls without matching toolUseResult yet
    }
    _cache[path] = (st.st_mtime, st.st_size, result)
    return result


def _meta_agent_type(jsonl_path: Path) -> Optional[str]:
    meta = jsonl_path.with_suffix(".meta.json")
    try:
        return json.loads(meta.read_text()).get("agentType") or None
    except Exception:
        return None


def _find_subagent_transcripts(root_transcript_path: Path) -> dict[str, Path]:
    """Return all agent-<uuid>.jsonl files under <root_dir>/<root_stem>/subagents/...
    walked recursively (in case nested subagents have their own subagents/ dirs).
    """
    base = root_transcript_path.parent / root_transcript_path.stem
    result: dict[str, Path] = {}
    if not base.exists():
        return result
    for p in base.rglob("agent-*.jsonl"):
        # extract UUID after "agent-"
        agent_id = p.stem[len("agent-"):]
        result[agent_id] = p
    return result


def _parse_iso(ts: str) -> float:
    """Parse ISO8601 with optional fractional seconds (truncated to micro)."""
    if not ts:
        return 0.0
    s = ts
    if "." in s:
        head, tail = s.split(".", 1)
        tz_idx = -1
        for i, ch in enumerate(tail):
            if ch in ("Z", "+", "-"):
                tz_idx = i
                break
        frac = tail[:tz_idx] if tz_idx >= 0 else tail
        tz = tail[tz_idx:] if tz_idx >= 0 else ""
        s = f"{head}.{frac[:6]}{tz}"
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def _load_spawn_ledger(session_id: str) -> list[dict]:
    """Read the PreToolUse hook ledger for this session, sorted by spawned_at.

    Each line is one Agent/Task spawn event with fields {caller_id,
    caller_transcript, tool_name, subagent_type, description, prompt_preview,
    spawned_at}. The ledger gives us authoritative parent→child edges that
    aren't recoverable from subagent transcripts alone (Claude Code does not
    embed tool_use_id or matching toolUseResult.agentId rows for spawns made
    from inside a subagent, so transcript-only parsing yields empty
    child_links for any non-root caller).
    """
    path = Path.home() / ".claude" / "agent-conductor" / "spawns" / f"{session_id}.jsonl"
    events: list[dict] = []
    if not path.exists():
        return events
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except OSError:
        return events
    events.sort(key=lambda e: e.get("spawned_at", ""))
    return events


def _resolve_caller_children(
    root_transcript_path: Path,
    all_subagent_files: dict[str, Path],
    ledger: list[dict],
) -> dict[str, list[tuple[str, dict]]]:
    """Return {caller_id: [(child_id, link_metadata), ...]} in spawn order.

    Pass 1 — transcript-derived: parse each known transcript and lift any
    toolUseResult.agentId rows from it. Authoritative for root (and any caller
    whose transcript happens to record those rows).

    Pass 2 — ledger-derived: for spawn events not covered by Pass 1, claim the
    earliest unassigned subagent file whose ctime is ≥ event.spawned_at - 2s
    (clock-skew tolerance). The hook fires before the child transcript is
    created, so child ctime always follows the event in real time.
    """
    out: dict[str, list[tuple[str, dict]]] = {}
    assigned: set[str] = set()

    transcripts_by_caller: dict[str, Path] = {"root": root_transcript_path}
    transcripts_by_caller.update(all_subagent_files)

    for caller_id, path in transcripts_by_caller.items():
        parsed = _parse(path)
        for child_id, link in parsed["child_links"].items():
            if child_id in all_subagent_files and child_id not in assigned:
                out.setdefault(caller_id, []).append((child_id, link))
                assigned.add(child_id)

    file_ctimes: list[tuple[float, str]] = []
    for short_id, path in all_subagent_files.items():
        if short_id in assigned:
            continue
        try:
            file_ctimes.append((path.stat().st_ctime, short_id))
        except OSError:
            continue
    file_ctimes.sort()

    for event in ledger:
        caller_id = event.get("caller_id") or "root"
        spawned_at = _parse_iso(event.get("spawned_at", ""))
        threshold = spawned_at - 2.0
        chosen = None
        for ct, sid in file_ctimes:
            if sid in assigned:
                continue
            if ct >= threshold:
                chosen = sid
                break
        if chosen is None:
            continue
        link = {
            "tool_use_id": None,
            "subagent_type": event.get("subagent_type", "general-purpose"),
            "description": event.get("description", ""),
            "prompt": event.get("prompt_preview", ""),
            "result_status": "completed",
        }
        out.setdefault(caller_id, []).append((chosen, link))
        assigned.add(chosen)

    return out


def build_tree(session_id: str, root_transcript_path: Path) -> dict[str, Node]:
    """Build the full tree. Returns {agent_id_or_root: Node}."""
    nodes: dict[str, Node] = {}
    all_subagent_files = _find_subagent_transcripts(root_transcript_path)
    ledger = _load_spawn_ledger(session_id)
    caller_children = _resolve_caller_children(root_transcript_path, all_subagent_files, ledger)
    now = time.time()

    # BFS from root
    queue: list[tuple[str, Optional[str], Path, str, str, int]] = [
        ("root", None, root_transcript_path, "Root", "", 0)
    ]
    visited: set[Path] = set()

    while queue:
        agent_id, parent_id, transcript, agent_type, description, depth = queue.pop(0)
        if transcript in visited:
            continue
        visited.add(transcript)

        parsed = _parse(transcript)

        # Refine type from meta.json sidecar if available (subagents only)
        if agent_id != "root":
            meta_type = _meta_agent_type(transcript)
            if meta_type:
                agent_type = meta_type

        try:
            mtime = transcript.stat().st_mtime
        except OSError:
            mtime = 0.0

        # Status: completed if parent has matching toolUseResult, OR transcript untouched > grace.
        # For root, status is always "running" while session active (we don't know when it ends).
        status = "running"
        if agent_id == "root":
            status = "running" if (now - mtime) < RUNNING_GRACE_SECONDS else "idle"
        else:
            # Check if parent recorded a toolUseResult for this agent (which means it returned)
            parent_node_transcript = nodes.get(parent_id).transcript_path if parent_id and parent_id in nodes else None
            parent_parsed = _parse(parent_node_transcript) if parent_node_transcript else None
            if parent_parsed and agent_id in parent_parsed["child_links"]:
                status = "completed"
            elif (now - mtime) >= RUNNING_GRACE_SECONDS:
                status = "completed"

        nodes[agent_id] = Node(
            agent_id=agent_id,
            parent_id=parent_id,
            agent_type=agent_type,
            description=description,
            transcript_path=transcript,
            peak_input_tokens=parsed["peak"],
            last_input_tokens=parsed["last"],
            output_tokens=parsed["output"],
            model=parsed["model"],
            status=status,
            started_at=parsed["first_assistant_at"] or "",
            last_activity_at=mtime,
            depth=depth,
        )

        for child_id, link in caller_children.get(agent_id, []):
            child_path = all_subagent_files.get(child_id)
            if child_path and child_id not in nodes:
                queue.append((
                    child_id, agent_id, child_path,
                    link["subagent_type"], link["description"], depth + 1
                ))

    # Wire children lists (in spawn order: order in which child agent_links appeared)
    for n in nodes.values():
        if n.parent_id and n.parent_id in nodes:
            nodes[n.parent_id].children.append(n.agent_id)

    return nodes


def calc_pct(peak: int, model: str = "") -> float:
    return round(100 * peak / model_max_tokens(model), 1)
