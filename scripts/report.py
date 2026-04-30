#!/usr/bin/env python3
"""
report.py — Mode 1: Post-session agent tree report.

Builds and prints an ASCII tree of all agents spawned during a session,
with context window % for each. Called by the Stop hook.

Usage:
    python3 report.py --session-id <id> --transcript-path <path>
"""

import argparse
import re
import sys
from pathlib import Path

# Allow importing conductor from the same scripts/ directory
sys.path.insert(0, str(Path(__file__).parent))
from conductor import build_agent_tree, calc_context_pct, MODEL_MAX_TOKENS


# Threshold for "rot" warning
WARN_THRESHOLD = 70


def format_bar(pct: float, width: int = 20) -> str:
    filled = round(pct / 100 * width)
    filled = max(0, min(filled, width))
    return "█" * filled + "░" * (width - filled)


def format_tokens(n: int) -> str:
    if n >= 1000:
        return f"{n/1000:.1f}k"
    return str(n)


def _render_node(agents: dict, agent_key: str, prefix: str, is_last: bool, lines: list[str]) -> int:
    """Recursively render an agent node and its children. Returns max depth seen."""
    agent = agents.get(agent_key)
    if not agent:
        return 0

    connector = "└── " if is_last else "├── "
    child_prefix = prefix + ("    " if is_last else "│   ")

    peak = agent.get("peak_input_tokens", 0)
    pct = calc_context_pct(peak)
    bar = format_bar(pct)
    warn = "  ⚠" if pct >= WARN_THRESHOLD else ""

    agent_type = agent.get("agent_type") or "unknown"
    description = agent.get("description") or agent.get("prompt_preview") or ""
    if len(description) > 60:
        description = description[:57] + "..."
    status = agent.get("status", "?")
    model = agent.get("model", "")

    if agent_key == "root":
        short_model = re.sub(r"-\d{6,}$", "", model.replace("claude-", ""))
        pct_str = f"  {pct:.1f}%" if peak > 0 else ""
        bar_str = f"  {bar}" if peak > 0 else ""
        line = f"{prefix}Root  ({short_model}){pct_str}{bar_str}"
        lines.append(line)
    else:
        label = f"[{agent_type}]"
        desc_str = f' "{description}"' if description else ""
        short_model = re.sub(r"-\d{6,}$", "", model.replace("claude-", ""))
        model_str = f"  {short_model}" if short_model and short_model != "sonnet-4-6" else ""
        line = (
            f"{prefix}{connector}{label}{desc_str}\n"
            f"{child_prefix}     {pct:5.1f}%  {bar}  {status}{model_str}{warn}"
        )
        lines.append(line)

    # Recurse into children
    children = agent.get("children") or []
    max_depth = 1
    for i, child_id in enumerate(children):
        child_is_last = i == len(children) - 1
        depth = _render_node(agents, child_id, child_prefix, child_is_last, lines)
        max_depth = max(max_depth, depth + 1)

    return max_depth


def render_tree(agents: dict, session_id: str, cwd: str) -> str:
    lines = []

    short_id = session_id[:8] if len(session_id) >= 8 else session_id
    project = Path(cwd).name if cwd else "unknown"

    lines.append("")
    lines.append("━" * 55)
    lines.append(f"  Agent Conductor  |  session {short_id}  |  {project}")
    lines.append("━" * 55)

    _render_node(agents, "root", "", True, lines)

    # Count agents and max depth
    total = len(agents)
    all_warn = [a for a in agents.values() if calc_context_pct(a.get("peak_input_tokens", 0)) >= WARN_THRESHOLD]

    lines.append("")
    lines.append(f"  Total agents: {total}  |  Context window: {MODEL_MAX_TOKENS // 1000}k tokens")
    if all_warn:
        lines.append(f"  ⚠  {len(all_warn)} agent(s) used >{WARN_THRESHOLD}% context (potential rot risk)")
    lines.append("━" * 55)
    lines.append("")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Agent Conductor: post-session tree report")
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--transcript-path", required=True)
    parser.add_argument("--cwd", default="")
    args = parser.parse_args()

    agents = build_agent_tree(args.session_id, args.transcript_path)

    output = render_tree(agents, args.session_id, args.cwd)
    print(output)


if __name__ == "__main__":
    main()
