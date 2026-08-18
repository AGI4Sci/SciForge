## Why

A Personal Session Agent can discover Content Space root authorization, but a request such as “use the OpenContent Team library” does not supply the exact Human-visible library label required by that operation. The Agent currently has no safe native way to obtain candidate labels, so it either stops for information the product can already enumerate or guesses a Provider Instance label as a root label.

## What Changes

- Add an Agent-only, provider-neutral global read capability that lists bounded personal or shared root candidate labels for one Broker-returned Provider Instance.
- Return only the Provider Instance reference, requested scope, Human-visible labels, and the opaque page cursor; never return a container reference, folder ID/GUID, Team ID, connection, endpoint, or credential.
- Keep exact root authorization as a separate Human-confirmed operation that re-enumerates live Provider state and accepts only one exact canonical label-and-scope match.
- Clarify generic runtime guidance and discovery metadata so the Agent first obtains Provider Instances, then safe candidate labels when needed, and never substitutes a Provider display label for a Provider resource label.
- Clarify the safe create-then-upload sequence: after creating a folder, re-list the authorized parent to obtain the new child Broker resource before uploading into it.
- Keep Human raw-reference immutable-observation and portal operations out of the Agent audience so descriptive Provider references cannot become descendant authority.
- Do not add a Host domain switch, Provider-specific Agent tool, direct Connector path, Change 2 Project binding, Shared Documents, DocumentProvider, credential change, or installed-package work.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `content-space`: Add the redacted Agent root-candidate listing contract and make the resource-scoped create/list/upload sequence explicit.
- `opencontent-content-space-provider`: Allow an Agent to obtain safe Team library labels through the provider-neutral Content Space path while keeping OpenContent folder identities integration-private and exact authorization live and Human-confirmed.

## Impact

The change affects the Content Space public schemas and capability factory, capability audience/discovery metadata and tests, generic canonical runtime guidance, generated capability documentation, ADR-0029 clarification, and the two named OpenSpec contracts. It reuses the existing ContentSpaceService, Provider catalog, OpenContent adapter, Connector facade, current Principal binding, and `Team/GetMyTeamList` mapping; no OpenContent API, token, credential, endpoint, or Provider package implementation change is required.
