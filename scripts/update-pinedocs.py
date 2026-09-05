#!/usr/bin/env python3
# Copyright (c) 2026 HOOX · PYNE · jango-blockchained
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Patch operator pineDocs.json with Pine Script™ v6 / 2025–2026 language surface.

Writes original HOOX-authored notes (not a TradingView® dump). Operators must
already hold a lawful offline reference at knowledge/pineDocs.json.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PATH = ROOT / "knowledge" / "pineDocs.json"


def arg(
    name: str,
    desc: str,
    *,
    required: bool = False,
    default=None,
    display_type: str = "const string",
    allowed: list[str] | None = None,
    possible=None,
) -> dict:
    return {
        "name": name,
        "desc": desc,
        "default": default,
        "required": required,
        "displayType": display_type,
        "allowedTypeIDs": allowed or [display_type],
        "possibleValues": possible,
    }


def find(docs: list[dict], name: str) -> dict | None:
    for item in docs:
        if item.get("name") == name:
            return item
    return None


def upsert(docs: list[dict], entry: dict) -> None:
    existing = find(docs, entry["name"])
    if existing is None:
        docs.append(entry)
        return
    existing.update(entry)


def has_arg(entry: dict, name: str) -> bool:
    return any(a.get("name") == name for a in entry.get("args") or [])


def append_arg(entry: dict, new_arg: dict) -> None:
    entry.setdefault("args", [])
    if not has_arg(entry, new_arg["name"]):
        entry["args"].append(new_arg)


def append_remark(entry: dict, text: str) -> None:
    remarks = entry.get("remarks")
    if remarks is None:
        entry["remarks"] = text
        return
    if isinstance(remarks, list):
        if text not in remarks:
            remarks.append(text)
        return
    if text not in str(remarks):
        entry["remarks"] = f"{remarks}  \n{text}"


