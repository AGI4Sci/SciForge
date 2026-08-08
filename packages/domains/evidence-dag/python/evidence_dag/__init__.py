"""SciForge Evidence DAG compiler and immutable snapshot contracts."""
from .artifact_versions import (
    ArtifactVersionProjectionClient,
    ArtifactVersionProjectionError,
    ArtifactVersionRefV1,
)
from .datacite import (
    DataCiteCreator,
    DataCiteDescription,
    DataCiteProject,
    DataCiteResource,
    GitCommit,
    ImportedDataCite,
    RelatedIdentifier,
    datacite_digest,
    export_datacite,
    import_datacite,
)
from .graph import ThreadGraph
from .lineage import ingest_trace_lineage, reproducibility_report
from .model import (
    Artifact,
    ArtifactVersion,
    Assessment,
    Edge,
    EdgeRel,
    EdgeFamily,
    HumanReview,
    HumanReviewActorType,
    HumanReviewAuthority,
    HumanReviewChecker,
    HumanReviewLevel,
    HumanReviewReason,
    HumanReviewStatus,
    Node,
    NodeStatus,
    NodeType,
    ReviewPacket,
    SourceAnchor,
    SourceSelector,
)
from .rocrate import (
    ImportedRoCrate,
    export_ro_crate,
    import_ro_crate,
    read_ro_crate,
    write_ro_crate,
)
from .products import export_snapshot_products, source_artifact_version_refs
from .rerun import (
    RERUN_SCHEMA_VERSION,
    build_rerun_spec,
    compare_rerun_specs,
    output_values_for_spec,
    validate_rerun_spec,
)
from .service import Engine
from .snapshot import EvidenceSnapshot

__version__ = "1.0.0"

__all__ = [
    "ThreadGraph", "Engine",
    "Node", "Edge", "NodeType", "NodeStatus", "EdgeRel", "EdgeFamily",
    "Artifact", "ArtifactVersion", "ArtifactVersionRefV1",
    "ArtifactVersionProjectionClient", "ArtifactVersionProjectionError",
    "SourceAnchor", "SourceSelector",
    "Assessment", "EvidenceSnapshot", "HumanReview", "HumanReviewLevel",
    "HumanReviewStatus", "HumanReviewActorType", "HumanReviewAuthority",
    "HumanReviewChecker", "HumanReviewReason", "ReviewPacket",
    "ingest_trace_lineage", "reproducibility_report",
    "ImportedRoCrate", "export_ro_crate", "import_ro_crate",
    "read_ro_crate", "write_ro_crate",
    "DataCiteCreator", "DataCiteDescription", "DataCiteProject", "DataCiteResource",
    "GitCommit", "RelatedIdentifier", "ImportedDataCite",
    "datacite_digest", "export_datacite", "import_datacite",
    "export_snapshot_products", "source_artifact_version_refs",
    "RERUN_SCHEMA_VERSION", "build_rerun_spec", "compare_rerun_specs",
    "output_values_for_spec", "validate_rerun_spec",
    "__version__",
]
