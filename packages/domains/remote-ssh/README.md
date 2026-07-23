# `@sciforge/domain-remote-ssh`

Trusted compile-time Remote SSH domain package for SciForge. It owns the Remote SSH contract,
main-process capabilities and service, the Remote Targets workbench panel, and renderer
translations. Every privileged operation goes through the Capability Broker contribution declared
in `sciforge.domain.json`; the package does not add a second IPC, MCP, or runtime-specific path.

The package intentionally has no process-ambiguous root export:

- `./definition` validates and exports the JSON-backed installed package definition.
- `./contract` exports process-neutral schemas, types, capability IDs, and resource kinds.
- `./main` owns persistence, diagnostics, system OpenSSH execution, transfer, and capabilities.
- `./renderer` owns the Remote Targets panel and its capability client.

## Network architecture

Remote SSH owns one isolated VPN environment per laboratory. The default provider is a
user-managed VirtualBox VM:

```text
Remote SSH main service (behind the Capability Broker)
        |
        +-- system OpenSSH --> SciForge SSH proxy helper
        |                         |
        |                         `-- 127.0.0.1:<Lab A SOCKS5>
        |                                   |
        |                                   `-- SSH gateway --> Lab A VM --> aTrust A --> GPU 01
        |
        `-- system OpenSSH --> SciForge SSH proxy helper
                                  |
                                  `-- 127.0.0.1:<Lab B SOCKS5>
                                            |
                                            `-- SSH gateway --> Lab B VM --> aTrust B --> Login node
```

The deployment rule is:

```text
one mutually exclusive VPN realm = one VirtualBox VM
one VM gateway                   = one ordinary OpenSSH alias with a running OpenSSH server
one remote machine               = one ordinary final-target OpenSSH alias
```

Each VM has its own operating system, routes, DNS, VPN client, and login state. Several machines in
one laboratory share that VM; mutually exclusive VPNs use different VMs and can run concurrently.
SciForge starts and stops the registered VM through `VBoxManage`, opens its VirtualBox console for
interactive aTrust login, and establishes a loopback-only dynamic SSH tunnel through the configured
VM gateway alias. The VM must already contain a working OpenSSH server. VPN credentials and MFA
stay inside the VM, and the host does not inherit the laboratory's routes or DNS.

The package's privileged service and UI-only target catalog work with literal OpenSSH `Host`
aliases. OpenSSH configuration remains the canonical source for target hostnames, users, ports,
keys, and host-key policy. For every probe, command, upload, and download, the service injects a
package-owned `ProxyCommand` that invokes SciForge's bundled cross-platform SSH proxy helper. The
helper connects the requested SSH destination through the selected laboratory's loopback SOCKS5
endpoint. For the VM provider that endpoint belongs to the SSH tunnel through the VM gateway. It
does not depend on `nc` or shell fragments. A user-defined final-target `ProxyCommand` or
`ProxyJump` is therefore not needed.

The same host-side path is used on macOS, Windows, and Linux where VirtualBox is installed and
supported. SciForge resolves the platform's `VBoxManage` and system OpenSSH executables; the user
does not need to compose a platform-specific proxy command.

Docker is an advanced provider for laboratories whose aTrust deployment is known to work in a
container. Its default image is `hagb/docker-atrust:latest`; the lab editor allows a different
compatible image. Docker keeps its login UI and SOCKS5 endpoint on loopback and uses the same
provider-neutral lifecycle and SSH proxy capabilities as the VM path. It is not a fallback that
SciForge silently selects when VirtualBox is unavailable.

The Remote SSH capability surface does not return those aliases or offer a raw `ssh <alias>`
operation. Workspace discovery exposes a sanitized target summary and an opaque Broker resource
handle; the main-process service resolves that handle to the private alias only after workspace
authorization and capability governance. This is an encapsulation boundary, not an operating-system
sandbox: an Agent runtime separately granted general shell or host-file access may still read the
user's OpenSSH configuration or invoke system `ssh`, subject to that runtime's sandbox and approval
policy.

## OpenSSH configuration example

The default VM path needs one gateway alias for the VM and one ordinary alias per final target.
The VM gateway can use a host-only address or a loopback NAT-forwarded SSH port. Final-server keys
remain on the host. Save these aliases in `~/.ssh/config` on macOS/Linux or
`%USERPROFILE%\.ssh\config` on Windows.

```sshconfig
Host lab-a-vm
    HostName 192.168.56.101
    User sciforge
    IdentityFile ~/.ssh/sciforge/lab-a-vm
    IdentitiesOnly yes
    ForwardAgent no
    StrictHostKeyChecking yes