def patch_existing(data: dict) -> None:
    functions = data["functions"][0]["docs"]
    types = data["types"][0]["docs"]
    methods = data["methods"][0]["docs"]
    controls = data["controls"][0]["docs"]
    variables = data["variables"][0]["docs"]
    annotations = data["annotations"][0]["docs"]
    operators = data["operators"][0]["docs"]

    # --- declaration statements ---
    for decl_name in ("indicator", "strategy", "library"):
        entry = find(functions, decl_name)
        if not entry:
            continue
        append_arg(
            entry,
            arg(
                "dynamic_requests",
                "Pine Script™ v6: when true (v6 default), request.*() may use series context "
                "arguments and may run inside loops, conditionals, and exported library functions. "
                "Set false to force the older v5 static-request rules.",
                default="true",
                display_type="const bool",
                allowed=["const bool", "input bool", "simple bool"],
            ),
        )
        if decl_name != "library":
            syntax = entry.get("syntax") or ""
            if "dynamic_requests" not in syntax:
                entry["syntax"] = syntax.rstrip(")") + ", dynamic_requests)"
        append_remark(
            entry,
            "v6: dynamic_requests defaults to true. The compiler turns the feature off automatically "
            "when a script never needs series/local request.*() calls.",
        )

    strategy = find(functions, "strategy")
    if strategy:
        append_arg(
            strategy,
            arg(
                "calc_on_every_history_tick",
                "July 2026: when true, the strategy executes once per available tick on every "
                "historical bar so high/low/close/volume update as the bar would have developed. "
                "Must be passed by name. Premium/Ultimate on standard charts. "
                "Pairs with calc_on_every_tick / calc_on_order_fills.",
                default="false",
                display_type="const bool",
                allowed=["const bool"],
            ),
        )
        syntax = strategy.get("syntax") or ""
        if "calc_on_every_history_tick" not in syntax:
            strategy["syntax"] = syntax.rstrip(")") + ", calc_on_every_history_tick)"
        append_remark(
            strategy,
            "v6: default margin_long/margin_short is 100 (v5 defaulted to 0). "
            "when= was removed from strategy.entry/order/exit/close/cancel — wrap calls in if. "
            "Orders above the 9000-trade cap are trimmed from the oldest results instead of erroring. "
            "July 2026: calc_on_every_history_tick approximates intrabar history; "
            "use_bar_magnifier now maps to the Bar detalization UI.",
        )

    # --- plots / drawings: force_overlay ---
    force = arg(
        "force_overlay",
        "v6: if true, the visual is drawn on the main chart pane even when the script occupies a separate pane.",
        default="false",
        display_type="const bool",
        allowed=["const bool", "input bool"],
    )
    for name in (
        "plot",
        "plotshape",
        "plotchar",
        "plotarrow",
        "plotbar",
        "plotcandle",
        "bgcolor",
        "barcolor",
        "hline",
        "fill",
    ):
        entry = find(functions, name)
        if not entry:
            continue
        append_arg(entry, force)
        syntax = entry.get("syntax") or ""
        if "force_overlay" not in syntax:
            if "→" in syntax:
                left, right = syntax.split("→", 1)
                left = left.rstrip()
                if left.endswith(")"):
                    left = left[:-1] + ", force_overlay)"
                entry["syntax"] = f"{left} →{right}"
            elif syntax.endswith(")"):
                entry["syntax"] = syntax[:-1] + ", force_overlay)"
        append_remark(
            entry,
            "v6: force_overlay=true pins this visual to the main pane. "
            "offset no longer accepts series values. transp= was removed — use color.new(color, transp).",
        )

    # --- input.active (July 2025) ---
    active = arg(
        "active",
        "July 2025: when false, the input is shown disabled in Settings/Inputs so users cannot change it. "
        "Use a bool expression (often another input) to toggle groups of inputs.",
        default="true",
        display_type="input bool",
        allowed=["const bool", "input bool", "simple bool", "series bool"],
    )
    for entry in functions:
        name = entry.get("name") or ""
        if name.startswith("input."):
            append_arg(entry, active)
            syntax = entry.get("syntax") or ""
            if "active" not in syntax:
                if "→" in syntax:
                    left, right = syntax.split("→", 1)
                    left = left.rstrip()
                    if left.endswith(")"):
                        left = left[:-1] + ", active)"
                    entry["syntax"] = f"{left} →{right}"

    # --- request.security dynamic ---
    req = find(functions, "request.security")
    if req:
        append_remark(
            req,
            "v6: dynamic requests are on by default. symbol/timeframe may be series strings; "
            "calls may sit inside loops, if/switch, and exported library functions. "
            "Pass dynamic_requests=false on the declaration statement to restore v5 static rules.",
        )

    # --- collections: UDT sort_field / binary search ---
    sort_field = arg(
        "sort_field",
        "April 2026 (sort) / August 2026 (binary search): for arrays/matrices of user-defined types, "
        "the field to compare. const int field index (0 = first field) or const string field name. "
        "The collection must already be sorted by the same field in ascending order for binary search.",
        default="0",
        display_type="const int|string",
        allowed=["const int", "const string"],
    )
    for name in (
        "array.sort",
        "array.sort_indices",
        "matrix.sort",
        "array.binary_search",
        "array.binary_search_leftmost",
        "array.binary_search_rightmost",
    ):
        entry = find(functions, name)
        if not entry:
            continue
        append_arg(entry, sort_field)
        syntax = entry.get("syntax") or ""
        if "sort_field" not in syntax:
            if "→" in syntax:
                left, right = syntax.split("→", 1)
                left = left.rstrip()
                if left.endswith(")"):
                    left = left[:-1] + ", sort_field)"
                entry["syntax"] = f"{left} →{right}"
        append_remark(
            entry,
            "v6: arrays accept negative indexes (from the end). "
            "UDT collections sort/search via sort_field (int index or field name).",
        )
        meth = find(methods, name)
        if meth:
            append_arg(meth, sort_field)
            append_remark(
                meth,
                "v6: UDT collections accept sort_field (const int index or const string field name).",
            )

    # --- bool / types ---
    bool_type = find(types, "bool")
    if bool_type:
        bool_type["desc"] = (
            "Keyword that declares a boolean. In Pine Script™ v6 a bool is only true or false — "
            "it cannot be na. na(), nz(), and fixnan() no longer accept bool arguments. "
            "int/float values are no longer implicitly cast to bool; wrap them with bool()."
        )
        bool_type["remarks"] = (
            "v5 allowed a third na state. In v6, unspecified if/switch branches that return bool "
            "yield false, and history of a bool on the first bar is false rather than na. "
            "Use an int/enum when you need a third state."
        )

    # --- operators ---
    for op in operators:
        if op.get("name") == "/" and "Division" in (op.get("desc") or ""):
            op["desc"] = (
                "Division. In Pine Script™ v6, dividing two const int values keeps the fractional "
                "part (5/2 == 2.5). Wrap the result with int(), math.floor(), math.ceil(), or "
                "math.round() when you need a whole number. int(5)/int(2) still truncates."
            )
            op["remarks"] = (
                "v5 used integer division only when both operands were const int. "
                "v6 always preserves the remainder for int/int unless you cast the result."
            )
        if op.get("name") in ("and", "or"):
            append_remark(
                op,
                "v6 evaluates lazily: the right-hand operand is skipped once the result is known. "
                "Keep history-dependent calls such as ta.rsi() in the global scope so they run every bar.",
            )

    # --- strategy.entry family ---
    for name in (
        "strategy.entry",
        "strategy.order",
        "strategy.exit",
        "strategy.close",
        "strategy.close_all",
        "strategy.cancel",
        "strategy.cancel_all",
    ):
        entry = find(functions, name)
        if entry:
            append_remark(
                entry,
                "v6 removed the when= parameter. Gate the call with if condition. "
                "strategy.exit() now evaluates related relative/absolute pairs (profit/limit, "
                "loss/stop, trail_points/trail_price) and uses the level the market would hit first.",
            )

    # --- timeframe.period ---
    tf = find(variables, "timeframe.period")
    if tf:
        tf["desc"] = (
            "String for the chart timeframe. v6 always includes a multiplier: "
            '"1D", "1W", "1M" (v5 omitted the 1 and returned "D"/"W"/"M"). '
            "Minutes still omit the unit (\"60\" for 60 minutes). Seconds use S, days D, weeks W, months M."
        )
        append_remark(
            tf,
            'Do not compare against "D" — use "1D". timeframe.multiplier is 1 on a daily chart.',
        )

    # --- export ---
    export = find(controls, "export")
    if export:
        export["syntax"] = (
            "export [method] <functionName>(...) =>\n"
            "    <functionBlock>\n\n"
            "export type <TypeName>\n"
            "    <fieldType> <fieldName> [= <value>]\n\n"
            "export enum <EnumName>\n"
            "    <member> [= <title>]\n\n"
            "export const <type> <name> = <value>"
        )
        export["desc"] = (
            "Prefixes library members that importers may use. v6/2025: export functions, methods, "
            "user-defined types, enums, and const values. Exported request.*() is allowed only when "
            "the importing script (or the library declaration) permits dynamic requests."
        )
        append_remark(
            export,
            "June 2025: export const TYPE name = value. export enum and export type are valid. "
            "v6 may export library functions that call request.*() under dynamic requests.",
        )

    # --- //@version ---
    version = find(annotations, "//@version=")
    if version:
        version["desc"] = (
            "Selects the Pine Script™ language version. Prefer //@version=6. "
            "Omitting the annotation compiles as v1. This is not the script revision number."
        )
        version["examples"] = (
            '//@version=6\nindicator("Pine Script™ v6")\nplot(close)'
        )
        append_remark(
            version,
            "v6 is the actively maintained language. Convert v5 with the Pine Editor "
            '"Convert code to v6" action, then fix remaining migration items '
            "(bool na, when=, transp=, int/int, timeframe.period).",
        )

    # --- history operator ---
    for op in operators:
        if op.get("name") == "[]":
            append_remark(
                op,
                "v6: cannot apply [] to literals, built-in constants, or UDT fields. "
                "Index the object first: (obj[10]).field — or assign the field to a variable, then index that. "
                "Negative array indexes count from the end.",
            )


