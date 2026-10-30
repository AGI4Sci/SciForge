# Product stack E2E supervisor

`product-stack-supervisor.mjs` owns every long-running root used by one E2E run.
It creates a run directory and redacted manifest, rejects live previous owners or
occupied ports, launches configured roots, runs one bounded driver, and always
tears the roots down in reverse order. A self-launching driver such as the source
Electron smoke may use an empty `roots` array; the driver then runs in its own
owned POSIX process group and its product descendants remain supervised.

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

The canonical source Electron smoke is already wired through the checked-in
`electron-domain-source.json` configuration:

```text
npm run smoke:electron:source
```

The Run-0 Cloud pre-login smoke uses the same source application path while
freezing the accepted Cloud origin and OIDC issuer:

```text
npm run smoke:electron:source:cloud
```

This online smoke proves production composition, deployment selection, public
reachability, and the signed-out identity boundary. It does not replace a Human
OIDC login or the five-profile live collaboration run.

The manifest stores role, PID, process creation identity, executable basename,
command fingerprint, ports, profiles, phase, exit state, and teardown
verification. It never stores inherited environment values or raw command
lines. Force termination is allowed only after PID, creation time, executable,
and command-line hash still match the recorded owner. POSIX process-group
members and Windows descendants are captured before termination, including when
the launcher has already exited. A PID identity mismatch fails closed.
