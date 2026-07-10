"""Canonical data contracts for a thread-scoped Evidence DAG.

Semantic node identity is intentionally independent from Artifact byte identity:
nodes use a domain-separated digest of normalized meaning, while ArtifactVersion
uses a SHA-256 digest of the original bytes (or a canonical external payload).
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional


class NodeType(str, Enum):
    SOURCE_ASSERTION = "source_assertion"
    REASONING = "reasoning"
    CLAIM = "claim"
    FINDING = "finding"
    ASSUMPTION = "assumption"
    ARTIFACT = "artifact"
    DATASET_VERSION = "dataset_version"
    OBSERVATION = "observation"
    EXPERIMENT_RUN = "experiment_run"
    ANALYSIS_RUN = "analysis_run"
    SOFTWARE_VERSION = "software_version"
    ENVIRONMENT = "environment"
    AGENT = "agent"


class NodeStatus(str, Enum):
    SUPPORTED = "supported"
    FRAGILE = "fragile"
    CONFLICTED = "conflicted"
    INVALIDATED = "invalidated"
    UNDETERMINED = "undetermined"


class EdgeRel(str, Enum):
    SUPPORTS = "supports"
    CONTRADICTS = "contradicts"
    REFINES = "refines"
    PREREQUISITE = "prerequisite"
    EXTRACTED_FROM = "extracted_from"
    USED = "used"
    GENERATED_BY = "generated_by"
    DERIVED_FROM = "derived_from"
    ASSOCIATED_WITH = "associated_with"
    ATTRIBUTED_TO = "attributed_to"
    SAME_AS = "same_as"
    VERSION_OF = "version_of"
    SUPERSEDES = "supersedes"
    INVALIDATES = "invalidates"
    REPLICATES = "replicates"
    FAILS_TO_REPLICATE = "fails_to_replicate"


class EdgeFamily(str, Enum):
    EPISTEMIC = "epistemic"
    PROVENANCE = "provenance"
    ASSOCIATION = "association"
    IDENTITY = "identity"
    VERSION = "version"
    INVALIDATION = "invalidation"
    REPLICATION = "replication"


EDGE_FAMILY: dict[EdgeRel, EdgeFamily] = {
    EdgeRel.SUPPORTS: EdgeFamily.EPISTEMIC,
    EdgeRel.CONTRADICTS: EdgeFamily.EPISTEMIC,
    EdgeRel.REFINES: EdgeFamily.EPISTEMIC,
    EdgeRel.PREREQUISITE: EdgeFamily.EPISTEMIC,
    EdgeRel.EXTRACTED_FROM: EdgeFamily.PROVENANCE,
    EdgeRel.USED: EdgeFamily.PROVENANCE,
    EdgeRel.GENERATED_BY: EdgeFamily.PROVENANCE,
    EdgeRel.DERIVED_FROM: EdgeFamily.PROVENANCE,
    EdgeRel.ASSOCIATED_WITH: EdgeFamily.ASSOCIATION,
    EdgeRel.ATTRIBUTED_TO: EdgeFamily.ASSOCIATION,
    EdgeRel.SAME_AS: EdgeFamily.IDENTITY,
    EdgeRel.VERSION_OF: EdgeFamily.VERSION,
    EdgeRel.SUPERSEDES: EdgeFamily.VERSION,
    EdgeRel.INVALIDATES: EdgeFamily.INVALIDATION,
    EdgeRel.REPLICATES: EdgeFamily.REPLICATION,
    EdgeRel.FAILS_TO_REPLICATE: EdgeFamily.REPLICATION,
}

# These relations describe causal/source derivation and must remain acyclic.
# Symmetric/adversarial families (identity, contradiction, replication) are
# deliberately excluded because cycles are meaningful there.
ACYCLIC_LINEAGE_RELS = frozenset({
    EdgeRel.EXTRACTED_FROM,
    EdgeRel.USED,
    EdgeRel.GENERATED_BY,
    EdgeRel.DERIVED_FROM,
    EdgeRel.VERSION_OF,
    EdgeRel.SUPERSEDES,
})


class AssessmentDimension(str, Enum):
    INTEGRITY = "integrity"
    PROVENANCE = "provenance"
    ENTAILMENT = "entailment"
    METHODOLOGY = "methodology"
    APPLICABILITY = "applicability"
    REPRODUCIBILITY = "reproducibility"


class AssessmentLevel(str, Enum):
    A0 = "A0"
    A1 = "A1"
    A2 = "A2"
    A3 = "A3"
    HUMAN = "human"


class AssessmentResult(str, Enum):
    PASSED = "passed"
    FAILED = "failed"
    UNCERTAIN = "uncertain"
    OVERRIDDEN = "overridden"


def normalize(text: str) -> str:
    """Whitespace/case-normalized text used only for semantic identity."""
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def semantic_digest(ntype: "NodeType | str", content: str, identity_scope: Optional[str] = None) -> str:
    t = ntype.value if isinstance(ntype, NodeType) else str(ntype)
    return hashlib.sha256(
        f"semantic-node-v1|{t}|{normalize(content)}|{identity_scope or ''}".encode("utf-8")
    ).hexdigest()


def make_node_id(ntype: "NodeType | str", content: str, identity_scope: Optional[str] = None) -> str:
    t = ntype.value if isinstance(ntype, NodeType) else str(ntype)
    return f"{t}:{semantic_digest(ntype, content, identity_scope)[:24]}"


def make_edge_id(src: str, dst: str, rel: "EdgeRel | str") -> str:
    r = rel.value if isinstance(rel, EdgeRel) else str(rel)
    digest = hashlib.sha256(f"semantic-edge-v1|{src}|{dst}|{r}".encode("utf-8")).hexdigest()
    return f"edge:{digest[:24]}"


def normalize_sha256(value: Optional[str]) -> Optional[str]:
    if value is None or not str(value).strip():
        return None
    raw = str(value).strip().lower()
    if raw.startswith("sha256:"):
        raw = raw[7:]
    if not re.fullmatch(r"[0-9a-f]{64}", raw):
        raise ValueError("content digest must be a SHA-256 hex digest")
    return f"sha256:{raw}"


@dataclass(frozen=True)
class SourceSelector:
    """Structured source location. Free-form locator strings are not accepted."""

    type: str
    page: Optional[int] = None
    section: Optional[str] = None
    table: Optional[str] = None
    figure: Optional[str] = None
    row_range: Optional[str] = None
    column_names: tuple[str, ...] = ()
    line_range: Optional[str] = None
    quote: Optional[str] = None
    query: Optional[dict[str, Any]] = None

    TYPES = frozenset({"pdf", "text", "table", "figure", "code", "dataset", "web"})

    def __post_init__(self) -> None:
        if self.type not in self.TYPES:
            raise ValueError(f"unsupported selector type: {self.type}")
        if self.page is not None and (not isinstance(self.page, int) or self.page < 1):
            raise ValueError("selector.page must be a positive integer")
        if self.row_range is not None and not re.fullmatch(r"\d+:\d+", self.row_range):
            raise ValueError("selector.rowRange must use start:end integer syntax")
        if self.line_range is not None and not re.fullmatch(r"\d+:\d+", self.line_range):
            raise ValueError("selector.lineRange must use start:end integer syntax")
        if not any((self.page, self.section, self.table, self.figure, self.row_range,
                    self.column_names, self.line_range, self.quote, self.query)):
            raise ValueError("selector must contain at least one structured location field")

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {"type": self.type}
        for key, value in (
            ("page", self.page), ("section", self.section), ("table", self.table),
            ("figure", self.figure), ("rowRange", self.row_range),
            ("columnNames", list(self.column_names) if self.column_names else None),
            ("lineRange", self.line_range), ("quote", self.quote), ("query", self.query),
        ):
            if value is not None:
                result[key] = value
        return result

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "SourceSelector":
        if not isinstance(value, dict):
            raise ValueError("selector must be an object")
        allowed = {"type", "page", "section", "table", "figure", "rowRange",
                   "columnNames", "lineRange", "quote", "query"}
        unexpected = set(value) - allowed
        if unexpected:
            raise ValueError(f"unsupported selector field(s): {', '.join(sorted(unexpected))}")
        columns = value.get("columnNames") or []
        if not isinstance(columns, list) or not all(isinstance(x, str) and x for x in columns):
            raise ValueError("selector.columnNames must be a list of non-empty strings")
        query = value.get("query")
        if query is not None and not isinstance(query, dict):
            raise ValueError("selector.query must be an object")
        return cls(
            type=str(value.get("type", "")).strip().lower(),
            page=value.get("page"),
            section=value.get("section"),
            table=value.get("table"),
            figure=value.get("figure"),
            row_range=value.get("rowRange"),
            column_names=tuple(columns),
            line_range=value.get("lineRange"),
            quote=value.get("quote"),
            query=query,
        )


@dataclass
class Artifact:
    artifact_id: str
    kind: str
    created_at: str
    current_version_id: str
    access_policy: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "artifactId": self.artifact_id,
            "kind": self.kind,
            "createdAt": self.created_at,
            "currentVersionId": self.current_version_id,
            "accessPolicy": self.access_policy,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Artifact":
        return cls(
            artifact_id=d["artifactId"], kind=d["kind"], created_at=d["createdAt"],
            current_version_id=d["currentVersionId"], access_policy=d.get("accessPolicy") or {},
        )


@dataclass
class ArtifactVersion:
    version_id: str
    artifact_id: str
    locator: str
    content_digest: Optional[str]
    version: Optional[str]
    size: Optional[int]
    media_type: Optional[str]
    observed_at: str
    availability: str
    retention: str
    historical_locators: list[str] = field(default_factory=list)
    rebind_candidates: list[str] = field(default_factory=list)
    supersedes: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "versionId": self.version_id,
            "artifactId": self.artifact_id,
            "locator": self.locator,
            "contentDigest": self.content_digest,
            "version": self.version,
            "size": self.size,
            "mediaType": self.media_type,
            "observedAt": self.observed_at,
            "availability": self.availability,
            "retention": self.retention,
            "historicalLocators": list(self.historical_locators),
            "rebindCandidates": list(self.rebind_candidates),
            "supersedes": self.supersedes,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "ArtifactVersion":
        return cls(
            version_id=d["versionId"], artifact_id=d["artifactId"], locator=d["locator"],
            content_digest=normalize_sha256(d.get("contentDigest")), version=d.get("version"),
            size=d.get("size"), media_type=d.get("mediaType"), observed_at=d["observedAt"],
            availability=d["availability"], retention=d["retention"],
            historical_locators=list(d.get("historicalLocators") or []),
            rebind_candidates=list(d.get("rebindCandidates") or []), supersedes=d.get("supersedes"),
        )


@dataclass(frozen=True)
class SourceAnchor:
    anchor_id: str
    artifact_id: str
    artifact_version_id: str
    selector: SourceSelector
    anchor_digest: str
    created_at: str
    access_policy: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "anchorId": self.anchor_id,
            "artifactId": self.artifact_id,
            "artifactVersionId": self.artifact_version_id,
            "selector": self.selector.to_dict(),
            "anchorDigest": self.anchor_digest,
            "createdAt": self.created_at,
            "accessPolicy": self.access_policy,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "SourceAnchor":
        return cls(
            anchor_id=d["anchorId"], artifact_id=d["artifactId"],
            artifact_version_id=d["artifactVersionId"],
            selector=SourceSelector.from_dict(d["selector"]),
            anchor_digest=normalize_sha256(d.get("anchorDigest")) or "",
            created_at=d["createdAt"], access_policy=d.get("accessPolicy") or {},
        )


@dataclass(frozen=True)
class Assessment:
    assessment_id: str
    target_id: str
    dimension: AssessmentDimension
    level: AssessmentLevel
    result: AssessmentResult
    actor: str
    method: str
    confidence: float
    target_digest: str
    created_at: str
    rationale: Optional[str] = None

    def __post_init__(self) -> None:
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError("assessment confidence must be in [0,1]")
        if not self.actor or not self.method:
            raise ValueError("assessment actor and method are required")

    def to_dict(self) -> dict[str, Any]:
        result = {
            "assessmentId": self.assessment_id,
            "targetId": self.target_id,
            "dimension": self.dimension.value,
            "level": self.level.value,
            "result": self.result.value,
            "actor": self.actor,
            "method": self.method,
            "confidence": self.confidence,
            "targetDigest": self.target_digest,
            "createdAt": self.created_at,
        }
        if self.rationale:
            result["rationale"] = self.rationale
        return result

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Assessment":
        return cls(
            assessment_id=d["assessmentId"], target_id=d["targetId"],
            dimension=AssessmentDimension(d["dimension"]), level=AssessmentLevel(d["level"]),
            result=AssessmentResult(d["result"]), actor=d["actor"], method=d["method"],
            confidence=float(d["confidence"]), target_digest=d["targetDigest"],
            created_at=d["createdAt"], rationale=d.get("rationale"),
        )


@dataclass
class Node:
    id: str
    type: NodeType
    content: str
    status: NodeStatus = NodeStatus.UNDETERMINED
    trace_refs: list[str] = field(default_factory=list)
    created_at: Optional[str] = None
    created_by: Optional[str] = None
    atms_label: list = field(default_factory=list)
    source_type: Optional[str] = None
    credibility: Optional[str] = None
    source_quality: Optional[float] = None
    retracted: Optional[bool] = None
    valid_from: Optional[str] = None
    valid_to: Optional[str] = None
    reasoning_type: Optional[str] = None
    artifact_id: Optional[str] = None
    artifact_version_id: Optional[str] = None
    source_anchor_id: Optional[str] = None
    freshness: str = "fresh"
    external_id: Optional[str] = None
    attributes: dict[str, Any] = field(default_factory=dict)

    def merge_occurrence(self, other: "Node") -> None:
        for value in other.trace_refs:
            if value not in self.trace_refs:
                self.trace_refs.append(value)
        if self.external_id and other.external_id == self.external_id:
            # A later trace item may complete an in-flight run. Historical
            # snapshots remain immutable; the next snapshot carries the most
            # recently observed explicit metadata for that same run identity.
            self.attributes.update(other.attributes)
            for field_name in ("artifact_id", "artifact_version_id", "source_anchor_id"):
                value = getattr(other, field_name)
                if value:
                    setattr(self, field_name, value)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "type": self.type.value, "content": self.content,
            "status": self.status.value, "trace_refs": list(self.trace_refs),
            "created_at": self.created_at, "created_by": self.created_by,
            "atms_label": self.atms_label, "source_type": self.source_type,
            "credibility": self.credibility, "source_quality": self.source_quality,
            "retracted": self.retracted, "valid_from": self.valid_from, "valid_to": self.valid_to,
            "reasoning_type": self.reasoning_type, "artifact_id": self.artifact_id,
            "artifact_version_id": self.artifact_version_id,
            "source_anchor_id": self.source_anchor_id, "freshness": self.freshness,
            "external_id": self.external_id, "attributes": self.attributes,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Node":
        return cls(
            id=d["id"], type=NodeType(d["type"]), content=d.get("content", ""),
            status=NodeStatus(d.get("status", "undetermined")),
            trace_refs=list(d.get("trace_refs") or []), created_at=d.get("created_at"),
            created_by=d.get("created_by"), atms_label=d.get("atms_label", []) or [],
            source_type=d.get("source_type"), credibility=d.get("credibility"),
            source_quality=d.get("source_quality"), retracted=d.get("retracted"),
            valid_from=d.get("valid_from"), valid_to=d.get("valid_to"),
            reasoning_type=d.get("reasoning_type"), artifact_id=d.get("artifact_id"),
            artifact_version_id=d.get("artifact_version_id"),
            source_anchor_id=d.get("source_anchor_id"),
            freshness=d.get("freshness", "fresh"),
            external_id=d.get("external_id"),
            attributes=dict(d.get("attributes") or {}),
        )


@dataclass
class Edge:
    id: str
    src: str
    dst: str
    rel: EdgeRel
    nli_score: Optional[float] = None
    created_at: Optional[str] = None
    assessment_ids: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "src": self.src, "dst": self.dst, "rel": self.rel.value,
            "family": EDGE_FAMILY[self.rel].value,
            "nli_score": self.nli_score, "created_at": self.created_at,
            "assessment_ids": list(self.assessment_ids),
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Edge":
        return cls(
            id=d["id"], src=d["src"], dst=d["dst"], rel=EdgeRel(d["rel"]),
            nli_score=d.get("nli_score"), created_at=d.get("created_at"),
            assessment_ids=list(d.get("assessment_ids") or []),
        )
