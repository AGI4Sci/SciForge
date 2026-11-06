# Python snapshot execution

`index.ts` exports `runPythonSnapshot(request): Promise<PythonSnapshotResult>`, the Python-only `pythonSnapshotAdapter`, and request/result/JSON types. Production integration uses the same canonical lifecycle via `preparePythonSnapshot(request)`, the host's managed DSH subprocess API, then `collectPythonSnapshot(prepared, outcome)`. `cleanupPythonSnapshot(prepared)` supports explicit cleanup. This module uses Node builtins and must run **inside the DSH-confined outer worker**. It does not authorize workspace access or establish an operating-system sandbox. The caller supplies an already authorized workspace and configured executable. No shell or automatic package installation is used.

Preparation returns a JSON-safe ephemeral envelope: `{stageRoot, stagingRoot, identity:{dev,ino}, cwd, argv, env, timeoutMs}`. `argv` contains the executable, isolated/unbuffered flags, `-c`, the exported `PYTHON_SNAPSHOT_WRAPPER`, and staged metadata/entrypoint paths. The host must run this exact argv in its narrower stage sandbox and pass bounded logs, exitCode and optional status/error into collection. Absolute stage paths belong only in this ephemeral envelope; a caller persisting a pending receipt must normalize paths to workspace-relative and validate/reconstruct them before collection. Collection always attempts identity-checked cleanup, including cancelled/failed outcomes; use a non-aborted finalization signal. Metadata is diagnostic user-process output, not trusted proof of the execution environment.

Requests carry copied source `files`, a snapshot-relative `.py` `entrypoint`, JSON `parameters`, copied `inputFiles`, an optional `timeoutMs`, and an optional `signal` for cancellation. Input file paths are relative to `inputs/`, not the original workspace. Snapshot paths are relative to the isolated snapshot directory. Paths must be normalized relative POSIX paths without traversal, backslashes, control characters, or drive prefixes.

Each run creates an exact `mkdtemp` directory below the canonical workspace's `.scientific-figures/.runs-temp/`, with separate `snapshot/`, `inputs/`, and `outputs/`. Source and input files are created exclusively without following symlinks. Cleanup checks the generated directory's device/inode and canonical path before removing only that directory; ancestor staging directories remain.

The wrapper requires matplotlib, records Python/matplotlib versions, then runs the entrypoint with `runpy.run_path(..., run_name='__main__')`. It passes `SCIENTIFIC_FIGURES_OUTPUT_DIR`, `SCIENTIFIC_FIGURES_INPUT_DIR`, and `SCIENTIFIC_FIGURES_PARAMETERS_JSON`; `MPLBACKEND=Agg` is forced. Scripts must explicitly save PNGs into the output directory, for example:

```python
import os
from pathlib import Path
import matplotlib.pyplot as plt
plt.plot([1, 2], [3, 4])
plt.savefig(Path(os.environ['SCIENTIFIC_FIGURES_OUTPUT_DIR']) / 'plot.png')
```

There is no `savefig` interception or automatic figure capture. A successful script may return zero outputs. Only regular PNG files under `outputs/` are collected (including nested directories); symlinks and hard links fail collection. PNG signatures are checked, but this is not a full PNG decoder. Output paths are relative to `outputs/` and bytes are `Uint8Array`. Failures/cancellation return no outputs, structured `error: {code,message}`, bounded diagnostic logs, and a nullable exit code. Persist `error.message` if the store accepts only string errors. Environment metadata deliberately omits executable/absolute staging paths.

Limits are exported as `EXECUTION_LIMITS`: stdout/stderr each 128 KiB with truncation flags while streams continue draining; combined snapshot/input bytes 64 MiB and 256 files; JSON parameters 128 KiB; at most 16 output PNGs, 20 MiB per file, 64 MiB total, 256 directory entries, and depth 16. Default timeout is 60 seconds, maximum 10 minutes. Timeouts are `failed` with code `timeout`; AbortSignal cancellation is `cancelled`. On POSIX subprocess groups are killed on timeout, cancellation, and leader exit so descendants cannot retain output pipes. Windows termination covers the direct process only; outer confinement must enforce process-tree lifecycle there.

Validation uses `tests/mvp-execution.test.ts`. Its executable fixture intentionally simulates Python and matplotlib to exercise the actual Node subprocess/staging/collection path; it is not evidence of real matplotlib rendering. A separate managed-Python check verified Python 3.12.14 reports `missing-matplotlib`, logs its traceback, returns exit code 78, and cleans staging. No dependency was installed.
