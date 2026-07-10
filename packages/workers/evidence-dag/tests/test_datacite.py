from __future__ import annotations

import copy
import unittest

from evidence_dag.datacite import (
    DATACITE_SCHEMA_VERSION,
    DataCiteCreator,
    DataCiteDescription,
    DataCiteProject,
    DataCiteResource,
    GitCommit,
    RelatedIdentifier,
    datacite_digest,
    dumps_datacite,
    export_datacite,
    import_datacite,
    loads_datacite,
    project_identity,
    ro_crate_identity,
)
from evidence_dag.model import Artifact, ArtifactVersion


SHA_A = "sha256:" + "a" * 64
SHA_B = "sha256:" + "b" * 64
COMMIT = "1a2b3c4d" * 5
SWHID = "swh:1:rev:" + "c" * 40


def resource(doi: str | None = "10.12345/result.v2") -> DataCiteResource:
    return DataCiteResource(
        title="Verified result dataset",
        creators=(DataCiteCreator(
            "Researcher, Ada", name_type="Personal", given_name="Ada",
            family_name="Researcher", orcid="0000-0002-1825-0097",
        ),),
        publisher="Example Research Institute",
        publication_year=2026,
        doi=doi,
        resource_type="Tabular research result",
        language="en",
        descriptions=(DataCiteDescription("Exact exported result.", "Abstract"),),
    )


def records(locator: str = "doi:10.12345/result.v2") -> tuple[Artifact, ArtifactVersion]:
    artifact = Artifact(
        artifact_id="artifact:dataset:stable", kind="dataset",
        created_at="2026-07-10T00:00:00Z",
        current_version_id="artifact-version:v2",
    )
    version = ArtifactVersion(
        version_id="artifact-version:v2", artifact_id=artifact.artifact_id,
        locator=locator, content_digest=SHA_B, version="2", size=42,
        media_type="text/csv", observed_at="2026-07-10T01:00:00Z",
        availability="remote", retention="reference",
        supersedes="artifact-version:v1",
    )
    return artifact, version


