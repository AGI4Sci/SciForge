# AI4AI Model Iteration Research Log

This fixture models five iterative training/evaluation runs for the Research Memory showcase.

- v1: initial baseline.
- v2: larger learning rate caused noisier validation behavior.
- v3: lower learning rate with feature normalization improved accuracy.
- v4: larger model overfit despite better train loss.
- v5: v3 baseline with calibrated threshold improved F1 while keeping loss stable.

The showcase acceptance test records these runs, reflects experiment memory, resolves context for the next plan, and writes `artifacts/research_memory_snapshot.md`.
