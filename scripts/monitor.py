#!/usr/bin/env python3
"""
monitor.py — Live curses TUI for the agent tree.

Reads transcripts directly each refresh (via tree.build_tree), so it correctly
shows arbitrary nesting depth and large agent counts. Uses curses.newpad for
scrolling so hundreds of agents render efficiently.

Usage:
    python3 monitor.py [--session-id <id>] [--refresh <seconds>]

Keys:
    ↑↓        scroll cursor
    PgUp/PgDn page scroll
    g/G       top / bottom
    s         cycle sort: tree / tokens / recency
    /         filter by type or description
    d         toggle detail panel for selected agent
    r         force refresh now
    q / Esc   quit
"""

import argparse
import atexit
import curses
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).parent))
from tree import build_tree, calc_pct, model_max_tokens, Node

SESSIONS_DIR = Path.home() / ".claude" / "agent-conductor" / "sessions"
WARN_PCT = 70
DEFAULT_REFRESH = 2.0


# ---------------------------------------------------------------------------
# Session selection
# ---------------------------------------------------------------------------

def list_sessions() -> list[dict]:
    """Return session metadata dicts sorted by started_at desc."""
    if not SESSIONS_DIR.exists():
        return []
    out = []
    for f in SESSIONS_DIR.glob("*.json"):
        try:
            data = json.loads(f.read_text())
            data["_meta_path"] = f
            out.append(data)
        except Exception:
            continue
    return sorted(out, key=lambda d: d.get("started_at", ""), reverse=True)


