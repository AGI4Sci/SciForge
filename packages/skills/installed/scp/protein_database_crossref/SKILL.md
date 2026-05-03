---
name: Protein Database CrossRef
description: Cross-reference protein data across multiple databases including UniProt, PDB, Pfam, InterPro, and Gene Ontology. Aggregate protein annotations and functional data from authoritative sources.
metadata:
  scpToolId: protein_database_crossref
  scpCategory: life_science
  scpType: compute_tool
  provider: 上海人工智能实验室
---

# Protein Database CrossRef

## Overview

Aggregates protein information from multiple authoritative databases for comprehensive annotation.

## MCP Invocation

```
toolId: protein_database_crossref
action: query
params:
  protein_id?: string     # UniProt ID or gene symbol
  databases?: string[]   # Target databases to query
  include_annotations?: boolean
```

## Local Description

**网页端调用**: https://scphub.intern-ai.org.cn/skill/protein_database_crossref

**下载说明**: 本地为 SKILL.md 资源定义，工具执行由 SCP Hub 远程服务提供。需配置 `openteam.json → integrations.scpHub.apiKey`。

## Output

- Cross-referenced entries from multiple databases
- Sequence and structure data
- Functional annotations and GO terms
- Domain and family classification