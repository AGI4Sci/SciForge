"""Generic Computer Use policy helpers for vision-sense consumers.

The long-task pool owns scenarios and reports. This module owns reusable policy
decisions that should behave the same for any Computer Use caller.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import asdict, dataclass
from typing import Any, Mapping


PLANNER_ONLY_EVIDENCE_PATTERN = re.compile(
    r"trace refs?|trace paths?|image memory|artifact|action ledger|failure diagnostics|"
    r"sha256|displayId|尺寸|文件引用|截图引用|复盘|总结|汇总|回答|报告|handoff|refs?|summary|report",
    re.IGNORECASE,
)

GUI_ACTION_INTENT_PATTERN = re.compile(
    r"执行一次|点击|click|scroll|滚动|press_key|hotkey|type_text|输入|drag|拖拽|打开|open_app|"
    r"切换窗口|切换.*窗口|移动到|恢复|回到|启动|创建|保存|重命名|移动|定位|文件管理器|"
    r"文字处理|演示应用|幻灯片|文档|Alt\+Tab|Command\+Tab",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class MatrixExecutionPlan:
    mode: str
    maxConcurrency: int
    realGuiSerialized: bool
    reason: str


def is_planner_only_evidence_task(text: str) -> bool:
    """Return true when a task can be answered from trace/file refs only."""

    value = text or ""
    if GUI_ACTION_INTENT_PATTERN.search(value):
        return False
    return bool(PLANNER_ONLY_EVIDENCE_PATTERN.search(value))


def build_matrix_execution_plan(
    *,
    dry_run: bool,
    scenario_count: int,
    requested_max_concurrency: int | None = None,
) -> MatrixExecutionPlan:
    """Choose a generic execution plan without scenario-specific knowledge."""

    if not dry_run:
        return MatrixExecutionPlan(
            mode="serialized-real-gui",
            maxConcurrency=1,
            realGuiSerialized=True,
            reason="Real GUI execution may share displays and input devices, so scenarios run one at a time behind window locks.",
        )
    count = max(1, scenario_count or 1)
    requested = requested_max_concurrency if requested_max_concurrency is not None else min(4, count)
    max_concurrency = max(1, min(count, requested))
    return MatrixExecutionPlan(
        mode="parallel-analysis",
        maxConcurrency=max_concurrency,
        realGuiSerialized=True,
        reason="Dry-run scenarios produce file-ref evidence without touching real GUI input, so planner/grounder/verifier analysis can run concurrently.",
    )


def build_default_window_target(
    *,
    scenario_id: str,
    run_id: str,
    round_number: int,
    dry_run: bool,
    app_name: str | None = None,
    title: str | None = None,
    mode: str | None = None,
) -> dict[str, Any]:
    """Build the reusable target-window contract for real or dry-run execution."""

    if not dry_run:
        return {
            "enabled": True,
            "required": True,
            "mode": mode or ("app-window" if app_name or title else "active-window"),
            "appName": app_name,
            "title": title,
            "coordinateSpace": "window",
            "inputIsolation": "require-focused-target",
        }
    return {
        "enabled": True,
        "required": True,
        "mode": "window-id",
        "windowId": 84000 + int(round_number),
        "appName": "SciForge T084 Harness",
        "title": f"{scenario_id} {run_id} round {round_number}",
        "bounds": {"x": 0, "y": 0, "width": 1280, "height": 800},
        "coordinateSpace": "window",
        "inputIsolation": "require-focused-target",
    }


def build_policy_result_from_request(request: Mapping[str, Any]) -> Any:
    mode = str(request.get("mode") or "")
    if mode == "planner-only-evidence-task":
        return {"plannerOnly": is_planner_only_evidence_task(str(request.get("text") or ""))}
    if mode == "matrix-execution-plan":
        return asdict(
            build_matrix_execution_plan(
                dry_run=bool(request.get("dryRun")),
                scenario_count=int(request.get("scenarioCount") or 0),
                requested_max_concurrency=(
                    int(request["requestedMaxConcurrency"])
                    if request.get("requestedMaxConcurrency") is not None
                    else None
                ),
            )
        )
    if mode == "default-window-target":
        return build_default_window_target(
            scenario_id=str(request.get("scenarioId") or ""),
            run_id=str(request.get("runId") or ""),
            round_number=int(request.get("round") or 0),
            dry_run=bool(request.get("dryRun")),
            app_name=str(request.get("appName")) if request.get("appName") else None,
            title=str(request.get("title")) if request.get("title") else None,
            mode=str(request.get("targetMode")) if request.get("targetMode") else None,
        )
    raise ValueError(f"unsupported computer_use_policy mode: {mode}")


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args:
        print("expected JSON request", file=sys.stderr)
        return 2
    request = json.loads(args[0])
    result = build_policy_result_from_request(request)
    print(json.dumps({"ok": True, "result": result}, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
