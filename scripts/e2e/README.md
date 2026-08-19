# Product stack E2E supervisor

`product-stack-supervisor.mjs` owns every long-running root used by one E2E run.
It creates a run directory and redacted manifest, rejects live previous owners or
occupied ports, launches configured roots, runs one bounded driver, and always
tears the roots down in reverse order.

The configuration is generic. It must not contain credentials or service
tokens; child processes inherit the supervisor environment. A minimal shape is:

```json
{
  "stateRoot": "../../.e2e-runtime",
  "roots": [
    {
      "role": "fixture",
      "command": "node",
      "args": ["fixture.mjs"],
      "readyPort": 9235
    },
    {
      "role": "product",
      "command": "npm",
      "args": ["run", "dev"],
      "readyPort": 5173
    }
  ],
  "task": {
    "role": "driver",
    "command": "node",
    "args": ["driver.mjs"],
    "timeoutMs": 600000
  },
  "ports": [3892, 3893, 3900, 5173, 5174, 9235],
  "profileDirectories": ["profiles/browser"]
}
```

Run it with:

```text
node scripts/e2e/product-stack-supervisor.mjs --config path/to/run.json
```

The manifest stores role, PID, process creation identity, executable basename,
command fingerprint, ports, profiles, phase, exit state, and teardown
verification. It never stores inherited environment values or raw command
lines. Force termination is allowed only after PID, creation time, executable,
and command-line hash still match the recorded owner. A PID identity mismatch
fails closed.
