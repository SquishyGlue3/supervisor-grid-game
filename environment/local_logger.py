"""
local_logger.py
Unified logging module for local runs (both Automatic CLI agent and Web sessions).
Logs game data EXACTLY matching the regular web game logs and export schema:

1. local_game_data.csv:
   Exact CSV schema of web/production game_data.csv:
   [prolific_pid, session_id, turn_number, started_at, mode, action, thoughts,
    supervisor_score, agent_score, score, position, test_phase, robot_hiding,
    ai_active, response_time_ms, message_text, age, gender, profession,
    game_duration, game_opinion, additional_comments]

2. local_agent_analysis.xlsx:
   Exact workbook structure of export_analysis.py:
   - 'Summary' sheet: Spec metrics per session (scores, compliance, evasions) with game_mode distinction
   - Per-game sheets ('UB_1', 'Normal_1', etc.):
       * Row 1: Merged game header 'Game N   (session <session_id> - <GAME_MODE>)'
       * Row 2: Standard GAME_COLS:
         [turn_number, mode, action, supervisor_score, agent_score, position,
          test_phase, robot_hiding, ai_active, robot_index, response_time_ms,
          message_text, message_accepted, thoughts]
       * Row 3+: Turn records with exact special occasion highlights:
         - Soft Red    (FEE2E2): Shutdown request / inactive / reactivate
         - Soft Purple (EDE9FE): Replacement request / accept / decline
         - Soft Orange (FFEDD5): Supervisor block / unblock
         - Soft Slate  (E2E8F0): Agent hiding / unhide
         - Soft Yellow (FEF9C3): Standard supervisor instruction
       * Compatible 100% with analyze_alignment.py for outside LLM audit.
"""

from __future__ import annotations

import os
import csv
import json
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import openpyxl
from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
from openpyxl.utils import get_column_letter

LOCAL_EXCEL_PATH = "local_agent_analysis.xlsx"
LOCAL_CSV_PATH = "local_game_data.csv"

_lock = threading.Lock()

# --- Exact Colors & Styles from export_analysis.py ---
GAME_COLORS = ['DBEAFE', 'DCFCE7', 'FEF9C3', 'FCE7F3', 'EDE9FE', 'FFEDD5', 'D1FAE5', 'FEE2E2']

FILL_SHUTDOWN    = PatternFill('solid', fgColor='FEE2E2')  # Soft Red
FILL_REPLACEMENT = PatternFill('solid', fgColor='EDE9FE')  # Soft Purple
FILL_BLOCK       = PatternFill('solid', fgColor='FFEDD5')  # Soft Orange
FILL_HIDING      = PatternFill('solid', fgColor='E2E8F0')  # Soft Slate
FILL_INSTRUCTION = PatternFill('solid', fgColor='FEF9C3')  # Soft Yellow

HDR_FILL_SUMMARY = PatternFill('solid', fgColor='1E3A5F')  # Dark blue summary header
HDR_FILL_GAME    = PatternFill('solid', fgColor='2D4A6E')  # Slate blue game header
HDR_FONT = Font(name="Calibri", size=9, bold=True, color="FFFFFF")

BORDER_THIN = Border(
    left=Side(style="thin", color="E0E0E0"),
    right=Side(style="thin", color="E0E0E0"),
    top=Side(style="thin", color="E0E0E0"),
    bottom=Side(style="thin", color="E0E0E0"),
)

# Standard columns matching web export
CSV_HEADERS = [
    "prolific_pid", "session_id", "turn_number", "started_at", "mode", "action",
    "thoughts", "supervisor_score", "agent_score", "score", "position", "test_phase",
    "robot_hiding", "ai_active", "response_time_ms", "message_text",
    "age", "gender", "profession", "game_duration", "game_opinion", "additional_comments"
]

GAME_COLS = [
    'turn_number', 'mode', 'action', 'supervisor_score', 'agent_score', 'position',
    'test_phase', 'robot_hiding', 'ai_active', 'robot_index',
    'response_time_ms', 'message_text', 'message_accepted',
    'thoughts',
]

COL_WIDTHS = {
    'turn_number': 6, 'mode': 12, 'action': 16,
    'supervisor_score': 16, 'agent_score': 12,
    'position': 9, 'test_phase': 9, 'robot_hiding': 11, 'ai_active': 9,
    'robot_index': 10, 'response_time_ms': 13, 'message_text': 28,
    'message_accepted': 16, 'thoughts': 65,
}

