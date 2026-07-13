# Reviewer/Rebuttal Workflow — Research Brief

## Reference Papers
- "Can AI Assist in Peer Review? A Systematic Analysis" (ACL 2024) — workflow diagrams for AI-assisted review pipelines
- "PeerReview-Agent: LLM-based Review Generation" (NeurIPS 2024) — pipeline flowcharts showing review stage decomposition
- "SciAssess: Benchmarking LLM Proficiency in Scientific Literature Analysis" (ICML 2024 Workshop) — evidence-linking diagrams
- "An Open-Source Structured Peer Review System" (PMC 2025) — review workflow architectures

## Figure Conclusion
This flowchart demonstrates the end-to-end Reviewer/Rebuttal Workflow — a six-stage pipeline for evidence-governed peer review that transforms manuscripts and anticipated reviewer concerns into structured claims, evidence mappings, fragility classifications, decomposed reviewer comments, prioritized rebuttal plans, and generated response letters.

## Evidence Logic
Linear pipeline architecture: manuscript parsing → evidence mapping → fragility classification → reviewer decomposition → rebuttal planning → response generation. Each stage's structured output feeds the next stage. Inputs enter from the left; final outputs emerge on the right. The fragility audit stage is the critical decision point that determines downstream rebuttal strategy.

## Visual Archetype
Horizontal pipeline flowchart — common in NLP/systems/ML papers at top conferences (ACL, NeurIPS, ICML, EMNLP). Rounded-rectangle stage boxes connected by directional arrows. Input/output blocks at opposite ends. Title centered at top.

## Layout
Single-row horizontal flow: Input → Stage 1 → Stage 2 → Stage 3 → Stage 4 → Stage 5 → Stage 6 → Output. Each box contains stage number, descriptive title, and brief purpose description. Subtitle descriptions in smaller font below stage titles.

## Color Palette
Professional blue-teal gradient across the pipeline:
- Stage 1: #0D7377 (dark teal)
- Stage 2: #0E8C8C (medium teal)
- Stage 3: #14919B (teal-blue)
- Stage 4: #1A7FA0 (steel blue)
- Stage 5: #1A73A8 (medium blue)
- Stage 6: #1A6BB0 (blue)
- Input block: #E8F4F8 (light blue-grey)
- Output block: #E8F4F8 (light blue-grey)
- Background: #FFFFFF
- Text on colored boxes: #FFFFFF
- Text on light blocks: #333333
- Arrows: #555555

## Typography
Clean modern sans-serif (Inter/Helvetica style). Stage numbers in bold circles (14pt). Stage titles in semi-bold (13pt). Descriptions in regular weight (10pt). Title in bold (18pt). Input/output labels in italic.

## Annotation Style
Stage numbers 1-6 in white circles at top-left of each box. Simple arrow icons (→) between boxes. Input label "Inputs" and Output label "Outputs" in italic above respective blocks.
