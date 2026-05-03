---
name: Drug Target Structure
description: Analyze and predict drug-protein binding structures. Supports target identification, binding pose prediction, and structure-activity relationship analysis for drug discovery.
metadata:
  scpToolId: drug_target_structure
  scpCategory: life_science
  scpType: compute_tool
  provider: 上海人工智能实验室
---

# Drug Target Structure

## Overview

Analyzes drug-target interactions and binding structures for structure-based drug design.

## MCP Invocation

```
toolId: drug_target_structure
action: analyze
params:
  target_protein?: string  # UniProt ID or protein name
  smiles?: string          # Drug compound SMILES
  pdb_id?: string          # Optional PDB structure ID
```

## Local Description

**网页端调用**: https://scphub.intern-ai.org.cn/skill/drug_target_structure

**下载说明**: 本地为 SKILL.md 资源定义，工具执行由 SCP Hub 远程服务提供。需配置 `openteam.json → integrations.scpHub.apiKey`。

## Output

- Predicted binding pose and affinity
- Key interacting residues
- Structure visualization data
- SAR analysis summary