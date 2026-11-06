"""Run legacy migration tests from a source copy with no .git dependency."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

source = Path(__file__).resolve().parents[1] / 'packages/domains/evidence-dag'
with tempfile.TemporaryDirectory(prefix='legacy-no-git-') as directory:
    root = Path(directory)
    shutil.copytree(source / 'python', root / 'python', ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    (root / 'tests').mkdir()
    shutil.copy2(source / 'tests/test_legacy_snapshot_aliases.py', root / 'tests/test_legacy_snapshot_aliases.py')
    shutil.copytree(source / 'tests/fixtures', root / 'tests/fixtures', ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    assert not (root / '.git').exists()
    print(f'Isolated no-Git source: {root}; Python: {sys.version}', flush=True)
    result = subprocess.run([sys.executable, '-I', '-c',
        "import sys, unittest; sys.path.insert(0, 'python'); suite=unittest.defaultTestLoader.discover('tests', pattern='test_legacy_snapshot_aliases.py'); result=unittest.TextTestRunner(verbosity=2).run(suite); sys.exit(not result.wasSuccessful())"], cwd=root)
    sys.exit(result.returncode)
