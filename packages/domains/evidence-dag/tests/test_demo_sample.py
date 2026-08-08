from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]


class ReproducibleDagV3DemoTests(unittest.TestCase):
    def test_offline_demo_exports_a_verified_matched_replication(self) -> None:
        with tempfile.TemporaryDirectory(prefix="sciforge-dag-v3-demo-test-") as root:
            output = Path(root) / "export"
            completed = subprocess.run(
                [
                    sys.executable,
                    str(PACKAGE_ROOT / "samples" / "reproducible_dag_v3_demo.py"),
                    "--output",
                    str(output),
                ],
                cwd=PACKAGE_ROOT,
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertIn("验证通过", completed.stdout)
            comparison = json.loads((output / "comparison.json").read_text("utf-8"))
            self.assertTrue(comparison["sameInput"])
            self.assertTrue(comparison["sameSpec"])
            self.assertTrue(comparison["sameExecutionContext"])
            self.assertTrue(comparison["resultMatch"])
            self.assertEqual(comparison["replicationStatus"], "matched")
            self.assertEqual(comparison["replicationRelation"], "replicates")
            for name in (
                "lineage.json",
                "baseline.sciforge-rerun.json",
                "candidate.sciforge-rerun.json",
                "report.md",
                "dag-v3-demo.svg",
                "index.html",
            ):
                self.assertTrue((output / name).is_file(), name)


if __name__ == "__main__":
    unittest.main()
