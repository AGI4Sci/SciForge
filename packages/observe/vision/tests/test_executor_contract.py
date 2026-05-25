import importlib
import sys
import unittest
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))


class ExecutorContractDeletionTest(unittest.TestCase):
    def test_executor_module_is_not_owned_by_vision_sense(self):
        with self.assertRaises(ModuleNotFoundError):
            importlib.import_module("sciforge_vision_sense.executor")


if __name__ == "__main__":
    unittest.main()
