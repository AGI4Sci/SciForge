# Anchored Comments domain

This package owns SciForge's anchored-comment state, command, global overlay,
bounded composer context, persistence, and product-feedback flow.

The renderer can comment only on targets exposed through the Host's registered
visual-target contract. It cannot traverse the application DOM or choose
redaction regions. Screenshot capture and redaction remain Host-governed, while
the package stores immutable content-addressed evidence and routes all business
operations through the Capability Broker.
