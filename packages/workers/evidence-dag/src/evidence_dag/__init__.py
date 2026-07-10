"""SciForge Evidence DAG compiler and immutable snapshot contracts."""
from .artifacts import ArtifactRegistry
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
    Node,
    NodeStatus,
    NodeType,
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
from .service import Engine
from .snapshot import EvidenceSnapshot

__version__ = "0.2.0"

__all__ = [
    "ThreadGraph", "Engine",
    "Node", "Edge", "NodeType", "NodeStatus", "EdgeRel", "EdgeFamily",
    "Artifact", "ArtifactVersion", "ArtifactRegistry", "SourceAnchor", "SourceSelector",
    "Assessment", "EvidenceSnapshot",
    "ingest_trace_lineage", "reproducibility_report",
    "ImportedRoCrate", "export_ro_crate", "import_ro_crate",
    "read_ro_crate", "write_ro_crate",
    "DataCiteCreator", "DataCiteDescription", "DataCiteProject", "DataCiteResource",
    "GitCommit", "RelatedIdentifier", "ImportedDataCite",
    "datacite_digest", "export_datacite", "import_datacite",
    "__version__",
]
