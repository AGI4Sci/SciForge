"""Build approved local Python sources without network or build isolation.

Supply the Evidence source/wheel from its owner for coordinated delivery. Source
mode builds a separate formal dependency wheel; it does not vendor Evidence into
Project or copy the shared fact store. All backend writes occur in --scratch.
"""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--scratch', required=True)
parser.add_argument('--evidence-source', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[3]
scratch = Path(args.scratch).resolve()
scratch.mkdir(parents=True, exist_ok=True)
wheels = scratch / 'wheels'
wheels.mkdir(exist_ok=True)
for name, source in [('evidence', Path(args.evidence_source)),
                     ('project', root / 'packages/domains/project-dag')]:
    work = scratch / ('build-' + name)
    if work.exists():
        raise SystemExit('Refusing to overwrite previous build: '+str(work))
    work.mkdir()
    shutil.copy2(source / 'pyproject.toml', work / 'pyproject.toml')
    shutil.copytree(source / 'python', work / 'python',
                    ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '*.egg-info'))
    subprocess.run([sys.executable, '-c',
                    'from setuptools.build_meta import build_wheel; '
                    'import sys; print(build_wheel(sys.argv[1]))', str(wheels)],
                   cwd=work, check=True)
print(wheels)
