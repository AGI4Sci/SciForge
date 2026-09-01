---
status: accepted
reviewed: 2026-08-24
---

# Use real Provider operations as the content ACL oracle

Content metadata may prove a portable resource's identity, parent and containment, but it never proves that the current external account can read or write it. Project downloads therefore require OpenContent's real `DownloadCheck` before Host opens a Workspace destination, and uploads reach the real no-overwrite Provider write; unauthorized stops the execution and an uncertain write enters durable manual recovery without blind retry. This deliberately rejects metadata ancestry as an ACL shortcut because known-resource metadata can remain visible after Team removal.
