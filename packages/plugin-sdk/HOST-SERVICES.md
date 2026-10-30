# Host-owned process service composition

This is a generic SDK transport/composition primitive, not a production domain-service integration.

## Trusted Host composition

Construct `HostServiceProviderRegistry` with service IDs, an explicit `authorize(request)` callback and an own-property operation table. Pass it to `new ProcessExtensionHost({ hostServices })`. No provider is installed or authorized by child configuration.

The seventh argument of `runtime.invoke(id, input, generation, signal, revision, invocation, hostServices)` is a trusted Host-only `HostServiceInvocation`: `{ authority, services, assertCurrent? }`. The live synchronous `assertCurrent` lease stays in the Host and is checked before admission, before authorization, after asynchronous authorization and after operation completion. It must never be encoded as JSON. Admission deep-clones/freezes its lossless JSON facts before asynchronous tool authorization. The Host creates connection, package, plugin, version, generation and invocation ownership. Providers receive those immutable facts plus the stable service request ID and a live `AbortSignal`. They must authorize the requested operation/input against Host-owned authority, never against child input masquerading as a caller or grant.

A child uses `globalThis.__sciforgeHostServices.request(serviceId, operation, input)` inside an invocation. The frozen handle exposes `requestId`, `result` and `cancel()`. `HostServiceClient` describes this runner-local API. The runner adds request/invocation correlation, not authority. The Host validates the exact wire schema; extra authority/caller/scope/generation fields are rejected. Foreign or completed invocation IDs cannot grant access, including between different connections with the same generation number.

## Finite request deadlines

`ProcessExtensionRuntime` and the public `ProcessExtensionHost.prepare`/`replace` options accept two Host-owned timer budgets:

- `timeoutMs`: readiness, activation, deactivation, unregister/dispose, discovery and renderer-contribution requests; existing default is 5000 ms.
- `invokeTimeoutMs`: business execution (`invoke`, `managedInvoke`, `workflowInvoke`, `syntheticSession`). With no Host policy cap, an explicit runtime value is used, otherwise the finite `timeoutMs` inheritance is preserved. When the trusted Host supplies a cap, the effective business deadline is `min(host invokeTimeoutMs, runtime invokeTimeoutMs)`; an omitted runtime request therefore uses the Host cap. A longer runtime request can never expand Host authority. The Host cap does not alter lifecycle/discovery deadlines.

