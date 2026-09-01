---
status: accepted
reviewed: 2026-08-24
---

# Sign Project content observations, not Provider authority

After provisioning, Identity/Host uses the current enrolled Device key to sign a canonical digest of the Owner, Device, Provider binding, exact root, member observations, receipts and provisioning revision. Cloud verifies this `ProjectContentProvisioningAttestation` before binding the Project, but treats it only as evidence of who observed which facts; it contains no secret, persistent scope or claim of continued Provider ACL. Provider Binding Attestation, Cloud Project Membership and Task authority remain separate, because Cloud cannot safely convert a one-time external observation into ongoing Provider permission.