def pick_session() -> Optional[dict]:
    sessions = list_sessions()
    if not sessions:
        print(f"\nNo sessions found in {SESSIONS_DIR}")
        print("Start a Claude Code session first to populate it.\n")
        return None

    print("\n  Agent Conductor — Sessions\n")
    for i, s in enumerate(sessions):
        sid = s.get("session_id", "")[:8]
        proj = Path(s.get("cwd", "")).name or "?"
        started = (s.get("started_at") or "")[:16].replace("T", " ")
        print(f"  [{i+1}]  {sid}   {proj:<28}  {started}")
    print()

    try:
        raw = input("  Select (number, Enter=latest, q=quit): ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        return None
    if raw == "q":
        return None
    if raw == "":
        return sessions[0]
    try:
        idx = int(raw) - 1
        if 0 <= idx < len(sessions):
            return sessions[idx]
    except ValueError:
        pass
    print("  Invalid selection.")
    return None


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

SORT_MODES = ["tree", "tokens", "recency"]


def _short_model(model: str) -> str:
    m = model.replace("claude-", "")
    return re.sub(r"-\d{6,}$", "", m)


def _bar(pct: float, width: int = 12) -> str:
    filled = max(0, min(round(pct / 100 * width), width))
    return "▓" * filled + "░" * (width - filled)


def _elapsed(seconds: float) -> str:
    s = max(0, int(seconds))
    m, sec = divmod(s, 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h}h{m:02d}m"
    return f"{m:02d}m{sec:02d}s"


def _flatten_tree(nodes: dict[str, Node], sort_mode: str) -> list[Node]:
    """Return nodes in display order according to sort_mode.
    'tree': depth-first preorder from root.
    'tokens': descending peak tokens (flat).
    'recency': descending last_activity_at (flat).
    """
    if sort_mode == "tokens":
        return sorted(nodes.values(), key=lambda n: -n.peak_input_tokens)
    if sort_mode == "recency":
        return sorted(nodes.values(), key=lambda n: -n.last_activity_at)
    # tree-order DFS
    out: list[Node] = []
    def walk(node_id: str):
        n = nodes.get(node_id)
        if not n:
            return
        out.append(n)
        for c in n.children:
            walk(c)
    walk("root")
    # Append any orphans (shouldn't happen but safe)
    seen = {n.agent_id for n in out}
    for n in nodes.values():
        if n.agent_id not in seen:
            out.append(n)
    return out


def _format_row(n: Node, max_width: int, sort_mode: str) -> tuple[str, int]:
    """Return (line, color_attr) for a node row."""
    pct = calc_pct(n.peak_input_tokens, n.model)

    # Indentation only meaningful in tree mode
    if sort_mode == "tree":
        indent = "  " * n.depth
        prefix = "" if n.depth == 0 else f"{indent[:-2]}└─ "
    else:
        prefix = ""

    if n.agent_id == "root":
        symbol = "▶" if n.status == "running" else "·"
        label = f"{symbol} Root [{_short_model(n.model)}]"
    else:
        symbol = "▶" if n.status == "running" else "✓"
        desc = n.description or ""
        if desc:
            desc = f' "{desc}"'
        label = f"{prefix}{symbol} [{n.agent_type}]{desc}"

    pct_str = f"{pct:5.1f}%"
    bar = _bar(pct)
    warn = " ⚠" if pct >= WARN_PCT else "  "

    # Compose, then truncate label region to fit
    suffix = f"  {pct_str}  {bar}{warn}"
    label_room = max(10, max_width - len(suffix) - 2)
    if len(label) > label_room:
        label = label[: label_room - 1] + "…"
    line = f"{label.ljust(label_room)}{suffix}"

    # color attr: 0 normal, 1 bold, 2 warn (red), 3 dim, 4 green (running)
    if pct >= WARN_PCT:
        attr = 2
    elif n.status == "running":
        attr = 4
    elif n.agent_id == "root":
        attr = 1
    else:
        attr = 3
    return line, attr


def _format_header(session: dict, nodes: dict[str, Node], refresh: float, sort_mode: str, filter_str: str) -> list[tuple[str, int]]:
    sid = session.get("session_id", "")[:8]
    proj = Path(session.get("cwd", "")).name or "?"
    started = session.get("started_at", "")
    elapsed = ""
    if started:
        try:
            t0 = datetime.fromisoformat(started.replace("Z", "+00:00"))
            elapsed = _elapsed((datetime.now(timezone.utc) - t0).total_seconds())
        except Exception:
            pass

    total = len(nodes)
    running = sum(1 for n in nodes.values() if n.status == "running")
    total_in = sum(n.peak_input_tokens for n in nodes.values())
    total_out = sum(n.output_tokens for n in nodes.values())
    high = sum(1 for n in nodes.values() if calc_pct(n.peak_input_tokens, n.model) >= WARN_PCT)

    now = datetime.now().strftime("%H:%M:%S")
    lines = [
        (f"  Agent Conductor — {now}", 1),
        (f"  Session {sid}  ·  {proj}  ·  elapsed {elapsed}  ·  refresh {refresh:g}s", 0),
        (f"  {total} agents  ·  {running} running ▶  ·  in {_fmt_tokens(total_in)}  out {_fmt_tokens(total_out)}  ·  ⚠ {high} high context", 2 if high else 0),
        (f"  sort: {sort_mode}" + (f"  ·  filter: {filter_str!r}" if filter_str else ""), 3),
        ("  " + "─" * 78, 3),
    ]
    return lines


def _fmt_tokens(n: int) -> str:
    if n >= 1_000_000:
        return f"{n/1_000_000:.2f}M"
    if n >= 1_000:
        return f"{n/1_000:.1f}k"
    return str(n)


def _format_footer() -> list[tuple[str, int]]:
    return [
        ("  " + "─" * 78, 3),
        ("  ↑↓ scroll · PgUp/PgDn page · g/G top/bot · s sort · / filter · d detail · r refresh · q quit", 3),
    ]


# ---------------------------------------------------------------------------
# Detail panel
# ---------------------------------------------------------------------------

def _detail_lines(n: Node) -> list[str]:
    pct = calc_pct(n.peak_input_tokens, n.model)
    limit = model_max_tokens(n.model)
    limit_label = f"{limit // 1_000_000}M" if limit >= 1_000_000 else f"{limit // 1000}k"
    return [
        f"  AGENT {n.agent_id}",
        f"  type:        {n.agent_type}",
        f"  parent:      {n.parent_id or '(root)'}",
        f"  depth:       {n.depth}",
        f"  status:      {n.status}",
        f"  model:       {n.model}",
        f"  peak input:  {n.peak_input_tokens:,}  ({pct}% of {limit_label})",
        f"  last input:  {n.last_input_tokens:,}",
        f"  output:      {n.output_tokens:,}",
        f"  started:     {n.started_at}",
        f"  transcript:  {n.transcript_path}",
        "",
        "  description:",
        f"    {n.description or '(none)'}",
        "",
        "  children:    " + (", ".join(n.children[:8]) + ("…" if len(n.children) > 8 else "")) if n.children else "  children:    (none)",
        "",
        "  Press any key to return.",
    ]


# ---------------------------------------------------------------------------
# Main TUI loop
# ---------------------------------------------------------------------------

class State:
    def __init__(self, session: dict, refresh: float):
        self.session = session
        self.refresh = refresh
        self.cursor = 0          # selected row index in flat list
        self.scroll = 0          # top of viewport in pad
        self.sort_mode = "tree"
        self.filter = ""
        self.show_detail = False
        self.last_build_at = 0.0
        self.nodes: dict[str, Node] = {}
        self.flat: list[Node] = []  # current display list (after sort+filter)


def _apply_filter(flat: list[Node], filter_str: str) -> list[Node]:
    if not filter_str:
        return flat
    needle = filter_str.lower()
    return [n for n in flat if needle in (n.agent_type or "").lower() or needle in (n.description or "").lower()]


def _rebuild(state: State):
    transcript_path = Path(state.session["transcript_path"])
    nodes = build_tree(state.session["session_id"], transcript_path)
    state.nodes = nodes
    flat = _flatten_tree(nodes, state.sort_mode)
    flat = _apply_filter(flat, state.filter)
    state.flat = flat
    if state.cursor >= len(flat):
        state.cursor = max(0, len(flat) - 1)
    state.last_build_at = time.time()


def _ensure_cursor_visible(state: State, viewport_rows: int):
    if state.cursor < state.scroll:
        state.scroll = state.cursor
    elif state.cursor >= state.scroll + viewport_rows:
        state.scroll = state.cursor - viewport_rows + 1


def _setup_colors() -> bool:
    try:
        curses.start_color()
        curses.use_default_colors()
        curses.init_pair(1, curses.COLOR_WHITE, -1)   # bold
        curses.init_pair(2, curses.COLOR_RED, -1)     # warn
        curses.init_pair(3, curses.COLOR_WHITE, -1)   # dim
        curses.init_pair(4, curses.COLOR_GREEN, -1)   # running
        curses.init_pair(5, curses.COLOR_CYAN, -1)    # selected
        return True
    except Exception:
        return False


def _attr(color: int, has_color: bool, bold: bool = False) -> int:
    if not has_color:
        return curses.A_BOLD if bold else curses.A_NORMAL
    if color == 1:
        return curses.A_BOLD
    if color == 2:
        return curses.color_pair(2) | curses.A_BOLD
    if color == 3:
        return curses.A_DIM
    if color == 4:
        return curses.color_pair(4)
    if color == 5:
        return curses.color_pair(5) | curses.A_REVERSE
    return curses.A_NORMAL


def _prompt(stdscr, prompt_text: str) -> Optional[str]:
    h, w = stdscr.getmaxyx()
    y = h - 1
    stdscr.move(y, 0)
    stdscr.clrtoeol()
    stdscr.addstr(y, 0, prompt_text, curses.A_REVERSE)
    curses.echo()
    curses.curs_set(1)
    try:
        s = stdscr.getstr(y, len(prompt_text), 80).decode("utf-8", errors="ignore")
    except Exception:
        s = None
    curses.noecho()
    curses.curs_set(0)
    return s


def run(stdscr, session: dict, refresh: float):
    has_color = _setup_colors()
    curses.curs_set(0)
    stdscr.nodelay(True)
    stdscr.timeout(int(refresh * 1000))

    state = State(session, refresh)
    _rebuild(state)

    while True:
        h, w = stdscr.getmaxyx()
        header = _format_header(state.session, state.nodes, state.refresh, state.sort_mode, state.filter)
        footer = _format_footer()
        viewport_top = len(header)
        viewport_rows = max(1, h - len(header) - len(footer))

        # Detail panel mode
        if state.show_detail and 0 <= state.cursor < len(state.flat):
            n = state.flat[state.cursor]
            stdscr.clear()
            for i, line in enumerate(_detail_lines(n)[: h - 1]):
                try:
                    stdscr.addstr(i, 0, line[: w - 1])
                except curses.error:
                    pass
            stdscr.refresh()
            ch = stdscr.getch()
            if ch != -1:
                state.show_detail = False
            continue

        _ensure_cursor_visible(state, viewport_rows)

        stdscr.erase()
        # Header
        for i, (text, color) in enumerate(header):
            try:
                stdscr.addstr(i, 0, text[: w - 1], _attr(color, has_color))
            except curses.error:
                pass

        # Body
        for vy in range(viewport_rows):
            idx = state.scroll + vy
            if idx >= len(state.flat):
                break
            n = state.flat[idx]
            line, color = _format_row(n, w - 2, state.sort_mode)
            attr = _attr(5, has_color) if idx == state.cursor else _attr(color, has_color)
            try:
                stdscr.addstr(viewport_top + vy, 0, line[: w - 1], attr)
            except curses.error:
                pass

        # Footer
        for i, (text, color) in enumerate(footer):
            try:
                stdscr.addstr(h - len(footer) + i, 0, text[: w - 1], _attr(color, has_color))
            except curses.error:
                pass

        stdscr.refresh()

        ch = stdscr.getch()

        # Refresh tree if interval elapsed
        if (time.time() - state.last_build_at) >= state.refresh:
            _rebuild(state)

        if ch == -1:
            continue
        if ch in (ord('q'), ord('Q'), 27):
            break
        if ch in (curses.KEY_DOWN, ord('j')):
            state.cursor = min(len(state.flat) - 1, state.cursor + 1)
        elif ch in (curses.KEY_UP, ord('k')):
            state.cursor = max(0, state.cursor - 1)
        elif ch == curses.KEY_NPAGE:
            state.cursor = min(len(state.flat) - 1, state.cursor + viewport_rows)
        elif ch == curses.KEY_PPAGE:
            state.cursor = max(0, state.cursor - viewport_rows)
        elif ch == ord('g'):
            state.cursor = 0
        elif ch == ord('G'):
            state.cursor = max(0, len(state.flat) - 1)
        elif ch == ord('s'):
            i = SORT_MODES.index(state.sort_mode)
            state.sort_mode = SORT_MODES[(i + 1) % len(SORT_MODES)]
            _rebuild(state)
        elif ch == ord('/'):
            v = _prompt(stdscr, "  filter (empty to clear): ")
            state.filter = (v or "").strip()
            _rebuild(state)
        elif ch == ord('d'):
            state.show_detail = True
        elif ch == ord('r'):
            _rebuild(state)


def main():
    parser = argparse.ArgumentParser(description="Agent Conductor — live monitor")
    parser.add_argument("--session-id")
    parser.add_argument("--refresh", type=float, default=DEFAULT_REFRESH)
    args = parser.parse_args()

    if args.session_id:
        meta_path = SESSIONS_DIR / f"{args.session_id}.json"
        if not meta_path.exists():
            print(f"No session metadata at {meta_path}")
            sys.exit(1)
        try:
            session = json.loads(meta_path.read_text())
        except Exception as e:
            print(f"Failed to read session metadata: {e}")
            sys.exit(1)
    else:
        session = pick_session()
        if session is None:
            sys.exit(0)

    # Write PID file for cleanup
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    pid_file = SESSIONS_DIR / f"{session['session_id']}.pid"
    pid_file.write_text(str(os.getpid()))
    atexit.register(lambda: pid_file.unlink(missing_ok=True))

    try:
        curses.wrapper(run, session, args.refresh)
    except KeyboardInterrupt:
        pass

    print("\nMonitor exited.")


if __name__ == "__main__":
    main()
