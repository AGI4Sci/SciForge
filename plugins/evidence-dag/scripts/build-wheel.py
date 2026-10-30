"""Build the repository-owned Evidence project using its declared PEP 517 backend.

Stage exact canonical sources under the isolated TMPDIR so setuptools metadata
and build outputs never write into the source tree. No synthesized wheel fallback.
"""
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

source, output = (pathlib.Path(value).resolve() for value in sys.argv[1:3])
project = source.parent
if not (project / "pyproject.toml").is_file() or source.name != "python":
    raise RuntimeError("Expected the canonical Evidence project's python source directory")
output.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix="evidence-pep517-", dir=os.environ.get("TMPDIR")) as scratch:
    staged = pathlib.Path(scratch)
    shutil.copyfile(project / "pyproject.toml", staged / "pyproject.toml")
    shutil.copytree(source, staged / "python", ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.egg-info"))
    env = {**os.environ, "SOURCE_DATE_EPOCH": "1577836800", "PYTHONHASHSEED": "0"}
    subprocess.run([sys.executable, "-B", "-m", "build", "--wheel", "--no-isolation", "--outdir", str(output), str(staged)], check=True, env=env)
