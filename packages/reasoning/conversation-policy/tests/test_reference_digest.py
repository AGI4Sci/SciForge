from __future__ import annotations

import pathlib
import sys
import tempfile
import unittest


PACKAGE_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT / "src"))

from sciforge_conversation.reference_digest import (  # noqa: E402
    ReferenceDigestOptions,
    build_reference_digests,
)


FIXTURES = PACKAGE_ROOT / "tests" / "fixtures"


class ReferenceDigestTest(unittest.TestCase):
    def test_digest_markdown_json_csv_and_prompt_paths_are_bounded(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            for fixture in FIXTURES.iterdir():
                if not fixture.is_file():
                    continue
                (root / fixture.name).write_bytes(fixture.read_bytes())

            digests = build_reference_digests(
                [{"ref": "file:sample.md"}, {"path": "records.csv"}, {"ref": "sample.json"}],
                prompt="Also inspect path-ref.md and sample.pdf",
                workspace_root=str(root),
                options=ReferenceDigestOptions(workspace_root=str(root), digest_char_budget=480, excerpt_char_budget=120),
            )

        by_type = {digest.sourceType: digest for digest in digests}
        self.assertEqual(by_type["markdown"].status, "ok")
        self.assertIn("Markdown digest", by_type["markdown"].digestText)
        self.assertEqual(by_type["json"].metrics["parseOk"], True)
        self.assertIn("Headers:", by_type["csv"].digestText)
        self.assertEqual(by_type["pdf"].status, "unsupported")
        self.assertTrue(any(digest.path == "path-ref.md" for digest in digests))
        self.assertTrue(all(digest.refSafe for digest in digests))
        self.assertTrue(all(len(digest.digestText) <= 520 for digest in digests))
        joined = "\n".join(digest.digestText for digest in digests)
        self.assertNotIn("very long raw paragraph", joined.lower())

    def test_rejects_refs_outside_workspace_without_reading(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            outside = root.parent / "outside-secret.md"
            outside.write_text("secret raw body should not leak", encoding="utf-8")
            digest = build_reference_digests([str(outside)], workspace_root=str(root))[0]

        self.assertEqual(digest.status, "unresolved")
        self.assertEqual(digest.refSafe, True)
        self.assertNotIn("secret raw body", digest.digestText)

    def test_prompt_filename_resolves_unique_workspace_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            nested = root / "notes"
            nested.mkdir()
            (nested / "unique-ref.md").write_text("# Unique\nbridge preserved prompt lookup", encoding="utf-8")

            digest = build_reference_digests([], prompt="Please inspect unique-ref.md", workspace_root=str(root))[0]

        self.assertEqual(digest.status, "ok")
        self.assertEqual(digest.path, "notes/unique-ref.md")


if __name__ == "__main__":
    unittest.main()