class TestDataCiteExchange(unittest.TestCase):
    def setUp(self) -> None:
        self.project = DataCiteProject("project:general-research")
        self.artifact, self.version = records()

    def export(self, **kwargs):
        return export_datacite(
            resource(), self.project, artifact=self.artifact,
            artifact_version=self.version, **kwargs,
        )

    def test_artifact_version_export_is_reference_first_and_identity_aligned(self):
        document = self.export(
            swhid=SWHID,
            git_commit=GitCommit("https://example.test/research.git", COMMIT),
            related_identifiers=(RelatedIdentifier(
                "10.9999/input.dataset", "DOI", "IsDerivedFrom", "Dataset",
            ),),
        )
        attributes = document["data"]["attributes"]
        self.assertEqual(document["data"]["id"], "10.12345/result.v2")
        self.assertEqual(attributes["schemaVersion"], DATACITE_SCHEMA_VERSION)
        self.assertEqual(attributes["types"]["resourceTypeGeneral"], "Dataset")
        identifiers = {item["identifierType"]: item["identifier"] for item in attributes["identifiers"]}
        self.assertEqual(
            identifiers["SciForgeROCrateArtifactVersion"],
            ro_crate_identity("artifact-version", self.version.version_id),
        )
        self.assertEqual(identifiers["SHA-256"], SHA_B)
        self.assertEqual(identifiers["SWHID"], SWHID)
        self.assertEqual(
            identifiers["GitCommit"],
            f"https://example.test/research.git@{COMMIT}",
        )
        relations = {
            (item["relatedIdentifier"], item["relationType"])
            for item in attributes["relatedIdentifiers"]
        }
        self.assertIn((
            ro_crate_identity("artifact", self.artifact.artifact_id), "IsVersionOf",
        ), relations)
        self.assertIn((project_identity(self.project.project_id), "IsPartOf"), relations)
        self.assertIn((
            ro_crate_identity("artifact-version", "artifact-version:v1"),
            "IsNewVersionOf",
        ), relations)
        self.assertNotIn("content", dumps_datacite(document).lower())

    def test_project_resource_uses_project_identity_without_invented_artifact(self):
        project_resource = DataCiteResource(
            title="Research project", creators=(DataCiteCreator("Lab A"),),
            publisher="Lab A", publication_year=2026, doi="10.12345/project",
        )
        document = export_datacite(project_resource, self.project)
        attributes = document["data"]["attributes"]
        self.assertEqual(attributes["types"], {"resourceTypeGeneral": "Project"})
        self.assertEqual(attributes["identifiers"], [{
            "identifier": project_identity(self.project.project_id),
            "identifierType": "SciForgeProject",
        }])
        self.assertEqual(attributes["relatedIdentifiers"], [])
        imported = import_datacite(
            document, expected_metadata_digest=datacite_digest(document),
            resource=project_resource, project=self.project,
        )
        self.assertIsNone(imported.artifact_id)
        self.assertEqual(imported.primary_entity_id, project_identity(self.project.project_id))

    def test_swhid_locator_is_used_only_as_explicit_identifier(self):
        artifact, version = records(SWHID)
        document = export_datacite(
            resource(), self.project, artifact=artifact, artifact_version=version,
        )
        identifiers = {
            item["identifierType"]: item["identifier"]
            for item in document["data"]["attributes"]["identifiers"]
        }
        self.assertEqual(identifiers["SWHID"], SWHID)
        self.assertNotIn("url", document["data"]["attributes"])

    def test_import_requires_detached_digest_and_authoritative_identities(self):
        document = self.export(swhid=SWHID)
        digest = datacite_digest(document)
        imported = loads_datacite(
            dumps_datacite(document), expected_metadata_digest=digest,
            resource=resource(), project=self.project, artifact=self.artifact,
            artifact_version=self.version,
        )
        self.assertEqual(imported.metadata_digest, digest)
        self.assertEqual(imported.primary_entity_id,
                         ro_crate_identity("artifact-version", self.version.version_id))

        tampered = copy.deepcopy(document)
        tampered["data"]["attributes"]["titles"][0]["title"] = "Tampered"
        with self.assertRaisesRegex(ValueError, "digest mismatch"):
            import_datacite(
                tampered, expected_metadata_digest=digest, resource=resource(),
                project=self.project, artifact=self.artifact, artifact_version=self.version,
            )

        tampered = copy.deepcopy(document)
        version_id = next(
            item for item in tampered["data"]["attributes"]["identifiers"]
            if item["identifierType"] == "SciForgeROCrateArtifactVersion"
        )
        version_id["identifier"] = ro_crate_identity("artifact-version", "attacker-version")
        with self.assertRaisesRegex(ValueError, "identity mismatch"):
            import_datacite(
                tampered, expected_metadata_digest=datacite_digest(tampered),
                resource=resource(), project=self.project, artifact=self.artifact,
                artifact_version=self.version,
            )

    def test_missing_or_conflicting_metadata_is_rejected_not_guessed(self):
        with self.assertRaisesRegex(ValueError, "DOI is required"):
            export_datacite(
                resource(None), self.project, artifact=self.artifact,
                artifact_version=ArtifactVersion(
                    **{**self.version.__dict__, "locator": "data/results.csv"}
                ),
            )
        with self.assertRaisesRegex(ValueError, "does not match"):
            export_datacite(
                resource("10.12345/different"), self.project, artifact=self.artifact,
                artifact_version=self.version,
            )
        with self.assertRaisesRegex(ValueError, "at least one creator"):
            export_datacite(
                DataCiteResource(
                    title="Result", creators=(), publisher="Lab",
                    publication_year=2026, doi="10.12345/result.v2",
                ),
                self.project, artifact=self.artifact, artifact_version=self.version,
            )
        with self.assertRaisesRegex(ValueError, "belong"):
            export_datacite(
                resource(), self.project, artifact=self.artifact,
                artifact_version=ArtifactVersion(
                    **{**self.version.__dict__, "artifact_id": "different"}
                ),
            )

    def test_invalid_external_identifiers_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "core SWHID"):
            self.export(swhid="swh:1:rev:abcd")
        with self.assertRaisesRegex(ValueError, "full 40 or 64"):
            self.export(git_commit=GitCommit("https://example.test/repo", "abc1234"))
        with self.assertRaisesRegex(ValueError, "relatedIdentifierType"):
            self.export(related_identifiers=(RelatedIdentifier(
                SWHID, "SWHID", "IsVersionOf",
            ),))
        with self.assertRaisesRegex(ValueError, "invalid related URL"):
            self.export(related_identifiers=(RelatedIdentifier(
                "file:///private/data", "URL", "IsDerivedFrom",
            ),))

    def test_noncanonical_related_identifier_and_unknown_field_are_rejected(self):
        document = self.export()
        document["data"]["attributes"]["relatedIdentifiers"].append({
            "relatedIdentifier": "DOI:10.9999/UPPER",
            "relatedIdentifierType": "DOI",
            "relationType": "References",
        })
        with self.assertRaisesRegex(ValueError, "not canonical"):
            import_datacite(
                document, expected_metadata_digest=datacite_digest(document),
                resource=resource(), project=self.project, artifact=self.artifact,
                artifact_version=self.version,
            )
        document = self.export()
        document["data"]["attributes"]["unexpected"] = True
        with self.assertRaisesRegex(ValueError, "unsupported DataCite attributes"):
            import_datacite(
                document, expected_metadata_digest=datacite_digest(document),
                resource=resource(), project=self.project, artifact=self.artifact,
                artifact_version=self.version,
            )


if __name__ == "__main__":
    unittest.main()
