from __future__ import annotations

import pathlib
import sys
import tempfile
import unittest


PACKAGE_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT / "src"))

from sciforge_conversation.artifact_index import build_artifact_index  # noqa: E402
from sciforge_conversation.reference_digest import build_reference_digests  # noqa: E402


class ArtifactIndexTest(unittest.TestCase):
    def test_artifact_index_is_clickable_ref_safe_and_deduped(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            report = root / "report.md"
            report.write_text("# Result\nshort report", encoding="utf-8")
            digests = build_reference_digests(["report.md"], workspace_root=str(root))
            index = build_artifact_index(
                workspace_root=str(root),
                artifacts=[
                    {
                        "id": "artifact-1",
                        "title": "Report",
                        "type": "markdown-report",
                        "dataRef": "file:report.md",
                        "markdown": "# Result\n" + ("raw " * 1000),
                    }
                ],
                execution_units=[
                    {
                        "id": "EU-1",
                        "status": "done",
                        "outputRef": "file:report.md",
                        "stdoutRef": "missing/stdout.log",
                        "summary": "Finished without embedding body.",
                    }
                ],
                reference_digests=digests,
            )

        payload = index.to_dict()
        self.assertEqual(payload["policy"], "refs-and-bounded-summaries-only")
        self.assertEqual(len([entry for entry in payload["entries"] if entry["clickableRef"] == "file:report.md"]), 1)
        self.assertTrue(payload["entries"][0]["sha256"])
        self.assertIn("inlineFieldsExcluded", payload["entries"][0]["audit"])
        self.assertNotIn("raw raw raw", str(payload))
        self.assertGreaterEqual(payload["omitted"]["unresolvedRefs"], 1)


if __name__ == "__main__":
    unittest.main()
