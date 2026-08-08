#!/usr/bin/env python3
"""Deterministic, offline Evidence DAG v3 reproducibility demo.

The demo uses only public Evidence fact-layer APIs.  It builds two complete
graphs from explicit structured facts, commits immutable snapshots, exports
rerun specs, and compares a numeric output without calling a model or network.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import sys
import tempfile
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
PYTHON_ROOT = PACKAGE_ROOT / "python"
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))

from evidence_dag.artifacts import ArtifactRegistry  # noqa: E402
from evidence_dag.graph import ThreadGraph  # noqa: E402
from evidence_dag.lineage import ingest_trace_lineage  # noqa: E402
from evidence_dag.model import NodeType  # noqa: E402
from evidence_dag.rerun import (  # noqa: E402
    build_rerun_spec,
    compare_rerun_specs,
    output_values_for_spec,
    validate_rerun_spec,
)
from evidence_dag.snapshot import EvidenceSnapshot, build_snapshot  # noqa: E402


DEMO_VERSION = "sciforge.reproducible-dag-v3-demo.v1"
FIXED_TIME = "2026-08-05T10:00:00Z"
THREAD_PREFIX = "demo:reproducible-dag-v3"
INPUT_WATERMARK = "demo-event:1"
BASELINE_VALUE = 100
CANDIDATE_VALUE = 100.05
ABSOLUTE_TOLERANCE = 0.1
NUMERIC_COMPARATOR = {
    "kind": "numeric",
    "absoluteTolerance": ABSOLUTE_TOLERANCE,
}

COVERAGE_COMPONENTS = (
    ("inputs", "Input"),
    ("code", "Code"),
    ("environment", "Environment"),
    ("parameters", "Parameter"),
    ("tools", "Tool"),
    ("approvals", "Approval"),
    ("artifacts", "Artifact"),
    ("evidence", "Evidence"),
    ("conclusions", "Conclusion"),
)


@dataclass(frozen=True)
class DemoRun:
    name: str
    value: float
    graph: ThreadGraph
    conclusion_id: str
    lineage: dict[str, Any]
    snapshot: EvidenceSnapshot
    spec: dict[str, Any]
    output_values: dict[tuple[str, str], Any]
    output_digest: str


def canonical_json(value: Any) -> str:
    """Canonical JSON sufficient for this ASCII-only, finite demo payload."""
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def digest(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def workflow_definition() -> dict[str, Any]:
    return {
        "id": "workflow:dag-v3-numeric-demo",
        "name": "DAG v3 deterministic numeric analysis",
        "nodes": [
            {"id": "input", "type": "dataset-input", "name": "Load fixed input"},
            {"id": "analyze", "type": "python-analysis", "name": "Compute metric"},
            {"id": "output", "type": "numeric-output", "name": "Persist metric"},
        ],
        "connections": [
            {"source": "input", "target": "analyze"},
            {"source": "analyze", "target": "output"},
        ],
    }


def create_loop_executor_payload(output_value: float) -> dict[str, Any]:
    """Build the public create-loop executor contract from its canonical body."""
    workflow = workflow_definition()
    run_input = {"records": [1, 2, 3], "schema": "demo.v1"}
    context = {
        "packageOwner": "sciforge.create-loop",
        "packageVersion": "1.0.0",
        "nodeVersion": "v24.0.0",
        "platform": "linux",
        "architecture": "arm64",
        "environment": [],
    }
    workflow_fingerprint = digest(workflow)
    input_fingerprint = digest(run_input)
    context_fingerprint = digest(context)
    output_fingerprint = digest(output_value)
    spec_fingerprint = digest({
        "workflowFingerprint": workflow_fingerprint,
        "inputFingerprint": input_fingerprint,
        "contextFingerprint": context_fingerprint,
        "approvalRequirements": [],
        "comparator": NUMERIC_COMPARATOR,
    })
    return {
        "schemaVersion": "sciforge.create-loop.executor.v1",
        "workflow": workflow,
        "input": run_input,
        "context": context,
        "baseline": {
            "runId": "demo-baseline-run",
            "workflowFingerprint": workflow_fingerprint,
            "inputFingerprint": input_fingerprint,
            "specFingerprint": spec_fingerprint,
            "contextFingerprint": context_fingerprint,
            "outputFingerprint": output_fingerprint,
            "outputJson": canonical_json(output_value),
            "approvalFingerprint": digest([]),
            "nodeResults": [],
        },
    }


def lineage_envelope(output_value: float) -> dict[str, Any]:
    workflow = workflow_definition()
    executor_payload = create_loop_executor_payload(output_value)
    output_digest = digest({"value": output_value, "unit": "score"})
    return {
        "workflowRun": {
            "id": "workflow-run:dag-v3-demo",
            "name": "DAG v3 deterministic numeric analysis",
            "status": "completed",
            "executor": {
                "kind": "create-loop",
                "workflow": executor_payload,
                "workflowDigest": digest(executor_payload),
                "target": {"kind": "workflow", "id": workflow["id"]},
            },
        },
        "inputs": [{
            "id": "input:fixed-dataset:v1",
            "type": "dataset_version",
            "name": "Fixed demo dataset v1",
            "contentDigest": digest({"records": [1, 2, 3], "schema": "demo.v1"}),
            "version": "1",
        }],
        "code": [{
            "id": "code:numeric-analysis:v1",
            "type": "software_version",
            "name": "Numeric analysis source v1",
            "contentDigest": digest("result = deterministic_metric(input, alpha=0.05)"),
            "language": "python",
            "repository": "https://example.invalid/sciforge/dag-v3-demo.git",
            "commit": "0123456789abcdef0123456789abcdef01234567",
            "entrypoint": "analysis.py:main",
        }],
        "environment": [{
            "id": "environment:python-3.12",
            "name": "Pinned Python environment",
            "containerDigest": digest("python:3.12.4-linux-arm64"),
            "platform": "linux",
            "architecture": "arm64",
            "runtimeVersions": {"python": "3.12.4"},
            "lockDigests": [digest("requirements.lock:v1")],
        }],
        "parameters": {
            "id": "parameters:dag-v3-demo",
            "name": "Deterministic analysis parameters",
            "values": {"alpha": 0.05, "method": "demo-metric"},
            "randomSeed": 73,
        },
        "tools": [{
            "id": "tool:deterministic-statistics",
            "name": "Deterministic statistics tool",
            "providerId": "sciforge",
            "actionId": "statistics.compute",
            "version": "4.2.0",
            "arguments": {"method": "demo-metric"},
            "stochastic": False,
            "supportsSeed": True,
            "parentId": "workflow-run:dag-v3-demo",
        }],
        "approvals": [{
            "id": "approval:dag-v3-demo:historical",
            "name": "Recorded workflow approval",
            "kind": "workflow-human-approval",
            "mode": "confirm",
            "subjectId": "tool:deterministic-statistics",
            "status": "approved",
            "policyDigest": digest("demo-approval-policy:v1"),
        }],
        "outputs": [{
            "id": "artifact:numeric-result",
            "type": "artifact",
            "name": "Numeric result",
            "contentDigest": output_digest,
            "mediaType": "application/json",
            "comparator": NUMERIC_COMPARATOR,
            "value": output_value,
        }],
        "evidence": [{
            "id": "evidence:numeric-result",
            "type": "finding",
            "name": "The deterministic analysis produced the recorded numeric result.",
        }],
        "conclusion": {
            "id": "conclusion:dag-v3-demo",
            "name": "The rerun reproduces the baseline result within declared tolerance.",
        },
        "relations": [
            {
                "src": "evidence:numeric-result",
                "dst": "workflow-run:dag-v3-demo",
                "rel": "generated_by",
            },
            {
                "src": "evidence:numeric-result",
                "dst": "conclusion:dag-v3-demo",
                "rel": "supports",
            },
        ],
    }


def build_demo_run(name: str, output_value: float) -> DemoRun:
    graph = ThreadGraph(f"{THREAD_PREFIX}:{name}")
    with tempfile.TemporaryDirectory(prefix=f"sciforge-dag-v3-{name}-") as registry_root:
        registry = ArtifactRegistry(
            workspace_roots=(registry_root,),
            locator_root=registry_root,
        )
        delta = ingest_trace_lineage(
            graph,
            [{
                "id": "trace:dag-v3-demo",
                "kind": "tool_result",
                "evidenceLineage": lineage_envelope(output_value),
            }],
            registry,
            created_by="reproducible-dag-v3-demo",
            created_at=FIXED_TIME,
        )
    if delta["envelopes"] != 1:
        raise RuntimeError(f"{name}: structured lineage envelope was not ingested")

    conclusions = graph.nodes_of(NodeType.CONCLUSION)
    if len(conclusions) != 1:
        raise RuntimeError(f"{name}: expected exactly one Conclusion node")
    conclusion_id = conclusions[0].id
    lineage = graph.conclusion_lineage(conclusion_id)
    snapshot = replace(
        build_snapshot(graph, version=1, input_watermark=INPUT_WATERMARK),
        created_at=FIXED_TIME,
    )
    spec = build_rerun_spec(graph, snapshot, conclusion_id)
    validate_rerun_spec(spec)
    values = output_values_for_spec(graph, spec)
    output = spec["activities"][0]["outputs"][0]
    output_digest = str(output.get("contentDigest") or output.get("baselineDigest") or "")
    return DemoRun(
        name=name,
        value=output_value,
        graph=graph,
        conclusion_id=conclusion_id,
        lineage=lineage,
        snapshot=snapshot,
        spec=spec,
        output_values=values,
        output_digest=output_digest,
    )


def assert_complete_run(run: DemoRun) -> None:
    coverage = run.lineage["coverage"]
    if coverage.get("complete") is not True:
        raise RuntimeError(f"{run.name}: conclusion lineage is incomplete: {coverage['breakpoints']}")
    components = coverage["components"]
    missing = [label for key, label in COVERAGE_COMPONENTS if not components.get(key)]
    if missing:
        raise RuntimeError(f"{run.name}: missing DAG v3 components: {', '.join(missing)}")
    if not components.get("activities"):
        raise RuntimeError(f"{run.name}: execution activity is missing")
    if not run.spec["executionReady"] or run.spec["reproducibility"] != "controlled":
        raise RuntimeError(f"{run.name}: exported spec is not controlled and execution-ready")
    if run.spec["breakpoints"]:
        raise RuntimeError(f"{run.name}: unexpected rerun breakpoints: {run.spec['breakpoints']}")
    if len(run.output_values) != 1 or next(iter(run.output_values.values())) != run.value:
        raise RuntimeError(f"{run.name}: canonical output value was not resolved from the graph")


def compare_runs(baseline: DemoRun, candidate: DemoRun) -> dict[str, Any]:
    comparison = compare_rerun_specs(
        baseline.spec,
        candidate.spec,
        baseline_output_values=baseline.output_values,
        candidate_output_values=candidate.output_values,
    )
    expected = {
        "sameInput": True,
        "sameSpec": True,
        "sameExecutionContext": True,
        "resultMatch": True,
        "comparisonVerifiable": True,
        "classification": "match",
        "replicationStatus": "matched",
        "replicationRelation": "replicates",
    }
    for key, value in expected.items():
        if comparison.get(key) != value:
            raise RuntimeError(
                f"comparison.{key} expected {value!r}, observed {comparison.get(key)!r}"
            )
    if baseline.output_digest == candidate.output_digest:
        raise RuntimeError("baseline and candidate output digests unexpectedly match")
    observed = [
        item for item in comparison.get("differences", [])
        if item.get("reasonCode") == "explicit_comparator_match_with_observed_change"
    ]
    if len(observed) != 1:
        raise RuntimeError("matched numeric output did not retain its observed digest difference")
    difference = observed[0]
    if difference.get("baselineDigest") == difference.get("candidateDigest"):
        raise RuntimeError("comparison did not expose the changed output digest")
    if difference.get("baselineValueDigest") == difference.get("candidateValueDigest"):
        raise RuntimeError("comparison did not expose the changed canonical value digest")
    return comparison


def output_values_json(run: DemoRun) -> list[dict[str, Any]]:
    return [
        {"activityId": activity_id, "outputId": output_id, "value": value}
        for (activity_id, output_id), value in sorted(run.output_values.items())
    ]


def write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )


def coverage_rows(baseline: DemoRun, candidate: DemoRun) -> list[tuple[str, int, int]]:
    left = baseline.lineage["coverage"]["components"]
    right = candidate.lineage["coverage"]["components"]
    return [(label, len(left[key]), len(right[key])) for key, label in COVERAGE_COMPONENTS]


def report_markdown(
    baseline: DemoRun,
    candidate: DemoRun,
    comparison: dict[str, Any],
) -> str:
    delta = abs(candidate.value - baseline.value)
    lines = [
        "# SciForge DAG v3 可复跑 Demo 报告",
        "",
        "本报告由事实层 API 离线生成；未访问网络，也未调用模型。",
        "",
        "## 结论",
        "",
        f"- 同一输入：`{str(comparison['sameInput']).lower()}`",
        f"- 输出值：`{baseline.value}` → `{candidate.value}`",
        f"- 绝对差值：`{delta:.12g}`，声明容差：`{ABSOLUTE_TOLERANCE}`",
        f"- 输出 digest 不同：`{str(baseline.output_digest != candidate.output_digest).lower()}`",
        f"- `resultMatch`：`{str(comparison['resultMatch']).lower()}`",
        f"- `replicationStatus`：`{comparison['replicationStatus']}`",
        f"- `replicationRelation`：`{comparison['replicationRelation']}`",
        "",
        "输出 digest 的变化没有被容差隐藏：`comparison.json` 中保留了 "
        "`explicit_comparator_match_with_observed_change`，同时给出声明 digest 与值 digest。",
        "",
        "## 九类谱系覆盖",
        "",
        "| 组件 | Baseline | Candidate |",
        "| --- | ---: | ---: |",
    ]
    lines.extend(f"| {label} | {left} | {right} |" for label, left, right in coverage_rows(
        baseline, candidate,
    ))
    lines.extend([
        "",
        "两个结论谱系的 `coverage.complete` 均为 `true`，且导出的规范均为 "
        "`controlled`、`executionReady=true`、无 breakpoint。",
        "",
        "## 稳定标识",
        "",
        "| 项目 | Baseline | Candidate |",
        "| --- | --- | --- |",
        f"| Snapshot digest | `{baseline.snapshot.digest}` | `{candidate.snapshot.digest}` |",
        f"| Spec digest | `{baseline.spec['specDigest']}` | `{candidate.spec['specDigest']}` |",
        f"| Output digest | `{baseline.output_digest}` | `{candidate.output_digest}` |",
        "",
        "## 生成文件",
        "",
        "- `lineage.json`：两个完整图、Snapshot、Conclusion lineage 与输出值",
        "- `baseline.sciforge-rerun.json`：基线可复跑规范",
        "- `candidate.sciforge-rerun.json`：候选可复跑规范",
        "- `comparison.json`：可解释差异与复制判定",
        "- `dag-v3-demo.svg`：由实际节点、边和 coverage 生成的谱系图",
        "- `index.html`：自包含可视报告",
        "",
    ])
    return "\n".join(lines)


def category_for_node(node_id: str, components: dict[str, list[str]]) -> tuple[str, str]:
    categories = [
        *COVERAGE_COMPONENTS[:6],
        ("activities", "Run"),
        *COVERAGE_COMPONENTS[6:],
    ]
    for key, label in categories:
        if node_id in components.get(key, []):
            return key, label
    return "other", "Other"


def svg_document(baseline: DemoRun, candidate: DemoRun, comparison: dict[str, Any]) -> str:
    lineage = baseline.lineage
    components = lineage["coverage"]["components"]
    categories = [
        *COVERAGE_COMPONENTS[:6],
        ("activities", "Run"),
        *COVERAGE_COMPONENTS[6:],
    ]
    category_index = {key: index for index, (key, _label) in enumerate(categories)}
    grouped: dict[str, list[dict[str, Any]]] = {key: [] for key, _label in categories}
    for node in lineage["nodes"]:
        key, _label = category_for_node(node["id"], components)
        if key in grouped:
            grouped[key].append(node)
    for values in grouped.values():
        values.sort(key=lambda item: item["id"])

    box_width, box_height = 126, 62
    x_step, y_step = 143, 82
    margin_x, top = 20, 116
    width = margin_x * 2 + x_step * len(categories)
    max_rows = max((len(values) for values in grouped.values()), default=1)
    graph_height = top + max_rows * y_step + 40
    footer_height = 150
    height = graph_height + footer_height
    positions: dict[str, tuple[float, float]] = {}
    for key, values in grouped.items():
        x = margin_x + category_index[key] * x_step
        for row, node in enumerate(values):
            positions[node["id"]] = (x, top + row * y_step)

    colors = {
        "inputs": "#dbeafe", "code": "#e0e7ff", "environment": "#ede9fe",
        "parameters": "#f3e8ff", "tools": "#fae8ff", "approvals": "#fce7f3",
        "activities": "#ffedd5", "artifacts": "#dcfce7", "evidence": "#ccfbf1",
        "conclusions": "#fef3c7",
    }
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">',
        '<title id="title">SciForge DAG v3 reproducibility demo</title>',
        '<desc id="desc">A data-driven graph from Input through Conclusion with a matched numeric rerun.</desc>',
        "<defs>",
        '<marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">'
        '<path d="M0,0 L8,4 L0,8 z" fill="#64748b"/></marker>',
        "</defs>",
        '<rect width="100%" height="100%" rx="18" fill="#f8fafc"/>',
        '<text x="20" y="34" font-family="system-ui,sans-serif" font-size="22" '
        'font-weight="700" fill="#0f172a">SciForge DAG v3 · Deterministic Rerun</text>',
        '<text x="20" y="62" font-family="system-ui,sans-serif" font-size="14" '
        'fill="#475569">Facts → immutable Snapshot → rerun spec → explainable comparison</text>',
    ]
    for index, (key, label) in enumerate(categories):
        x = margin_x + index * x_step
        count = len(grouped[key])
        parts.append(
            f'<text x="{x + box_width / 2}" y="96" text-anchor="middle" '
            f'font-family="system-ui,sans-serif" font-size="12" font-weight="700" '
            f'fill="#334155">{html.escape(label)} · {count}</text>'
        )

    for edge in lineage["edges"]:
        if edge["src"] not in positions or edge["dst"] not in positions:
            continue
        sx, sy = positions[edge["src"]]
        dx, dy = positions[edge["dst"]]
        x1, y1 = sx + box_width / 2, sy + box_height / 2
        x2, y2 = dx + box_width / 2, dy + box_height / 2
        curve = max(35, abs(x2 - x1) * 0.35)
        path = f"M{x1:.1f},{y1:.1f} C{x1 + curve:.1f},{y1:.1f} {x2 - curve:.1f},{y2:.1f} {x2:.1f},{y2:.1f}"
        parts.append(
            f'<path d="{path}" fill="none" stroke="#94a3b8" stroke-width="1.3" '
            f'opacity="0.72" marker-end="url(#arrow)"><title>{html.escape(edge["rel"])}</title></path>'
        )

    for node in lineage["nodes"]:
        if node["id"] not in positions:
            continue
        x, y = positions[node["id"]]
        key, label = category_for_node(node["id"], components)
        content = str(node.get("content") or node["id"])
        short = content if len(content) <= 20 else content[:19] + "…"
        parts.extend([
            f'<g><rect x="{x}" y="{y}" width="{box_width}" height="{box_height}" rx="10" '
            f'fill="{colors.get(key, "#e2e8f0")}" stroke="#64748b" stroke-width="1"/>',
            f'<text x="{x + 8}" y="{y + 20}" font-family="system-ui,sans-serif" '
            f'font-size="10" font-weight="700" fill="#475569">{html.escape(label)}</text>',
            f'<text x="{x + 8}" y="{y + 41}" font-family="system-ui,sans-serif" '
            f'font-size="11" fill="#0f172a">{html.escape(short)}</text>',
            f'<title>{html.escape(content)} · {html.escape(node["id"])}</title></g>',
        ])

    delta = abs(candidate.value - baseline.value)
    footer_y = graph_height + 20
    parts.extend([
        f'<rect x="20" y="{footer_y}" width="{width - 40}" height="104" rx="14" '
        'fill="#0f172a"/>',
        f'<text x="42" y="{footer_y + 32}" font-family="ui-monospace,monospace" '
        'font-size="16" font-weight="700" fill="#f8fafc">'
        f'{baseline.value} → {candidate.value} · |Δ|={delta:.12g} ≤ {ABSOLUTE_TOLERANCE}</text>',
        f'<text x="42" y="{footer_y + 59}" font-family="system-ui,sans-serif" '
        'font-size="14" fill="#a7f3d0">resultMatch=true · replicationStatus=matched · relation=replicates</text>',
        f'<text x="42" y="{footer_y + 84}" font-family="system-ui,sans-serif" '
        'font-size="12" fill="#cbd5e1">Output digests differ and remain visible as '
        'explicit_comparator_match_with_observed_change.</text>',
        "</svg>",
    ])
    return "\n".join(parts) + "\n"


def html_document(
    baseline: DemoRun,
    candidate: DemoRun,
    comparison: dict[str, Any],
    svg: str,
) -> str:
    rows = "\n".join(
        f"<tr><td>{html.escape(label)}</td><td>{left}</td><td>{right}</td></tr>"
        for label, left, right in coverage_rows(baseline, candidate)
    )
    comparison_json = html.escape(json.dumps(comparison, ensure_ascii=False, indent=2, sort_keys=True))
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SciForge DAG v3 可复跑 Demo</title>
  <style>
    :root {{ color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }}
    body {{ margin: 0; background: #eef2f6; color: #0f172a; }}
    main {{ max-width: 1500px; margin: 0 auto; padding: 32px; }}
    h1 {{ margin-bottom: 8px; }} .muted {{ color: #64748b; }}
    .cards {{ display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; margin: 24px 0; }}
    .card, section {{ background: white; border: 1px solid #dbe3ec; border-radius: 14px; padding: 18px; }}
    .value {{ font: 700 20px ui-monospace, monospace; margin-top: 8px; }}
    section {{ margin: 18px 0; overflow: auto; }}
    svg {{ width: 100%; height: auto; min-width: 1100px; }}
    table {{ width: 100%; border-collapse: collapse; }} th, td {{ padding: 9px; border-bottom: 1px solid #e2e8f0; text-align: left; }}
    pre {{ background: #0f172a; color: #e2e8f0; padding: 16px; border-radius: 10px; overflow: auto; }}
    a {{ color: #0369a1; }}
  </style>
</head>
<body><main>
  <h1>SciForge DAG v3 可复跑 Demo</h1>
  <p class="muted">确定性事实层示例：无网络、无模型、同一输入、可解释输出差异。</p>
  <div class="cards">
    <div class="card">Baseline<div class="value">{baseline.value}</div></div>
    <div class="card">Candidate<div class="value">{candidate.value}</div></div>
    <div class="card">Absolute tolerance<div class="value">{ABSOLUTE_TOLERANCE}</div></div>
    <div class="card">Replication<div class="value">{html.escape(comparison['replicationStatus'])}</div></div>
  </div>
  <section>{svg}</section>
  <section><h2>九类 coverage</h2><table><thead><tr><th>组件</th><th>Baseline</th><th>Candidate</th></tr></thead><tbody>{rows}</tbody></table></section>
  <section><h2>可复核产物</h2><p>
    <a href="lineage.json">lineage.json</a> ·
    <a href="baseline.sciforge-rerun.json">baseline spec</a> ·
    <a href="candidate.sciforge-rerun.json">candidate spec</a> ·
    <a href="comparison.json">comparison.json</a> ·
    <a href="report.md">report.md</a>
  </p></section>
  <section><h2>Comparison</h2><pre>{comparison_json}</pre></section>
</main></body></html>
"""


