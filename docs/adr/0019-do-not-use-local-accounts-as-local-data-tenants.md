---
status: accepted
---

# Do not use Local Accounts as local data tenants

V1 Local Accounts identify the current user for attribution and future ownership references but do not partition or reassign chats, Workspaces, files, model settings, API keys, tool configuration, or other installation-scoped data. Switching accounts changes only the current Principal, and Workspace access remains governed by existing local authorization. This avoids an unrequested full local multi-tenancy migration, while requiring the UI to state that separate operating-system accounts are needed for local privacy isolation.
