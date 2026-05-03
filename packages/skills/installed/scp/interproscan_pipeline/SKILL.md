---
name: InterProScan Pipeline
description: Predict protein domain families and functional annotation using InterProScan. Input a protein sequence and receive domain architecture, Gene Ontology (GO) terms, pathway annotations, and cross-references to protein databases including Pfam, SMART, PANTHER, and CDD.
metadata:
  scpToolId: interproscan_pipeline
  scpCategory: life_science
  scpType: compute_tool
  provider: 上海人工智能实验室
---

# InterProScan Pipeline

## Overview

Performs comprehensive protein domain and functional annotation by scanning against multiple protein family databases using InterProScan methodology.

## MCP Invocation

```
toolId: interproscan_pipeline
action: annotate
params:
  sequence?: string   # Amino acid sequence (FASTA format or raw)
  databases?: string[] # Optional: specific databases to search
  go_annotation?: boolean # Optional: include GO term annotation
```

## Local Description

**网页端调用**: https://scphub.intern-ai.org.cn/skill/interproscan_pipeline

**下载说明**: 本地为 SKILL.md 资源定义，工具执行由 SCP Hub 远程服务提供。需配置 `openteam.json → integrations.scpHub.apiKey`。

## Output

- Domain architectures with coordinates
- Database matches (Pfam, SMART, PANTHER, CDD, InterPro)
- GO term annotations (Biological Process, Molecular Function, Cellular Component)
- KEGG/Reactome pathway associations
- Protein family classification