---
name: Protein Structure Analysis
description: Analyze protein 3D structures to predict secondary structure elements (alpha-helices, beta-strands), domain boundaries, solvent accessibility, and structural homology. Integrates with AlphaFold predictions and experimental structure databases (PDB).
metadata:
  scpToolId: protein_structure_analysis
  scpCategory: life_science
  scpType: compute_tool
  provider: 上海人工智能实验室
---

# Protein Structure Analysis

## Overview

Analyzes protein 3D structures to extract structural information including secondary structure elements, domain boundaries, solvent accessibility, and structural features. Integrates with AlphaFold predictions and PDB experimental structures.

## MCP Invocation

```
toolId: protein_structure_analysis
action: analyze
params:
  protein_id?: string    # UniProt ID or PDB ID
  structure_file?: string # Optional PDB/mmCIF file input
  analysis_type?: string # "secondary" | "domain" | "surface" | "full"
```

## Local Description

**网页端调用**: https://scphub.intern-ai.org.cn/skill/protein_structure_analysis

**下载说明**: 本地为 SKILL.md 资源定义，工具执行由 SCP Hub 远程服务提供。需配置 `openteam.json → integrations.scpHub.apiKey`。

## Output

- Secondary structure composition (alpha-helix, beta-sheet percentages)
- Domain boundary predictions
- Solvent accessibility scores
- Structural classification (CATH/SCOP)
- Active site predictions