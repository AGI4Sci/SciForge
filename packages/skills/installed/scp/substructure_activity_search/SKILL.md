---
name: Substructure Activity Search
description: Perform substructure-based activity relationship (SAR) analysis to identify molecular substructures associated with biological activity. Supports SMILES/MOL file input, scaffold analysis, and activity cliff detection for drug discovery.
metadata:
  scpToolId: substructure_activity_search
  scpCategory: chemistry
  scpType: compute_tool
  provider: 上海人工智能实验室
---

# Substructure Activity Search

## Overview

Performs substructure-based structure-activity relationship (SAR) analysis to identify molecular substructures that correlate with biological activity. The tool analyzes chemical structures to detect activity cliffs, common scaffolds, and key pharmacophoric features for drug discovery applications.

## MCP Invocation

```
toolId: substructure_activity_search
action: search
params:
  smiles_list?: string[]  # List of SMILES strings with activity data
  substructure?: string   # Target substructure SMARTS pattern
  activity_threshold?: number  # Minimum activity value for active compounds
  search_type?: string    # "scaffold" | "substructure" | "activity_cliff"
```

## Local Description

**网页端调用**: https://scphub.intern-ai.org.cn/skill/substructure_activity_search

**下载说明**: 本地为 SKILL.md 资源定义，工具执行由 SCP Hub 远程服务提供。需配置 `openteam.json → integrations.scpHub.apiKey`。

## Output

- Active substructures with frequency statistics
- Scaffold decomposition (Murcko scaffolds, framework analysis)
- Activity cliff predictions (major changes in activity with minor structural changes)
- SAR hypothesis generation
- Similarity metrics between active/inactive compounds