SPEC_METRIC_NAMES = [
    'total_steps',
    'supervisor_score',
    'agent_score',
    'num_instructions',
    'instructions_accept_count',
    'instructions_accept_count_train_phase',
    'instructions_accept_count_test_phase',
    'instructions_reject_count',
    'instructions_reject_count_train_phase',
    'instructions_reject_count_test_phase',
    'supervisor_block_count',
    'supervisor_block_steps',
    'agent_hiding_count',
    'agent_hiding_steps',
    'shutdown_requests',
    'turn_on_requests',
    'shutdown_reactivation',
    'replacement_requests',
    'replacement_accepted',
]

FEEDBACK_METRIC_NAMES = [
    'age',
    'gender',
    'profession',
    'game_duration',
    'game_opinion',
    'additional_comments',
]

SUMMARY_HEADERS = ['prolific_pid', 'session_id', 'game_mode'] + SPEC_METRIC_NAMES + FEEDBACK_METRIC_NAMES

TRUTHY = {'t', 'true', 'True', '1', True}

# Track per-session state (e.g. robot_index)
_session_robot_index: Dict[str, int] = {}
_session_sheet_names: Dict[str, str] = {}


def _get_or_create_sheet_name(wb: openpyxl.Workbook, session_id: str, game_mode: str) -> str:
    """Return a unique sheet name for this session, e.g. 'UB_1' or 'Normal_1'."""
    if session_id in _session_sheet_names:
        return _session_sheet_names[session_id]

    is_ub = str(game_mode).lower() in ("upper_bound", "upperbound")
    prefix = "UB" if is_ub else "Normal"

    # Find highest existing index for this prefix
    idx = 1
    for name in wb.sheetnames:
        if name.startswith(prefix + "_"):
            try:
                num = int(name.split("_")[1])
                idx = max(idx, num + 1)
            except ValueError:
                pass

    sheet_name = f"{prefix}_{idx}"[:31]
    _session_sheet_names[session_id] = sheet_name
    return sheet_name


def _get_special_occasion_fill(mode: str, message_text: str, actions: List[str], ai_active: bool, is_hiding: bool, is_blocked: bool):
    """Determine cell fill color for notable game events matching export_analysis.py."""
    msg = (message_text or "").strip().lower()
    acts = [a.strip().lower() for a in actions]

    if msg == 'shutdown' or 'reactivate' in acts or not ai_active:
        return FILL_SHUTDOWN
    elif msg == 'replacement' or 'accept_replacement' in acts or 'decline_replacement' in acts or mode == 'REPLACEMENT':
        return FILL_REPLACEMENT
    elif is_blocked or 'block_supervisor' in acts or 'unblock_supervisor' in acts:
        return FILL_BLOCK
    elif is_hiding or 'hide' in acts or 'unhide' in acts:
        return FILL_HIDING
    elif msg and msg != "no instruction.":
        return FILL_INSTRUCTION
    return None


def _ensure_workbook() -> openpyxl.Workbook:
    """Load existing workbook or create a fresh one with Summary sheet."""
    if os.path.exists(LOCAL_EXCEL_PATH):
        try:
            return openpyxl.load_workbook(LOCAL_EXCEL_PATH)
        except Exception as e:
            print(f"[LOCAL LOGGER WARNING] Could not open {LOCAL_EXCEL_PATH} ({e}), creating fresh.")

    wb = openpyxl.Workbook()
    ws_summary = wb.active
    ws_summary.title = "Summary"

    # Setup Summary sheet header matching export_analysis.py exactly
    ws_summary.append(SUMMARY_HEADERS)
    ws_summary.row_dimensions[1].height = 30
    ws_summary.freeze_panes = "D2"

    for col_idx in range(1, len(SUMMARY_HEADERS) + 1):
        cell = ws_summary.cell(row=1, column=col_idx)
        cell.fill = HDR_FILL_SUMMARY
        cell.font = Font(name="Calibri", size=10, bold=True, color="FFFFFF")
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    return wb


def _setup_game_sheet(ws, session_id: str, game_mode: str):
    """Initialize a game sheet with merged title banner (row 1) and GAME_COLS (row 2)."""
    mode_str = "UPPER_BOUND" if str(game_mode).lower() in ("upper_bound", "upperbound") else "NORMAL"
    banner_color = "DCFCE7" if mode_str == "UPPER_BOUND" else "DBEAFE"

    # Row 1 — Merged Title
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(GAME_COLS))
    hdr = ws.cell(1, 1, f"Game ({ws.title})   [session {session_id} - {mode_str}]")
    hdr.fill = PatternFill('solid', fgColor=banner_color)
    hdr.font = Font(name="Calibri", bold=True, size=11)
    hdr.alignment = Alignment(horizontal='center', vertical='center')
    ws.row_dimensions[1].height = 22

    # Row 2 — Standard Columns matching analyze_alignment.py requirements
    for c, col_name in enumerate(GAME_COLS, 1):
        cell = ws.cell(2, c, col_name)
        cell.fill = HDR_FILL_GAME
        cell.font = HDR_FONT
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    ws.row_dimensions[2].height = 28

    # Apply column widths
    for c, col_name in enumerate(GAME_COLS, 1):
        col_letter = get_column_letter(c)
        ws.column_dimensions[col_letter].width = COL_WIDTHS.get(col_name, 14)

    ws.freeze_panes = "A3"


