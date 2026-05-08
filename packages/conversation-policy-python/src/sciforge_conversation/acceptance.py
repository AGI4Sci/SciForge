from __future__ import annotations

from typing import Any

from ._common import as_list, as_record, failure, first_text, is_record, string_list

SCHEMA_VERSION = "sciforge.conversation.acceptance.v1"


def evaluate_acceptance(goal: dict[str, Any] | None = None, response: dict[str, Any] | None = None, session: dict[str, Any] | None = None) -> dict[str, Any]:
    goal = as_record(goal)
    response = as_record(response)
    session = as_record(session)
    failures: list[dict[str, Any]] = []

    status = first_text(response.get("status"), as_record(response.get("run")).get("status"))
    text = _response_text(response)
    artifacts = _artifacts(response, session)

    if status in {"failed", "failed-with-reason", "error"}:
        failures.append(failure(
            "backend-failed",
            first_text(response.get("failureReason"), response.get("error"), "Backend run failed.") or "Backend run failed.",
            next_actions=["Preserve failureReason/log refs in context.", "Run repair or return failed-with-reason to the user."],
            severity="blocking",
            evidence_refs=_refs(response),
        ))

    if not text and not artifacts and not _refs(response):
        failures.append(failure(
            "missing-output",
            "Response contains no user-visible text, artifacts, or output refs.",
            next_actions=["Ask backend to regenerate the final answer.", "Return failed-with-reason if no output ref can be recovered."],
            severity="blocking",
        ))

    for required in _required_artifacts(goal):
        match = _find_artifact(artifacts, required["type"])
        if match is None:
            failures.append(failure(
                "missing-required-artifact",
                f"Required artifact is missing: {required['type']}.",
                next_actions=[f"Regenerate a {required['type']} artifact.", "Keep the failed attempt and artifact contract in the next repair prompt."],
                evidence_refs=_refs(response),
            ))
            continue
        if required.get("requiresRef", True) and not _has_artifact_ref(match):
            failures.append(failure(
                "missing-artifact-ref",
                f"Required artifact {required['type']} has no durable ref/path.",
                next_actions=["Persist the artifact to the workspace.", "Return the workspace ref in artifacts[].dataRef/path/markdownRef."],
                evidence_refs=_refs(match),
            ))
        if required.get("requiresMarkdown", False) and not _has_markdown_report(match):
            failures.append(failure(
                "missing-markdown-report",
                f"Required artifact {required['type']} does not include markdown content or markdownRef.",
                next_actions=["Write a markdown report artifact.", "Return markdownRef or markdown content bound to the report artifact."],
                evidence_refs=_refs(match),
            ))

    if _requires_markdown_report(goal) and not any(_has_markdown_report(artifact) for artifact in artifacts):
        failures.append(failure(
            "missing-markdown-report",
            "The turn requires a markdown report, but no markdown report/ref was returned.",
            next_actions=["Produce a research-report artifact with markdown or markdownRef.", "Do not mark the run successful until the report ref is present."],
            evidence_refs=_refs(response),
        ))

    pass_ = len(failures) == 0
    return {
        "schemaVersion": SCHEMA_VERSION,
        "pass": pass_,
        "status": "accepted" if pass_ else "rejected",
        "severity": "accepted" if pass_ else _severity(failures),
        "failures": failures,
        "reason": None if pass_ else {
            "code": "acceptance-failed",
            "message": "; ".join(item["detail"] for item in failures),
        },
        "nextActions": [] if pass_ else _dedupe(action for item in failures for action in item["nextActions"]),
        "evidenceRefs": _dedupe(ref for item in failures for ref in item.get("evidenceRefs", [])),
    }


