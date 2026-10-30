---
status: accepted
---

# Use an Apple silicon Mac as the first SSH Site Gateway host

The first persistent inbound SSH/SFTP Gateway will run as a separately supervised macOS service on an Apple silicon Mac with ARM64 UTM VPN guests. It will expose only target-scoped, client-authenticated SSH byte streams through the existing Remote SSH laboratory path; it will not become a transparent router, host shell, or Institution Site Node. The client retains final laboratory SSH credentials and host-key verification, so Gateway audit is connection-level rather than command-level. Intel Macs, x86 guests, Linux deployment, arbitrary TCP/UDP, and federated task execution remain later decisions.