Both values must be integer milliseconds in `[1, 2147483647]` (Node's supported timer range); zero, infinity, fractional and overflow values are rejected before a child starts. Neither a plugin manifest nor service input chooses these Host budgets. A business budget may also be shorter than the lifecycle budget.

On a service-composed timeout the Host first removes the pending response owner, revokes service authority, aborts real provider signals and sends child cancellation. It rejects with `request_timeout` only after the admitted providers actually settle. Late child success, later explicit abort and concurrent disposal cannot turn that timeout into success or certify quiescence early. An explicit abort that wins first retains `request_cancelled`. Legacy invocation timeout still does not send child cancellation.

The execution deadline is finite; actual provider drain is a separate obligation, not a new execution allowance. A noncooperative provider cannot be certified stopped using a second transport timer. Bounded teardown requires that provider's abort-to-settlement guarantee or an independently owned, terminable executor; the transport must retain cleanup ownership rather than claim quiescence while work continues.

### Product policy boundary

There is no existing product-wide business-invocation duration in this SDK contract. Existing router budgets are evidence for separating execution from lifecycle, not interchangeable end-to-end contracts: `packages/workers/model-router/src/upstream-drivers.ts` gives each upstream request/probe a default 300000 ms and combines it with a caller signal; protocol negotiation can issue multiple attempts. The router's `src/manifest.ts` instead advertises 120000 ms per capability, and `src/router.ts` has a separate 1800000 ms scientific-service fallback. Thus neither 120000 nor 300000 is automatically an aggregate plugin-invocation maximum. An invocation may also contain several service/model calls.

This change keeps the SDK default at 5000 ms and selects `HOST_BUSINESS_INVOKE_TIMEOUT_MS = 1800000` only in trusted application composition. The value reuses the existing scientific-service fallback as a product-scale long-work reference, but is generic rather than Evidence-specific: one admitted plugin invocation may contain multiple model calls and worker operations. The same Host policy is installed before startup activation and is inherited by `PluginUpdateCoordinator` prepares; an explicit runtime `invokeTimeoutMs` may shorten it but cannot override/expand the cap. An outer invocation deadline may deliberately cap downstream budgets; abort must propagate and actual provider drain must still precede timeout rejection. A configured startup-only value would be incomplete: update receives the same Host policy.

Possible follow-up ownership choices are a Host-wide configured business budget (passed on both startup and update paths), a trusted capability/effect-specific policy resolver, or an authenticated per-invocation deadline capped by a Host maximum. A per-invocation deadline would need an explicit public Broker/SDK contract and live authority validation; an AbortSignal alone is not an authenticated deadline. None of these choices justifies a domain-name exception, unbounded execution, silently swallowing abort, or a longer lifecycle budget.

## Cancellation, generation and drain

- A request ID is stable for one handle. Duplicate requests never execute again or settle the original handle, including malformed duplicates. This is connection-local replay suppression, not durable retry/idempotency storage.
- `cancel()` resolves only from the terminal provider response, with `{ cancelled, quiescent }`. Repeated cancellation observes the same completion. `cancelled: true` means abort was observed before settlement, not that effects were rolled back.
- Host abort, service-composed invocation timeout, invocation completion and child exit revoke the owner and abort outstanding provider signals. Providers may continue until they actually settle. Asynchronous authorization is rechecked for abort before the operation handler starts.
- Generation commit synchronously revokes previous service owners before publishing the candidate. Rollback does not revive old invocation grants. A fresh trusted invocation grant is required.
- `waitForServiceQuiescence()` waits for actual admitted provider promises. To use it as a close barrier, fence admission first. Deactivate/dispose retain that obligation even when the child exits. A provider that ignores cancellation and never settles can therefore keep drain pending indefinitely; no abort/send/exit timeout is relabeled as quiescence.
- Host `dispose()` transfers retired runtimes into cleanup-only ownership before teardown. A rejected disposer remains reachable through `dispose()`/`disposeAll()`, cannot receive new service grants, and blocks another prepare until retry succeeds. Successful runtimes are removed individually and are not disposed again on retry.
- IPC disconnect reports uncertain completion (`quiescent: false`) to the child; it cannot certify Host provider settlement.

Legacy ports retain their serialized named-runner lane and timeout semantics. Host-service-enabled calls can overlap through `AsyncLocalStorage`; they do not inherit a shared workspace binding for legacy ports.

## Runner-local Cordis composition

`HostServiceClientFactory` contains `serviceId`, an absolute trusted `modulePath`, `exportName` and detached JSON `config`. `ProcessExtensionHost.resolveServiceClients` supplies these descriptors from Host composition; the runner calls each factory with the generic runner-local client and provides its returned value to Cordis before plugin activation. No factory is discovered from untrusted plugin configuration. This does not create an ordinary Agent or interpret a thread ID as a native Session.

A service-composed DSH call may use the public ordinary Session provenance captured by the Broker instead of requiring the child-local native Agent envelope. The Host requires a live lease and trusted client composition for this route. Lifecycle deactivation receives a separate Host-created `lifecycle: 'deactivate'` authority so package providers can permit cleanup, never ordinary effects.

## Authenticated cross-session workspace reads

`DshToolGrants` entries may explicitly opt a `read` tool into `readResource: 'workspace'`. This is a Host-approved grant, not package metadata or tool input; other effects cannot use it. Default read tools retain `dsh-session` resources and their authenticated ordinary Session requirement.

An opted-in tool remains resource-scoped (`dsh-workspace`) and gains a per-operation `${actionId}.open` workspace-scoped read opener. The opener checks the current package/version/generation, live approval and service composition, then issues a Broker resource bound to exact caller/audience/workspace and only that operation. Resource observation rechecks the live grant; revocation, foreign callers and foreign workspaces fail closed. It never invents an ordinary Session. Host system invokers acquire the resource through this opener with the same principal and signal, then invoke the original operation through the Broker. Passing only a workspace to the raw Broker does not bypass resource admission. Consumers that already possess a resource may pass it explicitly.

## Deliberately outside this slice

No domain provider or production application wiring is supplied by the generic SDK. The SDK also supplies no filesystem sandbox, durable exactly-once protocol, provider resource quotas, cross-process shared storage or packaged Electron acceptance. Plugins in one child share that child's trust level; invocation correlation is not a security partition between mutually hostile code inside that same process. Request replay tracking is generation-lifetime memory and is not currently quota-bounded. Providers must own and await all side effects they start; a detached effect cannot be proven quiescent by this transport.

## Checks

```sh
node --import tsx --test packages/plugin-sdk/src/host-service-composition.test.ts
node --import tsx --test packages/plugin-sdk/src/host-service-composition.test.ts packages/plugin-sdk/src/dsh-cancellation.test.ts packages/plugin-sdk/src/process-extension-host.test.ts packages/plugin-sdk/src/process-extension-runner.test.ts
node --import tsx --test 'packages/plugin-sdk/src/**/*.test.ts'
node node_modules/typescript/bin/tsc --noEmit -p packages/plugin-sdk/tsconfig.json
```
