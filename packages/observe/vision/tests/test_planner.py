import importlib
import sys
import unittest
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))


class PlannerDeletionTest(unittest.TestCase):
    def test_positive_planner_module_is_not_owned_by_vision_sense(self):
        with self.assertRaises(ModuleNotFoundError):
            importlib.import_module("sciforge_vision_sense.planner")


if __name__ == "__main__":
    unittest.main()
