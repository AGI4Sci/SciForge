---
status: accepted
---

# Migrate local identities to cloud-issued canonical user IDs

After successful OIDC authentication, the SciForge cloud issues the canonical user ID and the desktop may associate only its currently selected Local Account after explicit user confirmation. Migration updates only identity references named by the migration contract; the former local ID remains a non-authorizing alias, while Workspaces, chats, files, settings, credentials, historical audit records, and running Agent turns are not reassigned or rewritten. Client-generated IDs, usernames, emails, display names, and Zulip attributes can never select, match, or merge a cloud identity.
