#!/usr/bin/env python3
"""
conductor.py — Core library for Agent Conductor plugin.

Handles:
- State file init/read/update
- Transcript JSONL parsing (agent tree building, peak token extraction)
- CLI entry points: init, update
"""

import json
import os
import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict

STATE_DIR = Path.home() / ".claude" / "agent-conductor"
MODEL_MAX_TOKENS = 200_000  # All Claude 3+ models


# ---------------------------------------------------------------------------
# State file management
# ---------------------------------------------------------------------------

def _state_path(session_id: str) -> Path:
    return STATE_DIR / f"{session_id}.json"


def _write_state(state: dict) -> None:
    """Atomically write state file."""
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    path = _state_path(state["session_id"])
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2))
    tmp.rename(path)


def load_state(session_id: str) -> Optional[dict]:
    path = _state_path(session_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def init_state(session_id: str, transcript_path: str, cwd: str) -> None:
    state = {
        "session_id": session_id,
        "transcript_path": transcript_path,
        "cwd": cwd,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "terminated": False,
        "agents": {
            "root": {
                "agent_id": None,
                "parent": None,
                "status": "running",
                "agent_type": "Root",
                "description": None,
                "transcript_path": transcript_path,
                "peak_input_tokens": 0,
                "model": "claude-sonnet-4-6",
                "children": [],
                "started_at": datetime.now(timezone.utc).isoformat(),
                "completed_at": None,
            }
        },
    }
    _write_state(state)


def mark_terminated(session_id: str) -> None:
    state = load_state(session_id)
    if state:
        state["terminated"] = True
        state["agents"]["root"]["status"] = "completed"
        state["agents"]["root"]["completed_at"] = datetime.now(timezone.utc).isoformat()
        _write_state(state)


def update_agent_in_state(session_id: str, agent_id: str, peak_tokens: int, model: str, status: str) -> None:
    state = load_state(session_id)
    if not state:
        return
    agents = state["agents"]
    if agent_id in agents:
        agents[agent_id]["peak_input_tokens"] = peak_tokens
        agents[agent_id]["model"] = model
        agents[agent_id]["status"] = status
        if status == "completed":
            agents[agent_id]["completed_at"] = datetime.now(timezone.utc).isoformat()
    _write_state(state)


# ---------------------------------------------------------------------------
# Transcript parsing
# ---------------------------------------------------------------------------

def _read_jsonl(path: str):
    """Yield parsed JSON objects from a JSONL file, skipping bad lines."""
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


def get_peak_input_tokens(transcript_path: str) -> tuple[int, str]:
    """
    Return (peak_input_tokens, model_name) from a transcript JSONL.

    Peak = max over all assistant entries of:
        input_tokens + cache_creation_input_tokens + cache_read_input_tokens

    Deduplicates by requestId (keep entry with max output_tokens per key,
    since one API response is split across multiple assistant entries).
    """
    # key -> {total_input, output_tokens, model}
    api_calls: dict[str, dict] = {}
    model = "claude-sonnet-4-6"

    for entry in _read_jsonl(transcript_path):
        if entry.get("type") != "assistant":
            continue
        msg = entry.get("message") or {}
        usage = msg.get("usage")
        if not usage:
            continue

        # Track model
        entry_model = msg.get("model", "")
        if entry_model:
            model = entry_model

        total_input = (
            (usage.get("input_tokens") or 0)
            + (usage.get("cache_creation_input_tokens") or 0)
            + (usage.get("cache_read_input_tokens") or 0)
        )
        output = usage.get("output_tokens") or 0

        key = (
            entry.get("requestId")
            or (msg.get("id") if (msg.get("id") or "").startswith("msg_0") else None)
            or f"{transcript_path}:{entry.get('uuid', '')}"
        )

        prev = api_calls.get(key)
        if not prev or output >= prev["output_tokens"]:
            api_calls[key] = {"total_input": total_input, "output_tokens": output, "model": entry_model or model}

    if not api_calls:
        return 0, model

    # Peak = max total_input across all deduplicated API calls
    peak = max(v["total_input"] for v in api_calls.values())
    # Use model from the call with the highest output (most likely the final/complete entry)
    best = max(api_calls.values(), key=lambda v: v["output_tokens"])
    if best["model"]:
        model = best["model"]

    return peak, model


def calc_context_pct(peak_input_tokens: int) -> float:
    return round(100 * peak_input_tokens / MODEL_MAX_TOKENS, 1)


# ---------------------------------------------------------------------------
# Agent tree building
# ---------------------------------------------------------------------------

def _get_subagents_dir(root_transcript_path: str) -> Optional[Path]:
    """
    Subagent transcripts live at:
      ~/.claude/projects/<project>/<session-uuid>/subagents/
    The root transcript is at:
      ~/.claude/projects/<project>/<session-uuid>.jsonl
    So subagents dir = transcript_path_without_extension / "subagents"
    """
    p = Path(root_transcript_path)
    subagents_dir = p.parent / p.stem / "subagents"
    if subagents_dir.exists():
        return subagents_dir
    return None


def _infer_agent_type_from_meta(jsonl_path: Path) -> Optional[str]:
    meta = jsonl_path.with_suffix(".meta.json")
    try:
        data = json.loads(meta.read_text())
        return data.get("agentType") or None
    except Exception:
        return None


def _parse_agent_links(transcript_path: str) -> tuple[dict, dict]:
    """
    Parse a transcript to find spawned subagents.

    Returns:
        tool_use_map: {tool_use_id -> {subagent_type, description, prompt}}
        agent_links: {agentId -> {tool_use_id, subagent_type, description, prompt, status}}
    """
    tool_use_map: dict[str, dict] = {}  # tool_use_id -> info
    agent_links: dict[str, dict] = {}   # agentId -> info

    for entry in _read_jsonl(transcript_path):
        etype = entry.get("type")

        if etype == "assistant":
            msg = entry.get("message") or {}
            for content_block in (msg.get("content") or []):
                if content_block.get("type") == "tool_use" and content_block.get("name") in ("Agent", "Task"):
                    tuid = content_block.get("id")
                    if tuid:
                        inp = content_block.get("input") or {}
                        tool_use_map[tuid] = {
                            "subagent_type": inp.get("subagent_type") or "general-purpose",
                            "description": inp.get("description") or "",
                            "prompt": (inp.get("prompt") or "")[:200],  # truncate for storage
                        }

        elif etype == "user":
            tur = entry.get("toolUseResult") or {}
            agent_id = tur.get("agentId") if isinstance(tur, dict) else None
            if agent_id:
                content = (entry.get("message") or {}).get("content") or []
                tool_use_id = content[0].get("tool_use_id") if content else None
                info = tool_use_map.get(tool_use_id or "", {})
                agent_links[agent_id] = {
                    "tool_use_id": tool_use_id,
                    "subagent_type": info.get("subagent_type", "general-purpose"),
                    "description": info.get("description", ""),
                    "prompt": info.get("prompt", ""),
                    "status": tur.get("status", "completed") if isinstance(tur, dict) else "completed",
                }

    return tool_use_map, agent_links


def build_agent_tree(session_id: str, root_transcript_path: str) -> dict:
    """
    Build the full agent hierarchy tree from transcripts.

    Returns a dict of agents keyed by agent_id (or 'root'), each with:
        agent_id, parent, agent_type, description, transcript_path,
        peak_input_tokens, model, status, children
    """
    agents: dict[str, dict] = {}

    # Root agent
    root_peak, root_model = get_peak_input_tokens(root_transcript_path)
    agents["root"] = {
        "agent_id": None,
        "parent": None,
        "agent_type": "Root",
        "description": None,
        "transcript_path": root_transcript_path,
        "peak_input_tokens": root_peak,
        "model": root_model,
        "status": "completed",
        "children": [],
    }

    subagents_dir = _get_subagents_dir(root_transcript_path)
    if not subagents_dir:
        return agents

    # Build a map of all subagent transcripts on disk
    all_subagent_files: dict[str, Path] = {}
    for f in subagents_dir.glob("agent-*.jsonl"):
        agent_id = f.stem.replace("agent-", "")
        all_subagent_files[agent_id] = f

    # BFS: process transcripts to find child relationships
    # Start with root transcript
    to_process = [("root", root_transcript_path)]
    visited_transcripts = set()

    while to_process:
        parent_key, transcript_path = to_process.pop(0)
        if transcript_path in visited_transcripts:
            continue
        visited_transcripts.add(transcript_path)

        _, agent_links = _parse_agent_links(transcript_path)

        for agent_id, link_info in agent_links.items():
            if agent_id in agents:
                continue  # already processed

            # Get transcript for this subagent
            subagent_file = all_subagent_files.get(agent_id)
            subagent_transcript = str(subagent_file) if subagent_file else None

            # Get token data
            peak = 0
            model = "claude-sonnet-4-6"
            if subagent_transcript:
                peak, model = get_peak_input_tokens(subagent_transcript)

            # Get agent type (meta.json takes priority over transcript inference)
            agent_type = link_info.get("subagent_type", "general-purpose")
            if subagent_file:
                meta_type = _infer_agent_type_from_meta(subagent_file)
                if meta_type:
                    agent_type = meta_type

            agents[agent_id] = {
                "agent_id": agent_id,
                "parent": parent_key,
                "agent_type": agent_type,
                "description": link_info.get("description", ""),
                "prompt_preview": link_info.get("prompt", ""),
                "transcript_path": subagent_transcript,
                "peak_input_tokens": peak,
                "model": model,
                "status": link_info.get("status", "completed"),
                "children": [],
            }

            # Add as child of parent
            if parent_key in agents:
                agents[parent_key]["children"].append(agent_id)

            # Queue this subagent's transcript for processing (finds its children)
            if subagent_transcript:
                to_process.append((agent_id, subagent_transcript))

    return agents


# ---------------------------------------------------------------------------
# CLI entry points
# ---------------------------------------------------------------------------

def cmd_init(args):
    init_state(args.session_id, args.transcript_path, args.cwd)


def cmd_update(args):
    """Called by subagent-stop.sh with hook input JSON."""
    try:
        hook_input = json.loads(args.hook_input)
    except Exception:
        sys.exit(0)

    session_id = hook_input.get("session_id", "")
    transcript_path = hook_input.get("transcript_path", "")

    if not session_id or not transcript_path:
        sys.exit(0)

    # Find the agent_id from the subagent transcript path
    # transcript_path for SubagentStop points to the subagent's own transcript
    p = Path(transcript_path)
    agent_id = p.stem.replace("agent-", "")

    peak, model = get_peak_input_tokens(transcript_path)
    update_agent_in_state(session_id, agent_id, peak, model, "completed")


def cmd_terminate(args):
    mark_terminated(args.session_id)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Agent Conductor core library")
    sub = parser.add_subparsers(dest="command")

    p_init = sub.add_parser("init")
    p_init.add_argument("--session-id", required=True)
    p_init.add_argument("--transcript-path", required=True)
    p_init.add_argument("--cwd", required=True)

    p_update = sub.add_parser("update")
    p_update.add_argument("--session-id", required=True)
    p_update.add_argument("--hook-input", required=True)

    p_terminate = sub.add_parser("terminate")
    p_terminate.add_argument("--session-id", required=True)

    args = parser.parse_args()
    if args.command == "init":
        cmd_init(args)
    elif args.command == "update":
        cmd_update(args)
    elif args.command == "terminate":
        cmd_terminate(args)
    else:
        parser.print_help()
        sys.exit(1)
