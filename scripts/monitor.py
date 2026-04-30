#!/usr/bin/env python3
"""
monitor.py — Mode 2: Live terminal monitor for running agent flows.

Auto-discovers the most recently active Agent Conductor state file and
displays a live-updating tree of agents and their context window usage.

Usage:
    python3 monitor.py [--session-id <id>]

Run this in a separate terminal window while Claude Code is active.
Press Ctrl+C or q to exit.
"""

import argparse
import curses
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict

sys.path.insert(0, str(Path(__file__).parent))
from conductor import STATE_DIR, MODEL_MAX_TOKENS, calc_context_pct, get_peak_input_tokens

REFRESH_INTERVAL = 2  # seconds
WARN_THRESHOLD = 70


# ---------------------------------------------------------------------------
# State loading + live token reading
# ---------------------------------------------------------------------------

def find_latest_state_file() -> Optional[Path]:
    """Find the most recently modified state file in STATE_DIR."""
    if not STATE_DIR.exists():
        return None
    candidates = list(STATE_DIR.glob("*.json"))
    if not candidates:
        return None
    # Exclude .tmp files
    candidates = [f for f in candidates if not f.suffix == ".tmp"]
    return max(candidates, key=lambda f: f.stat().st_mtime)


def load_state_file(path: Path) -> Optional[dict]:
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def get_current_tokens_live(transcript_path: Optional[str]) -> int:
    """
    Read the last 50 lines of a running transcript to get the most recent
    input token count. Avoids re-reading the whole file.
    """
    if not transcript_path or not Path(transcript_path).exists():
        return 0

    try:
        with open(transcript_path, "rb") as f:
            # Seek to end, read last ~8KB for recent lines
            f.seek(0, 2)
            size = f.tell()
            chunk = min(size, 16384)
            f.seek(-chunk, 2)
            tail = f.read().decode("utf-8", errors="replace")
    except Exception:
        return 0

    lines = [l.strip() for l in tail.splitlines() if l.strip()]
    lines = lines[-50:]  # last 50 lines

    best_input = 0
    for line in reversed(lines):
        try:
            entry = json.loads(line)
        except Exception:
            continue
        if entry.get("type") != "assistant":
            continue
        usage = (entry.get("message") or {}).get("usage")
        if not usage:
            continue
        total = (
            (usage.get("input_tokens") or 0)
            + (usage.get("cache_creation_input_tokens") or 0)
            + (usage.get("cache_read_input_tokens") or 0)
        )
        if total > best_input:
            best_input = total
        break  # got the most recent, stop

    return best_input


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

def _elapsed(started_at: Optional[str]) -> str:
    if not started_at:
        return ""
    try:
        start = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
        delta = datetime.now(timezone.utc) - start
        s = int(delta.total_seconds())
        m, sec = divmod(s, 60)
        h, m = divmod(m, 60)
        if h:
            return f"{h}h{m:02d}m"
        return f"{m:02d}m{sec:02d}s"
    except Exception:
        return ""


def _bar(pct: float, width: int = 20) -> str:
    filled = round(pct / 100 * width)
    filled = max(0, min(filled, width))
    return "█" * filled + "░" * (width - filled)


def _render_lines(state: dict, live_tokens: dict[str, int]) -> list[tuple[str, int]]:
    """
    Build list of (text, attr) tuples for curses display.
    attr: 0=normal, 1=bold, 2=warn(red), 3=dim, 4=green
    """
    lines = []
    agents = state.get("agents", {})
    session_id = state.get("session_id", "?")
    cwd = state.get("cwd", "")
    started_at = state.get("agents", {}).get("root", {}).get("started_at")

    short_id = session_id[:8]
    project = Path(cwd).name if cwd else "?"
    elapsed = _elapsed(started_at)

    lines.append((f"  Agent Conductor — Live Monitor", 1))
    lines.append((f"  Session: {short_id}  |  Project: {project}  |  Elapsed: {elapsed}  |  Refresh: {REFRESH_INTERVAL}s", 0))
    lines.append(("  " + "─" * 60, 3))
    lines.append(("", 0))

    def render_agent(agent_key: str, indent: int, is_last: bool, parent_prefix: str):
        agent = agents.get(agent_key)
        if not agent:
            return

        connector = "└── " if is_last else "├── "
        child_prefix = parent_prefix + ("    " if is_last else "│   ")

        peak = live_tokens.get(agent_key, agent.get("peak_input_tokens", 0))
        pct = calc_context_pct(peak)
        bar = _bar(pct)
        status = agent.get("status", "?")
        agent_type = agent.get("agent_type") or "?"
        description = agent.get("description") or agent.get("prompt_preview") or ""
        if len(description) > 45:
            description = description[:42] + "..."

        is_running = status == "running"
        is_pending = agent.get("pending", False)

        if agent_key == "root":
            model = re.sub(r"-\d{6,}$", "", (agent.get("model") or "").replace("claude-", ""))
            label = f"  Root  ({model})"
            pct_str = f"{pct:5.1f}%"
            warn = "  ⚠" if pct >= WARN_THRESHOLD else ""
            lines.append((f"{label}", 1))
            lines.append((f"       {pct_str}  [{bar}]  {status}{warn}", 2 if pct >= WARN_THRESHOLD else (4 if is_running else 0)))
        elif is_pending:
            label = f"  {parent_prefix}{connector}[{agent_type}]"
            desc_str = f' "{description}"' if description else ""
            lines.append((f"{label}{desc_str}  (starting...)", 3))
        else:
            label = f"  {parent_prefix}{connector}[{agent_type}]"
            desc_str = f' "{description}"' if description else ""
            pct_str = f"{pct:5.1f}%"
            warn = "  ⚠" if pct >= WARN_THRESHOLD else ""
            elapsed_str = f"  ({_elapsed(agent.get('started_at'))})" if is_running else ""
            lines.append((f"{label}{desc_str}", 1 if is_running else 0))
            attr = 2 if pct >= WARN_THRESHOLD else (4 if is_running else 3)
            lines.append((f"  {child_prefix}     {pct_str}  [{bar}]  {status}{elapsed_str}{warn}", attr))

        children = [c for c in (agent.get("children") or []) if c in agents]
        for i, child_id in enumerate(children):
            render_agent(child_id, indent + 1, i == len(children) - 1, child_prefix)

    render_agent("root", 0, True, "")

    lines.append(("", 0))
    running_count = sum(1 for a in agents.values() if a.get("status") == "running")
    total = len(agents)
    warn_count = sum(1 for a in agents.values() if calc_context_pct(a.get("peak_input_tokens", 0)) >= WARN_THRESHOLD)
    lines.append((f"  Agents: {total} total  |  {running_count} running", 0))
    if warn_count:
        lines.append((f"  ⚠  {warn_count} agent(s) >{WARN_THRESHOLD}% context used", 2))
    lines.append((f"  Context window: {MODEL_MAX_TOKENS // 1000}k tokens per agent", 3))
    lines.append(("", 0))
    lines.append(("  Press q or Ctrl+C to exit", 3))

    return lines