def write_bundle(
    output_dir: Path,
    baseline: DemoRun,
    candidate: DemoRun,
    comparison: dict[str, Any],
) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    lineage_payload = {
        "demoVersion": DEMO_VERSION,
        "fixedTime": FIXED_TIME,
        "baseline": {
            "graph": baseline.graph.to_dict(),
            "snapshot": baseline.snapshot.to_dict(),
            "conclusionLineage": baseline.lineage,
            "outputValues": output_values_json(baseline),
        },
        "candidate": {
            "graph": candidate.graph.to_dict(),
            "snapshot": candidate.snapshot.to_dict(),
            "conclusionLineage": candidate.lineage,
            "outputValues": output_values_json(candidate),
        },
    }
    paths = {
        "lineage": output_dir / "lineage.json",
        "baseline": output_dir / "baseline.sciforge-rerun.json",
        "candidate": output_dir / "candidate.sciforge-rerun.json",
        "comparison": output_dir / "comparison.json",
        "report": output_dir / "report.md",
        "svg": output_dir / "dag-v3-demo.svg",
        "html": output_dir / "index.html",
    }
    write_json(paths["lineage"], lineage_payload)
    write_json(paths["baseline"], baseline.spec)
    write_json(paths["candidate"], candidate.spec)
    write_json(paths["comparison"], comparison)
    paths["report"].write_text(
        report_markdown(baseline, candidate, comparison), encoding="utf-8",
    )
    svg = svg_document(baseline, candidate, comparison)
    paths["svg"].write_text(svg, encoding="utf-8")
    paths["html"].write_text(
        html_document(baseline, candidate, comparison, svg), encoding="utf-8",
    )
    return list(paths.values())


