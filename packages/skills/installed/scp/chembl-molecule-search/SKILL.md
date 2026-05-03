---
name: ChEMBL Molecule Search
description: Search the ChEMBL database for bioactive molecules, drug-like compounds, and their associated biological activity data. Supports search by compound name, SMILES, InChI, or ChEMBL ID.
metadata:
  scpToolId: chembl-molecule-search
  scpCategory: chemistry
  scpType: compute_tool
  provider: 上海人工智能实验室
---

# ChEMBL Molecule Search

## Overview
Queries the ChEMBL database for small molecules with known bioactivity.

## MCP Invocation
```
toolId: chembl-molecule-search
action: search
params:
  query?: string
  search_type?: string
```

## Local Description
**网页端调用**: https://scphub.intern-ai.org.cn/skill/chembl-molecule-search
**下载说明**: 本地为 SKILL.md 资源定义，工具执行由 SCP Hub 远程服务提供。需配置 `openteam.json → integrations.scpHub.apiKey`。
SKELLEOF
echo "chembl done"