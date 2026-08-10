"""GUI-Owl observe/plan/act loop over one target-bound input channel."""
from __future__ import annotations

import json
import platform as _platform
import re
import time
from typing import Any, Dict, List

from driver.channel import ChannelError, SessionInputChannel

from . import owl_agent, reflector
from . import result as R
from .artifacts import ArtifactRun, prune_artifacts
from .config import Config


_OS_NAME = {"Windows": "windows", "Darwin": "macos", "Linux": "linux"}.get(
    _platform.system(), "linux"
)
_TERMINAL = {"terminate", "answer", "stop", "done", "interact", "call_user"}
_UIA_BACKEND_GUIDANCE = (
    "The active backend is Windows UI Automation, not a physical mouse/keyboard. "
    "Use the supplied semantic tree and include its opaque elementToken for the exact control. "
    "Allowed semantic actions are: type/write with text, left_click/invoke, toggle, "
    "select, range with value, scroll, wait, terminate, answer, and interact. "
    "Do not use coordinates, key/hotkey, open_app, drag, mouse_move, right_click, "
    "middle_click, double_click, or triple_click. If no suitable elementToken/pattern "
    "is exposed, use interact or terminate with failure instead of guessing."
)
_CDP_BACKEND_GUIDANCE = (
    "The active backend is browser-cdp. When the supplied semantic tree contains a control, "
    "use that control's normalized 0-1000 center as the action coordinate; do not guess from "
    "an unavailable screenshot. After acting, use the next semantic tree to confirm the requested "
    "UI state before terminating with success."
)