def _required_artifacts(goal: dict[str, Any]) -> list[dict[str, Any]]:
    raw = goal.get("requiredArtifacts", goal.get("required_artifacts"))
    out: list[dict[str, Any]] = []
    for item in as_list(raw):
        if isinstance(item, str) and item.strip():
            out.append({"type": item.strip(), "requiresRef": True, "requiresMarkdown": False})
        elif is_record(item):
            artifact_type = first_text(item.get("type"), item.get("artifactType"), item.get("id"))
            if artifact_type:
                out.append({
                    "type": artifact_type,
                    "requiresRef": item.get("requiresRef", item.get("refRequired", True)) is not False,
                    "requiresMarkdown": item.get("requiresMarkdown", item.get("markdownRequired", False)) is True,
                })
    if _requires_markdown_report(goal) and not any(item["type"] == "research-report" for item in out):
        out.append({"type": "research-report", "requiresRef": True, "requiresMarkdown": True})
    return out


def _requires_markdown_report(goal: dict[str, Any]) -> bool:
    formats = {item.lower() for item in string_list(goal.get("requiredFormats"))}
    prompt = first_text(goal.get("prompt"), goal.get("summary"), goal.get("instruction")) or ""
    return "markdown" in formats or "report" in formats or any(token in prompt.lower() for token in ("markdown report", "research report", "报告", "综述"))


def _response_text(response: dict[str, Any]) -> str | None:
    message = as_record(response.get("message"))
    run = as_record(response.get("run"))
    return first_text(
        response.get("finalText"),
        response.get("text"),
        response.get("output"),
        response.get("message"),
        message.get("content"),
        run.get("output"),
        run.get("finalText"),
    )


def _artifacts(response: dict[str, Any], session: dict[str, Any]) -> list[dict[str, Any]]:
    raw = as_list(response.get("artifacts"))
    run = as_record(response.get("run"))
    raw.extend(as_list(run.get("artifacts")))
    raw.extend(as_list(as_record(response.get("payload")).get("artifacts")))
    raw.extend(as_list(session.get("artifacts")))
    return [as_record(item) for item in raw if is_record(item)]


def _find_artifact(artifacts: list[dict[str, Any]], artifact_type: str) -> dict[str, Any] | None:
    aliases = {artifact_type, artifact_type.replace("_", "-"), artifact_type.replace("-", "_")}
    for artifact in artifacts:
        value = first_text(artifact.get("type"), artifact.get("artifactType"), artifact.get("id")) or ""
        if value in aliases:
            return artifact
    return None


def _has_artifact_ref(artifact: dict[str, Any]) -> bool:
    return any(isinstance(artifact.get(key), str) and artifact[key].strip() for key in ("ref", "dataRef", "path", "filePath", "markdownRef", "contentRef", "outputRef"))


def _has_markdown_report(artifact: dict[str, Any]) -> bool:
    if first_text(artifact.get("markdown"), artifact.get("markdownContent")):
        return True
    ref = first_text(artifact.get("markdownRef"), artifact.get("contentRef"), artifact.get("path"), artifact.get("dataRef"))
    if ref and ref.lower().split("?")[0].endswith((".md", ".markdown")):
        return True
    data = as_record(artifact.get("data"))
    return bool(first_text(data.get("markdown"), data.get("reportMarkdown"), data.get("content")))


def _refs(value: dict[str, Any]) -> list[str]:
    refs: list[str] = []
    for key in ("ref", "dataRef", "path", "filePath", "markdownRef", "contentRef", "outputRef", "stdoutRef", "stderrRef"):
        item = value.get(key)
        if isinstance(item, str) and item.strip():
            refs.append(item.strip())
    for key in ("artifactRefs", "resultRefs", "traceRefs", "evidenceRefs"):
        refs.extend(string_list(value.get(key)))
    return _dedupe(refs)


def _severity(failures: list[dict[str, Any]]) -> str:
    if any(item.get("severity") == "blocking" for item in failures):
        return "blocking"
    return "repairable"


def _dedupe(values: Any) -> list[str]:
    out: list[str] = []
    for value in values:
        if isinstance(value, str) and value and value not in out:
            out.append(value)
    return out
