"""Strict, reference-first DataCite metadata for scientific resources.

The module emits the DataCite REST JSON shape for either one Project or one
ArtifactVersion.  It deliberately does not read or embed Artifact bytes.  An
import is accepted only when it is bound to the caller's authoritative
Artifact/ArtifactVersion/Project identities and to an externally retained
metadata digest; the DataCite document is not a mutable Evidence ingest path.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Optional
from urllib.parse import quote, urlparse

from .model import Artifact, ArtifactVersion, normalize_sha256


DATACITE_SCHEMA_VERSION = "http://datacite.org/schema/kernel-4"
DATACITE_EXCHANGE_VERSION = "sciforge-datacite.v1"

_RESOURCE_TYPES = frozenset({
    "Audiovisual", "Award", "Book", "BookChapter", "Collection",
    "ComputationalNotebook", "ConferencePaper", "ConferenceProceeding",
    "DataPaper", "Dataset", "Dissertation", "Event", "Image",
    "InteractiveResource", "Instrument", "Journal", "JournalArticle",
    "Model", "OutputManagementPlan", "PeerReview", "PhysicalObject",
    "Preprint", "Project", "Report", "Service", "Software", "Sound",
    "Standard", "StudyRegistration", "Text", "Workflow", "Other",
})
_KIND_RESOURCE_TYPE = {
    "paper": "Text",
    "dataset": "Dataset",
    "code": "Software",
    "notebook": "ComputationalNotebook",
    "image": "Image",
    "log": "Other",
    "model": "Model",
    "other": "Other",
}
_RELATION_TYPES = frozenset({
    "IsCitedBy", "Cites", "IsSupplementTo", "IsSupplementedBy",
    "IsContinuedBy", "Continues", "IsDescribedBy", "Describes",
    "HasMetadata", "IsMetadataFor", "HasVersion", "IsVersionOf",
    "IsNewVersionOf", "IsPreviousVersionOf", "IsPartOf", "HasPart",
    "IsPublishedIn", "IsReferencedBy", "References", "IsDocumentedBy",
    "Documents", "IsCompiledBy", "Compiles", "IsVariantFormOf",
    "IsOriginalFormOf", "IsIdenticalTo", "IsReviewedBy", "Reviews",
    "IsDerivedFrom", "IsSourceOf", "IsRequiredBy", "Requires",
    "Obsoletes", "IsObsoletedBy", "Collects", "IsCollectedBy",
})
_RELATED_IDENTIFIER_TYPES = frozenset({"DOI", "URL", "URN"})
_DESCRIPTION_TYPES = frozenset({
    "Abstract", "Methods", "SeriesInformation", "TableOfContents",
    "TechnicalInfo", "Other",
})
_DOI_RE = re.compile(r"10\.\d{4,9}/[-._;()/:a-z0-9]+", re.IGNORECASE)
_SWHID_RE = re.compile(r"swh:1:(?:cnt|dir|rev|rel|snp):[0-9a-f]{40}")
_GIT_COMMIT_RE = re.compile(r"(?:[0-9a-f]{40}|[0-9a-f]{64})")
_URN_RE = re.compile(r"urn:[a-z0-9][a-z0-9-]{0,31}:[^\s]+", re.IGNORECASE)
_LANGUAGE_RE = re.compile(r"[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*")
_ORCID_RE = re.compile(r"(?:https://orcid\.org/)?(\d{4}-\d{4}-\d{4}-[\dX]{4})")


def _required_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} is required")
    result = value.strip()
    if any(ord(char) < 32 for char in result):
        raise ValueError(f"{field} contains control characters")
    return result


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _canonical_doi(value: str) -> str:
    raw = _required_text(value, "DOI")
    lower = raw.lower()
    if lower.startswith("https://doi.org/"):
        raw = raw[len("https://doi.org/"):]
    elif lower.startswith("http://doi.org/"):
        raw = raw[len("http://doi.org/"):]
    elif lower.startswith("doi:"):
        raw = raw[4:]
    raw = raw.strip().lower()
    if len(raw) > 255 or _DOI_RE.fullmatch(raw) is None:
        raise ValueError("invalid DOI")
    return raw


def _canonical_url(value: str, field: str = "URL") -> str:
    raw = _required_text(value, field)
    if any(char.isspace() for char in raw):
        raise ValueError(f"invalid {field}")
    parsed = urlparse(raw)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"invalid {field}")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError(f"{field} must not contain credentials")
    try:
        parsed.port
    except ValueError as exc:
        raise ValueError(f"invalid {field}") from exc
    return raw


def _canonical_urn(value: str) -> str:
    raw = _required_text(value, "URN")
    if _URN_RE.fullmatch(raw) is None:
        raise ValueError("invalid URN")
    return "urn:" + raw[4:]


def _canonical_swhid(value: str) -> str:
    raw = _required_text(value, "SWHID").lower()
    if raw.startswith("swhid:"):
        raw = raw[6:]
    if _SWHID_RE.fullmatch(raw) is None:
        raise ValueError("invalid core SWHID")
    return raw


def _canonical_git_commit(value: str) -> str:
    raw = _required_text(value, "Git commit").lower()
    if _GIT_COMMIT_RE.fullmatch(raw) is None:
        raise ValueError("Git commit must be a full 40 or 64 hexadecimal object id")
    return raw


def _canonical_orcid(value: str) -> str:
    raw = _required_text(value, "ORCID")
    match = _ORCID_RE.fullmatch(raw)
    if match is None:
        raise ValueError("invalid ORCID")
    compact = match.group(1).replace("-", "")
    total = 0
    for char in compact[:-1]:
        total = (total + int(char)) * 2
    remainder = (12 - (total % 11)) % 11
    expected = "X" if remainder == 10 else str(remainder)
    if compact[-1] != expected:
        raise ValueError("invalid ORCID checksum")
    return f"https://orcid.org/{match.group(1)}"


def ro_crate_identity(kind: str, identifier: str) -> str:
    """Return the exact identity used by ``evidence_dag.rocrate`` records."""
    kind = _required_text(kind, "RO-Crate identity kind")
    identifier = _required_text(identifier, "RO-Crate identifier")
    return f"urn:sciforge:ro-crate:{kind}:{quote(identifier, safe='')}"


def project_identity(project_id: str) -> str:
    return f"urn:sciforge:project:{quote(_required_text(project_id, 'project id'), safe='')}"


@dataclass(frozen=True)
class DataCiteCreator:
    name: str
    name_type: Optional[str] = None
    given_name: Optional[str] = None
    family_name: Optional[str] = None
    orcid: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {"name": _required_text(self.name, "creator.name")}
        if self.name_type is not None:
            if self.name_type not in {"Personal", "Organizational"}:
                raise ValueError("creator.nameType must be Personal or Organizational")
            result["nameType"] = self.name_type
        if self.given_name is not None or self.family_name is not None:
            if self.name_type != "Personal":
                raise ValueError("creator given/family names require nameType Personal")
            if self.given_name is not None:
                result["givenName"] = _required_text(self.given_name, "creator.givenName")
            if self.family_name is not None:
                result["familyName"] = _required_text(self.family_name, "creator.familyName")
        if self.orcid is not None:
            result["nameIdentifiers"] = [{
                "nameIdentifier": _canonical_orcid(self.orcid),
                "nameIdentifierScheme": "ORCID",
                "schemeUri": "https://orcid.org",
            }]
        return result


@dataclass(frozen=True)
class DataCiteDescription:
    description: str
    description_type: str

    def to_dict(self) -> dict[str, str]:
        if self.description_type not in _DESCRIPTION_TYPES:
            raise ValueError("unsupported DataCite descriptionType")
        return {
            "description": _required_text(self.description, "description"),
            "descriptionType": self.description_type,
        }


@dataclass(frozen=True)
class DataCiteResource:
    """Explicit discovery metadata; mandatory fields are never inferred."""

    title: str
    creators: tuple[DataCiteCreator, ...]
    publisher: str
    publication_year: int
    doi: Optional[str] = None
    resource_type: Optional[str] = None
    language: Optional[str] = None
    landing_page: Optional[str] = None
    descriptions: tuple[DataCiteDescription, ...] = ()

    def validate(self) -> None:
        _required_text(self.title, "title")
        if not self.creators:
            raise ValueError("at least one creator is required")
        for creator in self.creators:
            creator.to_dict()
        _required_text(self.publisher, "publisher")
        if (
            not isinstance(self.publication_year, int)
            or isinstance(self.publication_year, bool)
            or self.publication_year < 1000
            or self.publication_year > 9999
        ):
            raise ValueError("publicationYear must be a four-digit integer")
        if self.doi is not None:
            _canonical_doi(self.doi)
        if self.resource_type is not None:
            _required_text(self.resource_type, "resourceType")
        if self.language is not None and _LANGUAGE_RE.fullmatch(self.language) is None:
            raise ValueError("language must be a BCP 47 language tag")
        if self.landing_page is not None:
            _canonical_url(self.landing_page, "landing page")
        for description in self.descriptions:
            description.to_dict()


@dataclass(frozen=True)
class DataCiteProject:
    project_id: str

    def __post_init__(self) -> None:
        _required_text(self.project_id, "project id")


@dataclass(frozen=True)
class RelatedIdentifier:
    identifier: str
    identifier_type: str
    relation_type: str
    resource_type_general: Optional[str] = None

    def to_dict(self) -> dict[str, str]:
        if self.identifier_type not in _RELATED_IDENTIFIER_TYPES:
            raise ValueError("relatedIdentifierType must be DOI, URL, or URN")
        if self.relation_type not in _RELATION_TYPES:
            raise ValueError("unsupported DataCite relationType")
        if self.identifier_type == "DOI":
            identifier = _canonical_doi(self.identifier)
        elif self.identifier_type == "URL":
            identifier = _canonical_url(self.identifier, "related URL")
        else:
            identifier = _canonical_urn(self.identifier)
        result = {
            "relatedIdentifier": identifier,
            "relatedIdentifierType": self.identifier_type,
            "relationType": self.relation_type,
        }
        if self.resource_type_general is not None:
            if self.resource_type_general not in _RESOURCE_TYPES:
                raise ValueError("unsupported DataCite resourceTypeGeneral")
            result["resourceTypeGeneral"] = self.resource_type_general
        return result


@dataclass(frozen=True)
class GitCommit:
    repository_url: str
    commit: str

    def normalized(self) -> tuple[str, str]:
        return (
            _canonical_url(self.repository_url, "Git repository URL"),
            _canonical_git_commit(self.commit),
        )


@dataclass(frozen=True)
class ImportedDataCite:
    document: dict[str, Any]
    metadata_digest: str
    doi: str
    primary_entity_id: str
    artifact_id: Optional[str]
    artifact_version_id: Optional[str]
    project_id: str
    swhid: Optional[str]
    git_commit: Optional[GitCommit]


def _doi_from_locator(locator: str) -> Optional[str]:
    raw = str(locator or "").strip()
    lower = raw.lower()
    if lower.startswith("doi:") or lower.startswith("https://doi.org/") or lower.startswith("http://doi.org/"):
        return _canonical_doi(raw)
    return None


def _swhid_from_locator(locator: str) -> Optional[str]:
    raw = str(locator or "").strip()
    if raw.lower().startswith(("swh:1:", "swhid:swh:1:")):
        return _canonical_swhid(raw)
    return None


def _resource_type(artifact: Optional[Artifact]) -> str:
    if artifact is None:
        return "Project"
    result = _KIND_RESOURCE_TYPE.get(artifact.kind)
    if result is None:
        raise ValueError(f"unsupported Artifact kind for DataCite: {artifact.kind}")
    return result


def _validate_artifact_pair(
    artifact: Optional[Artifact], artifact_version: Optional[ArtifactVersion],
) -> None:
    if (artifact is None) != (artifact_version is None):
        raise ValueError("artifact and artifact_version must be provided together")
    if artifact is None or artifact_version is None:
        return
    if artifact_version.artifact_id != artifact.artifact_id:
        raise ValueError("ArtifactVersion does not belong to Artifact")
    _required_text(artifact.artifact_id, "artifact id")
    _required_text(artifact_version.version_id, "artifact version id")
    _required_text(artifact_version.locator, "artifact locator")
    if artifact_version.content_digest is not None:
        normalize_sha256(artifact_version.content_digest)


def _metadata_identifiers(
    artifact: Optional[Artifact], artifact_version: Optional[ArtifactVersion],
    project: DataCiteProject, swhid: Optional[str], git_commit: Optional[GitCommit],
) -> list[dict[str, str]]:
    if artifact is None or artifact_version is None:
        result = [{
            "identifier": project_identity(project.project_id),
            "identifierType": "SciForgeProject",
        }]
    else:
        result = [{
            "identifier": ro_crate_identity("artifact-version", artifact_version.version_id),
            "identifierType": "SciForgeROCrateArtifactVersion",
        }]
        if artifact_version.content_digest is not None:
            result.append({
                "identifier": normalize_sha256(artifact_version.content_digest) or "",
                "identifierType": "SHA-256",
            })
    if swhid is not None:
        result.append({"identifier": swhid, "identifierType": "SWHID"})
    if git_commit is not None:
        repository, commit = git_commit.normalized()
        result.append({
            "identifier": f"{repository}@{commit}",
            "identifierType": "GitCommit",
        })
    return sorted(result, key=lambda item: (item["identifierType"], item["identifier"]))


def _metadata_relations(
    artifact: Optional[Artifact], artifact_version: Optional[ArtifactVersion],
    project: DataCiteProject, git_commit: Optional[GitCommit],
    related_identifiers: Iterable[RelatedIdentifier], resource_type_general: str,
) -> list[dict[str, str]]:
    relations = [item.to_dict() for item in related_identifiers]
    if artifact is not None and artifact_version is not None:
        relations.extend((
            RelatedIdentifier(
                ro_crate_identity("artifact", artifact.artifact_id), "URN", "IsVersionOf",
                resource_type_general,
            ).to_dict(),
            RelatedIdentifier(
                project_identity(project.project_id), "URN", "IsPartOf", "Project",
            ).to_dict(),
        ))
        if artifact_version.supersedes is not None:
            relations.append(RelatedIdentifier(
                ro_crate_identity("artifact-version", artifact_version.supersedes),
                "URN", "IsNewVersionOf", resource_type_general,
            ).to_dict())
    if git_commit is not None:
        repository, _ = git_commit.normalized()
        relations.append(RelatedIdentifier(
            repository, "URL", "IsVersionOf", "Software",
        ).to_dict())
    canonical = {_canonical_json(item): item for item in relations}
    if len(canonical) != len(relations):
        raise ValueError("duplicate related identifier")
    return [canonical[key] for key in sorted(canonical)]


def export_datacite(
    resource: DataCiteResource,
    project: DataCiteProject,
    *,
    artifact: Optional[Artifact] = None,
    artifact_version: Optional[ArtifactVersion] = None,
    swhid: Optional[str] = None,
    git_commit: Optional[GitCommit] = None,
    related_identifiers: Iterable[RelatedIdentifier] = (),
) -> dict[str, Any]:
    """Export canonical DataCite REST metadata without copying Artifact bytes."""
    resource.validate()
    _validate_artifact_pair(artifact, artifact_version)
    locator_doi = _doi_from_locator(artifact_version.locator) if artifact_version else None
    explicit_doi = _canonical_doi(resource.doi) if resource.doi is not None else None
    if locator_doi is not None and explicit_doi is not None and locator_doi != explicit_doi:
        raise ValueError("resource DOI does not match ArtifactVersion locator")
    doi = explicit_doi or locator_doi
    if doi is None:
        raise ValueError("a DOI is required and cannot be inferred from this resource")

    locator_swhid = _swhid_from_locator(artifact_version.locator) if artifact_version else None
    explicit_swhid = _canonical_swhid(swhid) if swhid is not None else None
    if locator_swhid is not None and explicit_swhid is not None and locator_swhid != explicit_swhid:
        raise ValueError("SWHID does not match ArtifactVersion locator")
    canonical_swhid = explicit_swhid or locator_swhid
    general_type = _resource_type(artifact)
    prefix, suffix = doi.split("/", 1)
    attributes: dict[str, Any] = {
        "doi": doi,
        "prefix": prefix,
        "suffix": suffix,
        "creators": [creator.to_dict() for creator in resource.creators],
        "titles": [{"title": _required_text(resource.title, "title")}],
        "publisher": _required_text(resource.publisher, "publisher"),
        "publicationYear": resource.publication_year,
        "types": {
            "resourceTypeGeneral": general_type,
            **({"resourceType": resource.resource_type} if resource.resource_type else {}),
        },
        "identifiers": _metadata_identifiers(
            artifact, artifact_version, project, canonical_swhid, git_commit,
        ),
        "relatedIdentifiers": _metadata_relations(
            artifact, artifact_version, project, git_commit, related_identifiers, general_type,
        ),
        "schemaVersion": DATACITE_SCHEMA_VERSION,
    }
    if artifact_version is not None and artifact_version.version is not None:
        attributes["version"] = _required_text(artifact_version.version, "ArtifactVersion.version")
    if resource.language is not None:
        attributes["language"] = resource.language
    locator_url = None
    if artifact_version is not None:
        try:
            locator_url = _canonical_url(artifact_version.locator, "ArtifactVersion locator")
        except ValueError:
            locator_url = None
    landing_page = (
        _canonical_url(resource.landing_page, "landing page")
        if resource.landing_page is not None else locator_url
    )
    if landing_page is not None:
        attributes["url"] = landing_page
    if resource.descriptions:
        attributes["descriptions"] = [item.to_dict() for item in resource.descriptions]
    return {"data": {"type": "dois", "id": doi, "attributes": attributes}}


def datacite_digest(document: Mapping[str, Any]) -> str:
    return "sha256:" + hashlib.sha256(
        (DATACITE_EXCHANGE_VERSION + "|" + _canonical_json(document)).encode("utf-8")
    ).hexdigest()


def dumps_datacite(document: Mapping[str, Any], *, indent: Optional[int] = 2) -> str:
    return json.dumps(document, ensure_ascii=False, sort_keys=True, indent=indent)


def _strict_keys(value: Mapping[str, Any], allowed: set[str], label: str) -> None:
    unknown = set(value) - allowed
    if unknown:
        raise ValueError(f"unsupported {label} fields: {sorted(unknown)}")


def _validate_document_shape(document: Mapping[str, Any]) -> tuple[str, dict[str, Any]]:
    _strict_keys(document, {"data"}, "DataCite document")
    data = document.get("data")
    if not isinstance(data, dict):
        raise ValueError("DataCite data must be an object")
    _strict_keys(data, {"type", "id", "attributes"}, "DataCite data")
    if data.get("type") != "dois":
        raise ValueError("DataCite data.type must be dois")
    attributes = data.get("attributes")
    if not isinstance(attributes, dict):
        raise ValueError("DataCite attributes must be an object")
    _strict_keys(attributes, {
        "doi", "prefix", "suffix", "creators", "titles", "publisher",
        "publicationYear", "types", "identifiers", "relatedIdentifiers",
        "schemaVersion", "version", "language", "url", "descriptions",
    }, "DataCite attributes")
    doi = _canonical_doi(attributes.get("doi"))
    if _canonical_doi(data.get("id")) != doi:
        raise ValueError("DataCite id and DOI disagree")
    prefix, suffix = doi.split("/", 1)
    if attributes.get("prefix") != prefix or attributes.get("suffix") != suffix:
        raise ValueError("DataCite DOI prefix or suffix is inconsistent")
    if attributes.get("schemaVersion") != DATACITE_SCHEMA_VERSION:
        raise ValueError("unsupported DataCite schemaVersion")
    if not isinstance(attributes.get("identifiers"), list):
        raise ValueError("DataCite identifiers must be an array")
    if not isinstance(attributes.get("relatedIdentifiers"), list):
        raise ValueError("DataCite relatedIdentifiers must be an array")
    return doi, attributes


def _identifier_map(attributes: Mapping[str, Any]) -> dict[str, str]:
    result: dict[str, str] = {}
    allowed_types = {
        "SciForgeProject", "SciForgeROCrateArtifactVersion", "SHA-256", "SWHID", "GitCommit",
    }
    for raw in attributes["identifiers"]:
        if not isinstance(raw, dict):
            raise ValueError("DataCite identifier must be an object")
        _strict_keys(raw, {"identifier", "identifierType"}, "DataCite identifier")
        identifier_type = _required_text(raw.get("identifierType"), "identifierType")
        identifier = _required_text(raw.get("identifier"), "identifier")
        if identifier_type not in allowed_types:
            raise ValueError("unsupported DataCite identifierType")
        if identifier_type in result:
            raise ValueError(f"duplicate DataCite identifierType: {identifier_type}")
        result[identifier_type] = identifier
    return result


def _validate_related_identifiers(attributes: Mapping[str, Any]) -> None:
    canonical: set[str] = set()
    for raw in attributes["relatedIdentifiers"]:
        if not isinstance(raw, dict):
            raise ValueError("DataCite relatedIdentifier must be an object")
        _strict_keys(raw, {
            "relatedIdentifier", "relatedIdentifierType", "relationType", "resourceTypeGeneral",
        }, "DataCite relatedIdentifier")
        normalized = RelatedIdentifier(
            identifier=raw.get("relatedIdentifier"),
            identifier_type=raw.get("relatedIdentifierType"),
            relation_type=raw.get("relationType"),
            resource_type_general=raw.get("resourceTypeGeneral"),
        ).to_dict()
        if normalized != raw:
            raise ValueError("relatedIdentifier is not canonical")
        key = _canonical_json(raw)
        if key in canonical:
            raise ValueError("duplicate related identifier")
        canonical.add(key)


def import_datacite(
    document: Mapping[str, Any],
    *,
    expected_metadata_digest: str,
    resource: DataCiteResource,
    project: DataCiteProject,
    artifact: Optional[Artifact] = None,
    artifact_version: Optional[ArtifactVersion] = None,
) -> ImportedDataCite:
    """Import a canonical export and reject digest, identity, or schema tampering."""
    if not isinstance(document, dict):
        raise ValueError("DataCite document must be an object")
    expected_digest = normalize_sha256(expected_metadata_digest)
    actual_digest = datacite_digest(document)
    if expected_digest != actual_digest:
        raise ValueError("DataCite metadata digest mismatch")
    resource.validate()
    _validate_artifact_pair(artifact, artifact_version)
    doi, attributes = _validate_document_shape(document)
    identifiers = _identifier_map(attributes)
    _validate_related_identifiers(attributes)

    general_type = _resource_type(artifact)
    expected_types = {
        "resourceTypeGeneral": general_type,
        **({"resourceType": resource.resource_type} if resource.resource_type else {}),
    }
    if attributes.get("types") != expected_types:
        raise ValueError("DataCite resource type does not match authoritative resource")
    if attributes.get("titles") != [{"title": resource.title.strip()}]:
        raise ValueError("DataCite title does not match authoritative resource")
    if attributes.get("creators") != [item.to_dict() for item in resource.creators]:
        raise ValueError("DataCite creators do not match authoritative resource")
    if attributes.get("publisher") != resource.publisher.strip():
        raise ValueError("DataCite publisher does not match authoritative resource")
    if attributes.get("publicationYear") != resource.publication_year:
        raise ValueError("DataCite publicationYear does not match authoritative resource")

    expected_project_id = project_identity(project.project_id)
    if artifact is None or artifact_version is None:
        primary_entity_id = expected_project_id
        if identifiers.get("SciForgeProject") != primary_entity_id:
            raise ValueError("DataCite Project identity mismatch")
        if "SciForgeROCrateArtifactVersion" in identifiers or "SHA-256" in identifiers:
            raise ValueError("Project metadata must not claim an ArtifactVersion identity")
    else:
        primary_entity_id = ro_crate_identity("artifact-version", artifact_version.version_id)
        if identifiers.get("SciForgeROCrateArtifactVersion") != primary_entity_id:
            raise ValueError("DataCite ArtifactVersion identity mismatch")
        expected_sha = normalize_sha256(artifact_version.content_digest)
        if expected_sha is None:
            if "SHA-256" in identifiers:
                raise ValueError("DataCite invented an ArtifactVersion content digest")
        elif identifiers.get("SHA-256") != expected_sha:
            raise ValueError("DataCite ArtifactVersion content digest mismatch")
        expected_relations = {
            _canonical_json(RelatedIdentifier(
                ro_crate_identity("artifact", artifact.artifact_id), "URN", "IsVersionOf",
                general_type,
            ).to_dict()),
            _canonical_json(RelatedIdentifier(
                expected_project_id, "URN", "IsPartOf", "Project",
            ).to_dict()),
        }
        actual_relations = {_canonical_json(item) for item in attributes["relatedIdentifiers"]}
        if not expected_relations.issubset(actual_relations):
            raise ValueError("DataCite Artifact or Project relation is missing")
        if artifact_version.supersedes is not None:
            revision = _canonical_json(RelatedIdentifier(
                ro_crate_identity("artifact-version", artifact_version.supersedes),
                "URN", "IsNewVersionOf", general_type,
            ).to_dict())
            if revision not in actual_relations:
                raise ValueError("DataCite ArtifactVersion revision relation is missing")

    locator_doi = _doi_from_locator(artifact_version.locator) if artifact_version else None
    expected_doi = _canonical_doi(resource.doi) if resource.doi is not None else locator_doi
    if expected_doi != doi:
        raise ValueError("DataCite DOI does not match authoritative resource")
    swhid = identifiers.get("SWHID")
    if swhid is not None and _canonical_swhid(swhid) != swhid:
        raise ValueError("DataCite SWHID is not canonical")
    raw_git = identifiers.get("GitCommit")
    git_commit = None
    if raw_git is not None:
        repository, separator, commit = raw_git.rpartition("@")
        if not separator:
            raise ValueError("invalid DataCite GitCommit identifier")
        git_commit = GitCommit(repository, commit)
        git_commit.normalized()
    return ImportedDataCite(
        document=json.loads(_canonical_json(document)),
        metadata_digest=actual_digest,
        doi=doi,
        primary_entity_id=primary_entity_id,
        artifact_id=artifact.artifact_id if artifact is not None else None,
        artifact_version_id=artifact_version.version_id if artifact_version is not None else None,
        project_id=project.project_id,
        swhid=swhid,
        git_commit=git_commit,
    )


def loads_datacite(
    text: str,
    *,
    expected_metadata_digest: str,
    resource: DataCiteResource,
    project: DataCiteProject,
    artifact: Optional[Artifact] = None,
    artifact_version: Optional[ArtifactVersion] = None,
) -> ImportedDataCite:
    try:
        document = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("invalid DataCite JSON") from exc
    return import_datacite(
        document,
        expected_metadata_digest=expected_metadata_digest,
        resource=resource,
        project=project,
        artifact=artifact,
        artifact_version=artifact_version,
    )