Host lab-a-gpu01
    HostName 10.0.0.5
    User researcher
    IdentityFile ~/.ssh/sciforge/lab-a-target
    IdentitiesOnly yes
    ForwardAgent no
    StrictHostKeyChecking yes
    HostKeyAlias lab-a-gpu01

Host lab-b-vm
    HostName 192.168.56.102
    User sciforge
    IdentityFile ~/.ssh/sciforge/lab-b-vm
    IdentitiesOnly yes
    ForwardAgent no
    StrictHostKeyChecking yes

Host lab-b-gpu01
    HostName 10.0.0.5
    User researcher
    IdentityFile ~/.ssh/sciforge/lab-b-target
    IdentitiesOnly yes
    ForwardAgent no
    StrictHostKeyChecking yes
    HostKeyAlias lab-b-gpu01
```

The lab records select `lab-a-vm` and `lab-b-vm` as their VM gateway aliases. Both final targets
deliberately use `10.0.0.5`; their separate VM VPN realms disambiguate the route, while distinct
`HostKeyAlias` values give the final servers independent `known_hosts` identities. Do not disable
host-key checking to work around an overlapping address.

## Registration and workspace authorization

The package stores only SciForge-owned metadata around aliases that already work with system
OpenSSH:

- A **lab** groups targets, selects its isolated environment provider and configuration, and sets a
  lab concurrency limit. VM setup accepts a registered VirtualBox VM UUID or exact name; SciForge
  resolves that locator and records only the canonical VM UUID plus the gateway SSH alias. Docker
  labs record a container image.
- A **target** records its lab, display name, literal SSH alias, labels, supported `shell` and/or
  `file-transfer` operations, and target concurrency limit.
- A **workspace binding** is an allowlist of target IDs available to that workspace. A separate
  UI-only catalog exposes complete target configuration so a user can manage the allowlist.
  Workspace `targets.list` returns only bound target summaries and workspace-scoped opaque resource
  handles to UI, agent, and system callers.

Target summaries contain IDs, display metadata, labels, declared capabilities, and concurrency
limits. They do not contain SSH aliases or configuration revisions. Current state
is obtained through the Capability Broker's canonical resource observation operation; there is no
parallel domain-specific target-observation capability. Probe and eligible UI/agent command,
upload, and download capabilities consume the opaque target resource rather than a caller-supplied
alias.

The records never contain SSH private keys, VPN credentials, VPN profiles, raw SSH options, shell
fragments, or `user@host` destinations. Alias validation accepts one literal `Host` name without
wildcards or command-line options. Credentials and host-key trust stay in the user's OpenSSH and OS
credential configuration.

## Guided setup in the panel

When no target is configured, the package-owned right panel presents four resumable steps:

1. Create the laboratory and select its environment. VirtualBox VM is the default; Docker is an
   explicitly labeled advanced option.
2. Prepare and start the registered VM. VirtualBox must be installed on the host, and the VM must
   have a working OpenSSH server reachable through the configured gateway alias.
3. Open the VM console and sign in to aTrust inside the VM. Credentials and MFA remain there.
4. Register an ordinary final-target OpenSSH alias and test the complete VM → VPN → target path.

Saving a laboratory only persists its configuration. Starting the VM and opening its console are
separate, explicit capability actions, so editing metadata cannot unexpectedly start software or
display a login window.

For a new target, the renderer uses the same canonical Broker capabilities to authorize it for the
current workspace and then probes the complete SSH path through the built-in proxy helper and the
laboratory's loopback SOCKS5 endpoint.
These are convenience steps, not a second transport or configuration path. SciForge never receives
VPN credentials or completes MFA. If automatic workspace authorization cannot be completed, the
saved target remains visible and the panel asks the user to authorize it manually.

## Supported operations

The current package contract and canonical main-process implementation support:

- lab and target registration;
- provider-neutral environment state, ensure/start, open-console, stop, and proxy-endpoint
  operations;
- VirtualBox VM inspection, start, console opening, stop, and a loopback SOCKS5 tunnel through the
  configured VM OpenSSH gateway;
- optional Docker engine readiness, image selection, container lifecycle, loopback-only noVNC
  login, and SOCKS5 endpoint;
- a package-owned cross-platform SSH proxy helper that connects through the selected lab's SOCKS5
  endpoint;
- workspace target allowlists and workspace-scoped target discovery;
- canonical Broker resource observation and reachability probing;
- bounded non-interactive command execution through system `ssh`;
- cancellation of the local SSH process and execution timeouts;
- workspace-bounded uploads and downloads through system `sftp`;
- global, per-lab, and per-target concurrency limits; and
- stable failure classification with redaction of common secret material from captured output.

All non-read operations require confirmation and an idempotency key. Configuration changes,
command cancellation, and upload are external writes; command execution is governed as destructive,
and download is a workspace write. Read-only discovery, Broker observation, and probing do not
require approval.

Remote scripts are passed to `ssh` through standard input, and local processes are spawned with an
argument vector and `shell: false`. File transfers accept normalized workspace-relative local paths;
they do not expose arbitrary host files. Uploads first snapshot the validated workspace file into a
private package-owned staging directory under the same concurrency gate, while downloads stage
outside the workspace and enter it through the SDK safe writer. Uploads and downloads default to a
64 MiB ceiling. Resource mutations use optimistic target revisions, and the service rechecks the
workspace binding, target capability, and current target revision immediately before opening SSH
so changes made while an operation is queued fail closed. Command execution currently requires a
POSIX `sh` on the final target. Command output is bounded after redaction and reports when it was
truncated.

SSH commands can invoke ordinary remote tools such as `sbatch`, `squeue`, `sacct`, or equivalent
scheduler commands. This package does not model a scheduler job lifecycle: callers must persist and
query remote job IDs explicitly.

## Diagnostics

The target probe is the authoritative end-to-end check: inside the privileged service, system
OpenSSH must resolve the private final-target alias, connect through the package-injected SSH proxy
helper and the laboratory's loopback SOCKS5 endpoint, validate host keys, authenticate to the final
target, and run the probe. For a VM lab this verifies the VM gateway, the VPN route inside the VM,
and the final target as one path. The capability result exposes categorized final-target status,
latency, and a bounded diagnostic message, but not the aliases.

Failures are normalized as missing OpenSSH, invalid SSH configuration, target unreachable or
authentication failure, rejected host key, transfer limit, timeout, non-zero remote exit, or
cancellation. The package does not automatically accept a new host key, bypass the configured SSH
path, select another laboratory, or fall back to a direct IP connection.

## Explicit non-goals

Remote SSH does not:

- install VirtualBox or Docker Desktop, or accept their product licenses and operating-system
  elevation prompts;
- create a VirtualBox VM, install its guest operating system, enable its OpenSSH server, or install
  aTrust inside it;
- automate VPN credentials, MFA, device certificates, or laboratory endpoint-compliance decisions;
- claim vendor support for a third-party aTrust image or bypass client/server version checks;
- expose VPN DNS and routes to unrelated host applications;
- provide transparent TCP/UDP access, NFS/SMB mounts, X11, remote desktop, or arbitrary protocol
  tunnelling;
- edit the user's OpenSSH configuration, copy final-server keys into an environment, or enable SSH
  agent forwarding;
- provide a persistent interactive terminal; or
- guarantee that cancelling the local SSH process terminates a remote child process.

Long-running computations should therefore be submitted to a remote batch scheduler or another
durable remote supervisor before the SSH connection is released.

Run `npm test` and `npm run typecheck` from this directory for package-local verification. Package
installation and removal use only the manifest and generated composition path; no domain-specific
host registry or feature switch is required.
