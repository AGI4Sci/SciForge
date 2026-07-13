# @sciforge/workspace-intel

Read-only workspace and visible-GUI intelligence worker for SciForge runtimes.

It exposes guarded workspace listing, tree, file read, preview, reference, skill discovery, visible-context lookup, and fail-closed visual capture plus semantic Model Router inspection through a pure Node service and an MCP stdio server.

Visual capture accepts either the SciForge window or a component target published by `gui_visible_context`. The worker does not capture pixels itself or accept arbitrary screen coordinates: it writes a bounded request into the GUI-managed visible-context broker, waits for the single main-process capture service, verifies the returned managed PNG, and removes the transient request files. It never captures continuously or reads clipboard state.