def _norm_action(action: str) -> str:
    value = re.sub(r"\d+", lambda match: str(int(match.group()) // 20), (action or "").lower())
    return re.sub(r"\s+", " ", value).strip()


def _action_summary(output_text: str) -> str:
    match = re.search(r"Action:\s*(.+?)(?:<tool_call>|$)", output_text, re.DOTALL | re.IGNORECASE)
    if match:
        return re.sub(r"\s+", " ", match.group(1)).strip()[:300]
    return re.sub(r"\s+", " ", output_text).strip()[:300]


def _prepare_action(args: Dict[str, Any], width: int, height: int) -> Dict[str, Any]:
    prepared = dict(args)
    coordinate = args.get("coordinate")
    if coordinate is not None:
        prepared["coordinate"] = list(owl_agent.to_screen(coordinate, width, height))
        prepared["coordinateSpace"] = "observation-pixels"
    return prepared


def _provenance(channel: SessionInputChannel, started: float) -> Dict[str, Any]:
    return R.provenance(
        "computer_use_run",
        channel.request_id,
        started,
        session_id=channel.session_id,
        target_id=channel.target.target_id,
        lease_id=channel.lease.lease_id,
        backend=channel.capabilities.backend.value,
        requested_isolation=channel.isolation.requested.value,
        effective_isolation=channel.isolation.effective.value,
        degraded=channel.isolation.degraded,
    )


def run_task(
    cfg: Config,
    instruction: str,
    channel: SessionInputChannel,
    *,
    execute: bool = False,
    approve: bool = False,
) -> Dict[str, Any]:
    """Run one task; every exit closes the supplied channel exactly once."""
    started = time.time()
    terminal = "failed"
    artifact_run: ArtifactRun | None = None
    result: Dict[str, Any]
    try:
        if not instruction or not instruction.strip():
            return R.err("INVALID_ARGUMENT", "instruction is required", prov=_provenance(channel, started))
        if execute and not (approve and cfg.allow_execute):
            return R.err(
                "NEEDS_APPROVAL",
                "Execution touches the real desktop and requires trusted approval.",
                blocked_reason="external-side-effect-requires-approval",
                prov=_provenance(channel, started),
            )
        artifact_run = ArtifactRun(
            cfg.artifact_dir,
            channel.request_id,
            session_id=channel.session_id,
            target_id=channel.target.target_id,
            backend=channel.capabilities.backend.value,
        )
        result, terminal = _run_loop(cfg, instruction, channel, execute, artifact_run, started)
        return result
    except ChannelError as error:
        terminal = "cancelled" if error.code == "CANCEL_PENDING" else "timed-out" if error.code == "TIMEOUT" else "failed"
        return R.err(error.code, str(error), details=error.details, prov=_provenance(channel, started))
    except Exception as error:  # noqa: BLE001
        terminal = "failed"
        return R.err("INTERNAL_ERROR", f"runner failed: {error}", retryable=False, prov=_provenance(channel, started))
    finally:
        cleanup = channel.close(terminal)
        if artifact_run is not None:
            try:
                artifact_run.finish(terminal, cleanup.to_dict())
                prune_artifacts(
                    cfg.artifact_dir,
                    max_age_seconds=cfg.artifact_retention_s,
                    max_runs=cfg.artifact_max_runs,
                    exclude_request_ids=(channel.request_id,),
                )
            except Exception as error:  # artifact cleanup must not hide channel cleanup
                cleanup.errors.append(f"artifact manifest: {error}")


def _run_loop(
    cfg: Config,
    instruction: str,
    channel: SessionInputChannel,
    really_execute: bool,
    artifact_run: ArtifactRun,
    started: float,
) -> tuple[Dict[str, Any], str]:
    first = channel.observe()
    image = first.image
    observation_metadata = first.metadata
    latest_revision = first.revision
    width, height = image.size
    status = "exhausted_steps"
    answer_text = ""
    steps: List[Dict[str, Any]] = []
    artifacts: List[Dict[str, Any]] = []
    history: List[Dict[str, str]] = []
    recent_actions: List[str] = []
    progress_status = ""
    action_outcomes: List[str] = []
    replan_hint = False

    for index in range(cfg.max_steps):
        if channel.cancelled:
            status = "cancelled"
            break
        shot_path = artifact_run.save_screenshot(image, index)
        artifacts.append(R.artifact_ref("screenshot", f"step {index} screenshot", path=shot_path))
        width, height = image.size
        messages = owl_agent.build_messages(
            instruction,
            history,
            image,
            image_window=cfg.image_window,
            progress_status=progress_status,
            replan_hint=replan_hint,
            backend_guidance=(
                _UIA_BACKEND_GUIDANCE
                if channel.capabilities.backend.value == "windows-uia"
                else _CDP_BACKEND_GUIDANCE
                if channel.capabilities.backend.value == "browser-cdp"
                else ""
            ),
            semantic_context=_semantic_context(observation_metadata),
        )
        remaining = channel.remaining_seconds
        if remaining is not None and remaining <= 0:
            raise ChannelError("TIMEOUT", "request deadline expired before model call")
        timeout = min(120.0, remaining) if remaining is not None else 120.0
        try:
            with channel.activity():
                output_text = owl_agent.call_owl(
                    cfg.model_router_base_url,
                    cfg.model_router_model,
                    cfg.model_router_api_key,
                    messages,
                    timeout=timeout,
                )
        except Exception as error:  # noqa: BLE001
            if isinstance(error, ChannelError):
                raise
            remaining = channel.remaining_seconds
            if remaining is not None and remaining <= 0:
                raise ChannelError("TIMEOUT", "request deadline expired during model call") from error
            return R.err(
                "UNAVAILABLE",
                f"model call failed: {error}",
                retryable=True,
                details={"step": index},
                prov=_provenance(channel, started),
            ), "failed"
        if channel.cancelled:
            raise ChannelError("CANCEL_PENDING", "request was cancelled during model call")
        remaining = channel.remaining_seconds
        if remaining is not None and remaining <= 0:
            raise ChannelError("TIMEOUT", "request deadline expired during model call")

        args = owl_agent.extract_action(output_text)
        action_type = (args.get("action") if args else "") or ""
        coordinate = (args or {}).get("coordinate")
        step_rec: Dict[str, Any] = {
            "step": index,
            "plan": _action_summary(output_text),
            "action": json.dumps(args, ensure_ascii=False)[:400] if args else "<no-action>",
            "coords": owl_agent.to_screen(coordinate, width, height) if coordinate and len(coordinate) >= 2 else None,
            "screenshot": shot_path,
            "targetId": channel.target.target_id,
            "observationRevision": latest_revision,
            "backend": channel.capabilities.backend.value,
            "executed": False,
        }
        history.append({"output": output_text, "image": shot_path})
        low = action_type.lower()
        if low in _TERMINAL:
            if low in {"interact", "call_user"}:
                answer_text = (args or {}).get("text", "") or ""
                step_rec.update({"terminal": low, "text": answer_text})
                status = "needs_user"
            elif low == "answer":
                answer_text = (args or {}).get("text", "") or ""
                step_rec.update({"terminal": "answer", "answer": answer_text})
                status = "agent_reported_done"
            else:
                succeeded = str((args or {}).get("status", "success")).lower() != "failure"
                step_rec["terminal"] = action_type
                status = "agent_reported_done" if succeeded else "agent_reported_fail"
            steps.append(step_rec)
            break
        if low == "wait":
            steps.append(step_rec)
            channel.wait(float((args or {}).get("time", 2) or 2))
            observation = channel.observe()
            image, latest_revision = observation.image, observation.revision
            observation_metadata = observation.metadata
            continue

        normalized = _norm_action(step_rec["action"]) or "<no-action>"
        recent_actions.append(normalized)
        del recent_actions[: -(cfg.nonprogress_limit * 2)]
        if recent_actions.count(normalized) >= cfg.nonprogress_limit:
            step_rec["stuck"] = "repeated_action"
            steps.append(step_rec)
            status = "stuck_repeated_action"
            break
        if not really_execute:
            steps.append(step_rec)
            status = "dry_run_planned"
            break
        if not args:
            steps.append(step_rec)
            observation = channel.observe()
            image, latest_revision = observation.image, observation.revision
            observation_metadata = observation.metadata
            continue

        before_image = image
        prepared = _prepare_action(args, width, height)
        outcome = channel.perform(prepared, expected_revision=latest_revision)
        step_rec["executed"] = outcome.committed
        step_rec["outcome"] = outcome.to_dict()
        observation = channel.observe()
        after_image, latest_revision = observation.image, observation.revision
        observation_metadata = observation.metadata

        if cfg.reflect:
            try:
                with channel.activity():
                    reflection = reflector.reflect(
                        cfg,
                        instruction,
                        progress_status,
                        current_subgoal=instruction,
                        last_action=args,
                        last_summary=step_rec["plan"],
                        before_img=before_image,
                        after_img=after_image,
                    )
                step_rec["reflect"] = {
                    "outcome": reflection["outcome"],
                    "error": reflection["error_description"],
                }
                history[-1]["reflect_outcome"] = reflection["outcome"]
                history[-1]["reflect_error"] = reflection["error_description"]
                if reflection["progress_status"]:
                    progress_status = reflection["progress_status"]
                action_outcomes.append(reflection["outcome"])
                window = action_outcomes[-cfg.reflect_escalate:]
                replan_hint = len(window) >= cfg.reflect_escalate and all(item in {"B", "C"} for item in window)
            except Exception as error:  # noqa: BLE001
                step_rec["reflect_error"] = str(error)
        steps.append(step_rec)
        image = after_image

    summary = f"{len(steps)} step(s); status={status}; {'executed' if really_execute else 'dry-run (no actions performed)'} ."
    if answer_text:
        summary += f" answer: {answer_text[:200]}"
    data = {
        "status": status,
        "executed": really_execute,
        "instruction": instruction,
        "answer": answer_text,
        "platform": _OS_NAME,
        "screen": [width, height],
        "steps": steps,
        "stepCount": len(steps),
        "targetId": channel.target.target_id,
        "backend": channel.capabilities.backend.value,
        "requestedIsolation": channel.isolation.requested.value,
        "effectiveIsolation": channel.isolation.effective.value,
        "degraded": channel.isolation.degraded,
        "degradedReason": channel.isolation.degraded_reason,
    }
    terminal = "cancelled" if status == "cancelled" else "completed" if status != "error" else "failed"
    return R.ok(data, summary=summary, artifacts=artifacts, prov=_provenance(channel, started)), terminal


def _semantic_context(metadata: Any) -> str:
    if not isinstance(metadata, dict) or "semanticTree" not in metadata:
        return ""
    tree = metadata.get("semanticTree")
    if not isinstance(tree, (list, tuple)):
        return ""
    # Backend providers already redact password nodes. Keep the model input
    # bounded and deterministic; semantic UI content remains untrusted data.
    return json.dumps(tree[:256], ensure_ascii=False, separators=(",", ":"))[:30_000]