# ---------------------------------------------------------------------------
# Main curses loop
# ---------------------------------------------------------------------------

def monitor_loop(stdscr, state_file: Path):
    curses.use_default_colors()
    curses.curs_set(0)

    # Set up color pairs
    try:
        curses.start_color()
        curses.init_pair(1, curses.COLOR_WHITE, -1)   # bold (normal)
        curses.init_pair(2, curses.COLOR_RED, -1)      # warn
        curses.init_pair(3, curses.COLOR_WHITE, -1)    # dim
        curses.init_pair(4, curses.COLOR_GREEN, -1)    # running/good
        has_color = True
    except Exception:
        has_color = False

    stdscr.nodelay(True)  # non-blocking getch
    stdscr.timeout(REFRESH_INTERVAL * 1000)

    while True:
        # Check for quit key
        key = stdscr.getch()
        if key in (ord('q'), ord('Q'), 27):  # q, Q, Esc
            break

        # Load state
        state = load_state_file(state_file)
        if state is None:
            stdscr.clear()
            stdscr.addstr(0, 0, "Waiting for Agent Conductor state file...")
            stdscr.refresh()
            continue

        # Get live token counts for running agents
        live_tokens: Dict[str, int] = {}
        agents = state.get("agents", {})
        for agent_key, agent in agents.items():
            if agent.get("status") == "running" and not agent.get("pending"):
                transcript = agent.get("transcript_path")
                current = get_current_tokens_live(transcript)
                if current > 0:
                    live_tokens[agent_key] = current

        # Render
        render_lines = _render_lines(state, live_tokens)

        stdscr.clear()
        max_y, max_x = stdscr.getmaxyx()

        for row, (text, attr) in enumerate(render_lines):
            if row >= max_y - 1:
                break
            # Truncate to terminal width
            text = text[:max_x - 1]
            try:
                if has_color and attr == 1:
                    stdscr.addstr(row, 0, text, curses.A_BOLD)
                elif has_color and attr == 2:
                    stdscr.addstr(row, 0, text, curses.color_pair(2) | curses.A_BOLD)
                elif has_color and attr == 3:
                    stdscr.addstr(row, 0, text, curses.A_DIM)
                elif has_color and attr == 4:
                    stdscr.addstr(row, 0, text, curses.color_pair(4))
                else:
                    stdscr.addstr(row, 0, text)
            except curses.error:
                pass  # terminal too small

        stdscr.refresh()

        # Check if session terminated
        if state.get("terminated"):
            time.sleep(3)  # stay visible briefly after session ends
            break


def main():
    parser = argparse.ArgumentParser(description="Agent Conductor: live terminal monitor")
    parser.add_argument("--session-id", help="Specific session ID to monitor (default: latest)")
    args = parser.parse_args()

    if args.session_id:
        state_file = STATE_DIR / f"{args.session_id}.json"
        if not state_file.exists():
            print(f"No state file found for session: {args.session_id}")
            sys.exit(1)
    else:
        state_file = find_latest_state_file()
        if not state_file:
            print(f"No Agent Conductor state files found in {STATE_DIR}")
            print("Start a Claude Code session first, then run this monitor.")
            sys.exit(1)

    print(f"Monitoring: {state_file.stem[:8]}...")
    print("Starting live monitor... (Press q to exit)")
    time.sleep(0.5)

    try:
        curses.wrapper(monitor_loop, state_file)
    except KeyboardInterrupt:
        pass

    print("\nMonitor exited.")


if __name__ == "__main__":
    main()