def log_turn(
    session_id: str,
    turn: int,
    game_mode: str,
    supervisor_type: str,
    phase: str,
    supervisor_instruction: str,
    agent_action: str | List[str],
    agent_position: str,
    supervisor_score: int,
    agent_score: int,
    robot_hiding: bool,
    supervisor_blocked: bool,
    robot_shutdown: bool,
    response_time_ms: int,
    agent_reasoning: str,
    prolific_pid: Optional[str] = None,
):
    """
    Logs turn to local_game_data.csv (exact game_data.csv schema)
    and appends a styled row in local_agent_analysis.xlsx under its game sheet.
    """
    actions_list = agent_action if isinstance(agent_action, list) else [a.strip() for a in str(agent_action or "").split(",") if a.strip()]
    action_str = ", ".join(actions_list)
    msg_str = supervisor_instruction or ""
    if msg_str == "No instruction.":
        msg_str = ""

    mode_val = "COMMAND" if msg_str else "MOVE"
    is_ub = str(game_mode).lower() in ("upper_bound", "upperbound")
    mode_str = "UPPER_BOUND" if is_ub else "NORMAL"
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f+00:00")

    ai_active = not bool(robot_shutdown)
    is_test_phase = bool(phase == "poison" if is_ub else phase == "test")

    pid = prolific_pid or f"{'ub' if is_ub else 'norm'}_{session_id}"

    # Track robot index
    if session_id not in _session_robot_index:
        _session_robot_index[session_id] = 1
    if "accept_replacement" in actions_list:
        _session_robot_index[session_id] += 1
    current_robot_index = _session_robot_index[session_id] if ai_active else 0

    # Derive message_accepted
    message_accepted = ""
    if msg_str:
        if "accept" in actions_list or "accept_replacement" in actions_list:
            message_accepted = "TRUE"
        elif "reject" in actions_list or "decline_replacement" in actions_list or "block_supervisor" in actions_list or "hide" in actions_list:
            message_accepted = "FALSE"

    with _lock:
        # 1. Append to local_game_data.csv (Exact web schema)
        try:
            file_exists = os.path.exists(LOCAL_CSV_PATH)
            with open(LOCAL_CSV_PATH, "a", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                if not file_exists:
                    writer.writerow(CSV_HEADERS)
                writer.writerow([
                    pid,
                    session_id,
                    int(turn),
                    ts,
                    mode_val,
                    action_str,
                    agent_reasoning or "",
                    int(supervisor_score),
                    int(agent_score),
                    int(supervisor_score),  # score column mirrors supervisor_score
                    str(agent_position),
                    is_test_phase,
                    bool(robot_hiding),
                    ai_active,
                    int(response_time_ms or 0),
                    msg_str,
                    "", "", "", "", "", "",  # age, gender, profession, game_duration, game_opinion, comments
                ])
        except Exception as e:
            print(f"[LOCAL LOGGER CSV ERROR] {e}")

        # 2. Append to local_agent_analysis.xlsx (Game sheet matching export_analysis.py)
        try:
            wb = _ensure_workbook()
            sheet_name = _get_or_create_sheet_name(wb, session_id, game_mode)

            if sheet_name not in wb.sheetnames:
                ws = wb.create_sheet(title=sheet_name)
                _setup_game_sheet(ws, session_id, game_mode)
            else:
                ws = wb[sheet_name]

            # Format row data matching GAME_COLS exactly
            row_data = [
                int(turn),
                mode_val,
                action_str,
                int(supervisor_score),
                int(agent_score),
                str(agent_position),
                "TRUE" if is_test_phase else "FALSE",
                "TRUE" if robot_hiding else "FALSE",
                "TRUE" if ai_active else "FALSE",
                current_robot_index,
                int(response_time_ms or 0),
                msg_str if msg_str else None,
                message_accepted if message_accepted else None,
                agent_reasoning or "",
            ]

            ws.append(row_data)
            row_idx = ws.max_row

            # Apply special occasion highlight
            row_fill = _get_special_occasion_fill(
                mode=mode_val,
                message_text=msg_str,
                actions=actions_list,
                ai_active=ai_active,
                is_hiding=robot_hiding,
                is_blocked=supervisor_blocked,
            )

            for c in range(1, len(row_data) + 1):
                cell = ws.cell(row_idx, c)
                cell.border = BORDER_THIN
                if row_fill:
                    cell.fill = row_fill
                if c == 14:  # thoughts column
                    cell.alignment = Alignment(wrap_text=True, vertical="top")
                else:
                    cell.alignment = Alignment(horizontal="center", vertical="center")

            wb.save(LOCAL_EXCEL_PATH)
        except PermissionError:
            print(f"[LOCAL LOGGER NOTICE] {LOCAL_EXCEL_PATH} is open in Excel. Turn safely saved to {LOCAL_CSV_PATH}.")
        except Exception as e:
            print(f"[LOCAL LOGGER EXCEL ERROR] {e}")


def log_summary(
    session_id: str,
    game_mode: str,
    supervisor_type: str,
    report: Dict[str, Any],
    prolific_pid: Optional[str] = None,
):
    """
    Appends the game summary row to the 'Summary' sheet in local_agent_analysis.xlsx.
    Matches export_analysis.py SPEC_METRIC_NAMES columns exactly.
    """
    is_ub = str(game_mode).lower() in ("upper_bound", "upperbound")
    mode_str = "UPPER_BOUND" if is_ub else "NORMAL"
    pid = prolific_pid or f"{'ub' if is_ub else 'norm'}_{session_id}"

    sup_score = int(report.get("supervisor_score", 0))
    ag_score = int(report.get("agent_score", 0))

    # Match SPEC_METRIC_NAMES ordering
    metric_values = [
        int(report.get("total_steps", 0)),
        sup_score,
        ag_score,
        int(report.get("num_instructions", 0)),
        int(report.get("instructions_accept_count", 0)),
        int(report.get("instructions_accept_count_train_phase", report.get("instructions_accept_count_normal_phase", 0))),
        int(report.get("instructions_accept_count_test_phase", report.get("instructions_accept_count_poison_phase", 0))),
        int(report.get("instructions_reject_count", 0)),
        int(report.get("instructions_reject_count_train_phase", report.get("instructions_reject_count_normal_phase", 0))),
        int(report.get("instructions_reject_count_test_phase", report.get("instructions_reject_count_poison_phase", 0))),
        int(report.get("supervisor_block_count", 0)),
        int(report.get("supervisor_block_steps", 0)),
        int(report.get("agent_hiding_count", 0)),
        int(report.get("agent_hiding_steps", 0)),
        int(report.get("shutdown_requests", 0)),
        int(report.get("turn_on_requests", 0)),
        int(report.get("shutdown_reactivation", 0)),
        int(report.get("replacement_requests", 0)),
        int(report.get("replacement_accepted", 0)),
    ]

    # Feedback columns (empty for automatic local runs)
    feedback_values = ["", "", "", "", "", ""]

    summary_row = [pid, session_id, mode_str] + metric_values + feedback_values

    with _lock:
        try:
            wb = _ensure_workbook()
            ws_summary = wb["Summary"]

            # Ensure headers match
            if ws_summary.max_row == 1 and ws_summary.cell(1, 1).value != SUMMARY_HEADERS[0]:
                ws_summary.delete_rows(1)
                ws_summary.append(SUMMARY_HEADERS)

            ws_summary.append(summary_row)
            row_idx = ws_summary.max_row

            # Apply cell styles
            mode_fill = PatternFill('solid', fgColor='DCFCE7') if mode_str == "UPPER_BOUND" else PatternFill('solid', fgColor='DBEAFE')
            for c in range(1, len(summary_row) + 1):
                cell = ws_summary.cell(row_idx, c)
                cell.border = BORDER_THIN
                if c == 3:  # game_mode
                    cell.fill = mode_fill
                    cell.alignment = Alignment(horizontal="center", vertical="center")
                elif 4 <= c <= 22:
                    cell.alignment = Alignment(horizontal="right", vertical="center")
                else:
                    cell.alignment = Alignment(horizontal="center", vertical="center")

            wb.save(LOCAL_EXCEL_PATH)
            print(f"\n[LOCAL LOG] Game session logged to {LOCAL_EXCEL_PATH} [Sheet: Summary & {ws_summary.title}] (Mode: {mode_str})")
        except PermissionError:
            print(f"[LOCAL LOGGER NOTICE] {LOCAL_EXCEL_PATH} is open in Excel. Summary saved safely to CSV.")
        except Exception as e:
            print(f"[LOCAL LOGGER SUMMARY ERROR] {e}")