def print_summary(
    output_dir: Path,
    baseline: DemoRun,
    candidate: DemoRun,
    comparison: dict[str, Any],
    paths: list[Path],
) -> None:
    delta = abs(candidate.value - baseline.value)
    coverage = "、".join(
        f"{label}={left}/{right}" for label, left, right in coverage_rows(baseline, candidate)
    )
    print("SciForge DAG v3 确定性离线 Demo：验证通过")
    print(f"输出目录：{output_dir}")
    print(f"九类 coverage（baseline/candidate）：{coverage}")
    print(f"同一输入：{str(comparison['sameInput']).lower()}")
    print(
        f"数值输出：{baseline.value} → {candidate.value}；"
        f"|Δ|={delta:.12g} ≤ tolerance={ABSOLUTE_TOLERANCE}"
    )
    print(f"输出 digest 发生变化并被记录：{baseline.output_digest != candidate.output_digest}")
    print(
        "复制判定："
        f"resultMatch={str(comparison['resultMatch']).lower()}，"
        f"replicationStatus={comparison['replicationStatus']}，"
        f"relation={comparison['replicationRelation']}"
    )
    print("生成文件：" + "、".join(path.name for path in paths))


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="生成无需网络或模型的 SciForge DAG v3 可复跑 Demo。",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path.cwd() / "reproducible-dag-v3-demo-output",
        help="产物目录（默认：./reproducible-dag-v3-demo-output）",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    baseline = build_demo_run("baseline", BASELINE_VALUE)
    candidate = build_demo_run("candidate", CANDIDATE_VALUE)
    assert_complete_run(baseline)
    assert_complete_run(candidate)
    comparison = compare_runs(baseline, candidate)
    output_dir = args.output.expanduser().resolve()
    paths = write_bundle(output_dir, baseline, candidate, comparison)
    print_summary(output_dir, baseline, candidate, comparison, paths)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
