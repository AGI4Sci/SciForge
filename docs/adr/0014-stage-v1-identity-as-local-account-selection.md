---
status: accepted
---

# Stage V1 identity as local account selection

V1 persists Local Accounts in application-owned SQLite and lets a user create or select one by username, automatically restore the last selection, and exit it. The stable local user ID provides identity context for desktop features, but username selection is explicitly not authentication and grants no cloud, cross-user, OpenContent, Project-permission, or remote-Agent authority. A future cloud Identity service will replace this adapter behind the same Identity contract and add email-code authentication; it must explicitly migrate or map local identities instead of silently treating them as verified cloud users.