def new_entries() -> dict[str, list[dict]]:
    """HOOX-authored v6 / 2025–2026 surface not present in the Dec 2024 dump."""
    functions = [
        {
            "name": "input.enum",
            "kind": "Built-in Function",
            "desc": (
                "Adds a dropdown input whose options are the members of a Pine Script™ v6 enum. "
                "The Settings/Inputs menu shows each member title. The returned value is an "
                "input-qualified member of that enum type — compare it with == / != or switch."
            ),
            "syntax": "input.enum(defval, title, options, tooltip, inline, group, confirm, display, active) → input enum",
            "args": [
                arg("defval", "Default enum member (EnumName.member).", required=True, display_type="const enum"),
                arg("title", "Input title.", default="variable_name"),
                arg("options", "Optional subset of members to show. Defaults to every member.", display_type="const enum[]"),
                arg("tooltip", "Hover help."),
                arg("inline", "Join several inputs on one row."),
                arg("group", "Inputs-tab group heading."),
                arg("confirm", "Ask the user to confirm on add.", default="false", display_type="const bool"),
                arg("display", "Whether the value appears on the status line.", default="display.none", display_type="const plot_display"),
                arg("active", "July 2025: false disables the input in the UI.", default="true", display_type="input bool"),
            ],
            "returns": "input <EnumName>",
            "returnedType": "input enum",
            "remarks": (
                "Declare the enum first. Each enum is a unique type — members of two enums are not interchangeable "
                "even if names/titles match. str.tostring(member) returns the member title. "
                "log.* and str.format cannot take enum members directly; convert with str.tostring first."
            ),
            "examples": (
                "//@version=6\n"
                'indicator("input.enum demo")\n'
                "enum OscType\n"
                '    rsi = "Relative Strength Index"\n'
                '    mfi = "Money Flow Index"\n'
                "OscType osc = input.enum(OscType.rsi, \"Oscillator\")\n"
                "float v = switch osc\n"
                "    OscType.rsi => ta.rsi(close, 14)\n"
                "    OscType.mfi => ta.mfi(close, 14)\n"
                "    => na\n"
                "plot(v)"
            ),
            "seeAlso": ["enum", "str.tostring", "input.string"],
        },
        {
            "name": "str.trim",
            "kind": "Built-in Function",
            "desc": "Returns source with leading and trailing Unicode whitespace removed.",
            "syntax": "str.trim(source) → series string",
            "args": [
                arg("source", "String to trim.", required=True, display_type="series string"),
            ],
            "returns": "series string",
            "returnedType": "series string",
            "examples": (
                "//@version=6\n"
                'indicator("str.trim")\n'
                'plot(str.length(str.trim("  close  ")))'
            ),
            "seeAlso": ["str.replace", "str.substring", "str.length"],
        },
        {
            "name": "request.footprint",
            "kind": "Built-in Function",
            "desc": (
                "January 2026: requests volume-footprint data for the current bar. "
                "Returns a series footprint ID, or na when no footprint exists for that bar. "
                "Use footprint.*() / volume_row.*() (or method form) to read totals, delta, POC, and rows."
            ),
            "syntax": "request.footprint(ticks_per_row, va_percent, imbalance_percent) → series footprint",
            "args": [
                arg(
                    "ticks_per_row",
                    "Tick height of each price row.",
                    required=True,
                    display_type="series int",
                    allowed=["series int", "simple int", "input int", "const int"],
                ),
                arg(
                    "va_percent",
                    "Percent of volume that defines the value area (typical 70).",
                    default="70",
                    display_type="series float",
                ),
                arg(
                    "imbalance_percent",
                    "Percent threshold that marks a buy/sell imbalance on a row.",
                    default="300",
                    display_type="series float",
                ),
            ],
            "returns": "series footprint",
            "returnedType": "series footprint",
            "remarks": (
                "footprint and volume_row are series reference types — they cannot be used where "
                "const/input is required. Availability follows the host volume-footprint dataset; "
                "do not assume every symbol/timeframe has rows."
            ),
            "examples": (
                "//@version=6\n"
                'indicator("Footprint POC")\n'
                "footprint fp = request.footprint(input.int(1, \"Ticks/row\"), 70, 300)\n"
                "volume_row poc = na(fp) ? na : fp.poc()\n"
                "plot(na(poc) ? na : poc.up_price(), \"POC\")"
            ),
            "seeAlso": [
                "footprint",
                "volume_row",
                "footprint.poc",
                "footprint.rows",
            ],
        },
        {
            "name": "footprint.total_volume",
            "kind": "Built-in Function",
            "desc": "Total volume contained in a requested footprint bar.",
            "syntax": "footprint.total_volume(id) → series float",
            "args": [arg("id", "footprint ID from request.footprint().", required=True, display_type="series footprint")],
            "returns": "series float",
            "returnedType": "series float",
            "examples": "//@version=6\nindicator(\"fp vol\")\nfp = request.footprint(1)\nplot(na(fp) ? na : fp.total_volume())",
        },
        {
            "name": "footprint.buy_volume",
            "kind": "Built-in Function",
            "desc": "Classified buy volume for a footprint bar.",
            "syntax": "footprint.buy_volume(id) → series float",
            "args": [arg("id", "footprint ID.", required=True, display_type="series footprint")],
            "returns": "series float",
            "returnedType": "series float",
        },
        {
            "name": "footprint.sell_volume",
            "kind": "Built-in Function",
            "desc": "Classified sell volume for a footprint bar.",
            "syntax": "footprint.sell_volume(id) → series float",
            "args": [arg("id", "footprint ID.", required=True, display_type="series footprint")],
            "returns": "series float",
            "returnedType": "series float",
        },
        {
            "name": "footprint.delta",
            "kind": "Built-in Function",
            "desc": "Buy volume minus sell volume for a footprint bar.",
            "syntax": "footprint.delta(id) → series float",
            "args": [arg("id", "footprint ID.", required=True, display_type="series footprint")],
            "returns": "series float",
            "returnedType": "series float",
        },
        {
            "name": "footprint.poc",
            "kind": "Built-in Function",
            "desc": "volume_row at the Point of Control (highest-volume row) of a footprint bar.",
            "syntax": "footprint.poc(id) → series volume_row",
            "args": [arg("id", "footprint ID.", required=True, display_type="series footprint")],
            "returns": "series volume_row",
            "returnedType": "series volume_row",
        },
        {
            "name": "footprint.vah",
            "kind": "Built-in Function",
            "desc": "volume_row at the value-area high of a footprint bar.",
            "syntax": "footprint.vah(id) → series volume_row",
            "args": [arg("id", "footprint ID.", required=True, display_type="series footprint")],
            "returns": "series volume_row",
            "returnedType": "series volume_row",
        },
        {
            "name": "footprint.val",
            "kind": "Built-in Function",
            "desc": "volume_row at the value-area low of a footprint bar.",
            "syntax": "footprint.val(id) → series volume_row",
            "args": [arg("id", "footprint ID.", required=True, display_type="series footprint")],
            "returns": "series volume_row",
            "returnedType": "series volume_row",
        },
        {
            "name": "footprint.rows",
            "kind": "Built-in Function",
            "desc": "Array of every volume_row in a footprint bar, low-to-high or host order.",
            "syntax": "footprint.rows(id) → series array<volume_row>",
            "args": [arg("id", "footprint ID.", required=True, display_type="series footprint")],
            "returns": "array<volume_row>",
            "returnedType": "array<volume_row>",
        },
        {
            "name": "footprint.get_row_by_price",
            "kind": "Built-in Function",
            "desc": "volume_row whose price range contains price, or na.",
            "syntax": "footprint.get_row_by_price(id, price) → series volume_row",
            "args": [
                arg("id", "footprint ID.", required=True, display_type="series footprint"),
                arg("price", "Price to look up.", required=True, display_type="series float"),
            ],
            "returns": "series volume_row",
            "returnedType": "series volume_row",
        },
        {
            "name": "volume_row.up_price",
            "kind": "Built-in Function",
            "desc": "Upper price bound of a footprint row.",
            "syntax": "volume_row.up_price(id) → series float",
            "args": [arg("id", "volume_row ID.", required=True, display_type="series volume_row")],
            "returns": "series float",
            "returnedType": "series float",
        },
        {
            "name": "volume_row.down_price",
            "kind": "Built-in Function",
            "desc": "Lower price bound of a footprint row.",
            "syntax": "volume_row.down_price(id) → series float",
            "args": [arg("id", "volume_row ID.", required=True, display_type="series volume_row")],
            "returns": "series float",
            "returnedType": "series float",
        },
        {
            "name": "volume_row.buy_volume",
            "kind": "Built-in Function",
            "desc": "Classified buy volume on a footprint row.",
            "syntax": "volume_row.buy_volume(id) → series float",
            "args": [arg("id", "volume_row ID.", required=True, display_type="series volume_row")],
            "returns": "series float",
            "returnedType": "series float",
        },
        {
            "name": "volume_row.sell_volume",
            "kind": "Built-in Function",
            "desc": "Classified sell volume on a footprint row.",
            "syntax": "volume_row.sell_volume(id) → series float",
            "args": [arg("id", "volume_row ID.", required=True, display_type="series volume_row")],
            "returns": "series float",
            "returnedType": "series float",
        },
        {
            "name": "volume_row.delta",
            "kind": "Built-in Function",
            "desc": "Buy minus sell volume on a footprint row.",
            "syntax": "volume_row.delta(id) → series float",
            "args": [arg("id", "volume_row ID.", required=True, display_type="series volume_row")],
            "returns": "series float",
            "returnedType": "series float",
        },
        {
            "name": "volume_row.total_volume",
            "kind": "Built-in Function",
            "desc": "Total volume on a footprint row.",
            "syntax": "volume_row.total_volume(id) → series float",
            "args": [arg("id", "volume_row ID.", required=True, display_type="series volume_row")],
            "returns": "series float",
            "returnedType": "series float",
        },
        {
            "name": "volume_row.buy_imbalance",
            "kind": "Built-in Function",
            "desc": "True when the row's buy/sell ratio meets the imbalance_percent threshold.",
            "syntax": "volume_row.buy_imbalance(id) → series bool",
            "args": [arg("id", "volume_row ID.", required=True, display_type="series volume_row")],
            "returns": "series bool",
            "returnedType": "series bool",
        },
        {
            "name": "volume_row.sell_imbalance",
            "kind": "Built-in Function",
            "desc": "True when the row's sell/buy ratio meets the imbalance_percent threshold.",
            "syntax": "volume_row.sell_imbalance(id) → series bool",
            "args": [arg("id", "volume_row ID.", required=True, display_type="series volume_row")],
            "returns": "series bool",
            "returnedType": "series bool",
        },
        {
            "name": "volume_row.total_imbalance",
            "kind": "Built-in Function",
            "desc": "Imbalance magnitude for a footprint row (host-defined).",
            "syntax": "volume_row.total_imbalance(id) → series float",
            "args": [arg("id", "volume_row ID.", required=True, display_type="series volume_row")],
            "returns": "series float",
            "returnedType": "series float",
        },
        {
            "name": "bool",
            "kind": "Built-in Function",
            "desc": (
                "Explicit cast to bool. v6 requires this for int/float used as conditions — "
                "numeric values are no longer implicitly true/false. 0 / 0.0 become false; any other number is true."
            ),
            "syntax": "bool(x) → bool",
            "args": [arg("x", "Value to cast.", required=True, display_type="series any")],
            "returns": "bool",
            "returnedType": "bool",
            "remarks": "v6: bool cannot be na. Do not write bool x = na.",
            "examples": (
                "//@version=6\n"
                'indicator("bool cast")\n'
                "color c = bool(bar_index) ? color.green : color.red\n"
                "bgcolor(c)"
            ),
        },
    ]

    methods = []
    for fn in functions:
        name = fn["name"]
        if name.startswith("footprint.") or name.startswith("volume_row."):
            methods.append({**fn, "kind": "Built-in Method"})

    types = [
        {
            "name": "enum",
            "kind": "Type Keyword",
            "desc": (
                "A programmer-declared type whose only values are named members (plus na). "
                "Use for strict option sets and input.enum() dropdowns. Each enum is a unique type."
            ),
            "syntax": "[export ]enum <EnumName>\n    <member>[ = <title>]",
        },
        {
            "name": "footprint",
            "kind": "Type Keyword",
            "desc": (
                "January 2026 reference type returned by request.footprint(). "
                "Pass the ID to footprint.*() or call methods (fp.poc(), fp.rows())."
            ),
            "syntax": "footprint",
        },
        {
            "name": "volume_row",
            "kind": "Type Keyword",
            "desc": (
                "January 2026 reference type for one price row inside a footprint "
                "(POC, VAH, VAL, or an element of footprint.rows())."
            ),
            "syntax": "volume_row",
        },
        {
            "name": "footprint[]",
            "kind": "Type Keyword",
            "desc": "Array of footprint IDs.",
            "syntax": "array<footprint>",
        },
        {
            "name": "volume_row[]",
            "kind": "Type Keyword",
            "desc": "Array of volume_row IDs (typically footprint.rows()).",
            "syntax": "array<volume_row>",
        },
    ]

    controls = [
        {
            "name": "enum",
            "kind": "Control Flow Keyword",
            "desc": (
                "Declares an enumerated type. Members are const values of that type; optional titles "
                "appear in input.enum() menus and via str.tostring(). Enum names must not shadow "
                "built-in types or namespaces (syminfo, ta, polyline, …)."
            ),
            "syntax": "[export ]enum <EnumName>\n    <member>[ = \"title\"]",
            "remarks": (
                "Unlike a UDT, enum members are a closed set of const values, not objects with series fields. "
                "Collections may store enum members; maps may use enum keys."
            ),
            "examples": (
                "//@version=6\n"
                'indicator("enum")\n'
                "enum Side\n"
                '    long = "Long"\n'
                '    short = "Short"\n'
                "Side side = input.enum(Side.long, \"Side\")\n"
                "plot(side == Side.long ? 1 : -1)"
            ),
        },
    ]

    variables = [
        {
            "name": "bid",
            "kind": "Built-in Variable",
            "desc": (
                "July 2025: current best bid price when the host feed provides it; otherwise na. "
                "Use with ask for spread / imbalance work. Not available on every symbol."
            ),
            "syntax": "bid",
            "remarks": "Series float. Guard with na() before plotting or dividing.",
        },
        {
            "name": "ask",
            "kind": "Built-in Variable",
            "desc": (
                "July 2025: current best ask price when the host feed provides it; otherwise na."
            ),
            "syntax": "ask",
            "remarks": "Series float. Pair with bid. Do not assume crypto/FX/equity parity.",
        },
    ]

    annotations = [
        {
            "name": "//@enum",
            "kind": "Built-in @Annotation",
            "desc": "Documents an enum type for the editor hover / library docs.",
            "syntax": "//@enum <description>",
        },
        {
            "name": "//@field",
            "kind": "Built-in @Annotation",
            "desc": "Documents an enum member or UDT field.",
            "syntax": "//@field <name> <description>",
        },
    ]

    operators = [
        {
            "name": '""" / \'\'\'',
            "kind": "Language Operator",
            "desc": (
                "April 2026 multiline string literal. Text between triple quotes or triple apostrophes "
                "keeps real newlines and indentation — no \\n required. Usable anywhere a string is."
            ),
            "syntax": '"""line 1\nline 2"""',
            "remarks": "Single-line \"...\" strings still need \\n. Indentation inside the delimiters is kept literally.",
            "examples": (
                "//@version=6\n"
                'indicator("multiline")\n'
                'string note = """Line one\n'
                'Line two"""\n'
                "if barstate.isfirst\n"
                "    log.info(note)"
            ),
        },
    ]

    guides = [
        {
            "name": "v6-migration",
            "kind": "Language Guide",
            "desc": (
                "Pine Script™ v6 breaking changes versus v5, plus later 2025–2026 additions. "
                "Use this when generating or converting scripts. This is HOOX operator guidance, "
                "not a TradingView® product claim and not platform bit-parity."
            ),
            "syntax": "//@version=6",
            "remarks": (
                "Breaking v6: bool is never na; no implicit int/float→bool; and/or are lazy; "
                "const int/int keeps fractions; when= removed; default strategy margins are 100; "
                "9000-trade cap trims oldest orders; strategy.exit evaluates relative+absolute pairs; "
                "[] cannot index literals or UDT fields; unique-type params reject na; "
                "timeframe.period always has a multiplier; array indexes may be negative; "
                "transp= removed (use color.new); some color.* hex values changed; "
                "label.new default text is color.white; for-loop end is re-evaluated each iteration; "
                "dynamic request.*() is the default.\n"
                "Later additions: export const (Jun 2025); input.*.active, bid/ask (Jul 2025); "
                "line wrapping (Dec 2025); request.footprint + footprint/volume_row (Jan 2026); "
                "multiline strings + UDT sort_field (Apr 2026); calc_on_every_history_tick (Jul 2026); "
                "UDT array.binary_search* sort_field (Aug 2026)."
            ),
            "examples": (
                "//@version=6\n"
                "strategy(\"v6 skeleton\", overlay = true, margin_long = 100, margin_short = 100, dynamic_requests = true)\n"
                "enum Mode\n"
                '    trend = "Trend"\n'
                '    mr = "Mean revert"\n'
                "Mode mode = input.enum(Mode.trend, \"Mode\", active = true)\n"
                "bool goLong = ta.crossover(ta.sma(close, 14), ta.sma(close, 28))\n"
                "if goLong\n"
                "    strategy.entry(\"L\", strategy.long)\n"
                "plot(close, \"Close\", force_overlay = true)"
            ),
        },
        {
            "name": "dynamic-requests",
            "kind": "Language Guide",
            "desc": (
                "v6 request.*() calls accept series ticker/timeframe arguments and may run in local "
                "scopes. A single request.security() inside a loop can fan out across an array of symbols."
            ),
            "syntax": "request.security(series string symbol, series string timeframe, expression)",
            "remarks": (
                "Keep dynamic_requests=true (v6 default) unless you must match v5 static behavior. "
                "Nested request.*() (using one request result as another request's expression) can "
                "differ from v5 — set dynamic_requests=false if a converted script changes."
            ),
            "examples": (
                "//@version=6\n"
                'indicator("dynamic request")\n'
                'var array<string> symbols = array.from("NASDAQ:AAPL", "NASDAQ:MSFT")\n'
                "array<float> closes = array.new<float>()\n"
                "for [i, sym] in symbols\n"
                '    closes.push(request.security(sym, "1D", close))\n'
                "plot(closes.avg())"
            ),
        },
    ]

    return {
        "functions": functions,
        "methods": methods,
        "types": types,
        "controls": controls,
        "variables": variables,
        "annotations": annotations,
        "operators": operators,
        "guides": guides,
    }


def main() -> None:
    if not PATH.exists():
        raise SystemExit(f"missing {PATH}")

    data = json.loads(PATH.read_text(encoding="utf-8"))

    data["_meta"] = {
        "pine": "Pine Script™",
        "tradingView": "TradingView®",
        "target_version": "v6",
        "updated": date.today().isoformat(),
        "coverage": "Language reference plus HOOX-authored v6 / 2025–2026 surface through August 2026.",
        "redistributable": False,
        "note": (
            "Operator-private RAG source. Do not commit. "
            "Ingest with bun run ingest:pinedocs then bun run ingest:index."
        ),
    }

    patch_existing(data)

    additions = new_entries()
    for section, entries in additions.items():
        if section == "guides":
            if "guides" not in data:
                data["guides"] = [{"title": "Language Guide", "docs": []}]
            bucket = data["guides"][0].setdefault("docs", [])
        else:
            bucket = data[section][0]["docs"]
        for entry in entries:
            upsert(bucket, entry)

    PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"updated {PATH}")


if __name__ == "__main__":
    main()
