---
name: PubChem Deep Dive
description: Comprehensive PubChem database exploration including compound properties, bioactivity data, spectral information, and patent records. Supports CID/SMILES/InChI queries.
metadata:
  scpToolId: pubchem_deep_dive
  scpCategory: chemistry
  scpType: compute_tool
  provider: 上海人工智能实验室
---

# PubChem Deep Dive

## Overview

Performs comprehensive searches and analyses of PubChem compound data.

## MCP Invocation

```
toolId: pubchem_deep_dive
action: search
params:
  query?: string          # Compound name, SMILES, InChI, or CID
  search_type?: string    # name, smiles, inchikey, cid
  include_assays?: boolean  # Include bioassay data
  include_patents?: boolean # Include patent records
```

## Local Description

**网页端调用**: https://scphub.intern-ai.org.cn/skill/pubchem_deep_dive

**下载说明**: 本地为 SKILL.md 资源定义，工具执行由 SCP Hub 远程服务提供。需配置 `openteam.json → integrations.scpHub.apiKey`。

## Output

- Compound properties and 2D/3D structures
- Bioactivity assay results
- Spectral data (NMR, IR, MS)
- Related patents and literature