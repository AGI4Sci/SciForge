---
name: GO Term Analysis
description: Perform Gene Ontology enrichment analysis and functional annotation. Supports GO Slim mapping, pathway enrichment, and gene set analysis for genomics datasets.
metadata:
  scpToolId: go_term_analysis
  scpCategory: life_science
  scpType: compute_tool
  provider: 上海人工智能实验室
---

# GO Term Analysis

## Overview

Performs Gene Ontology enrichment analysis for functional genomics interpretation.

## MCP Invocation

```
toolId: go_term_analysis
action: analyze
params:
  gene_list?: string[]    # List of gene symbols or Entrez IDs
  species?: string        # Organism (human, mouse, rat, etc.)
  ontology?: string       # BP, MF, CC
  p_value_threshold?: number  # Significance threshold
```

## Local Description

**网页端调用**: https://scphub.intern-ai.org.cn/skill/go_term_analysis

**下载说明**: 本地为 SKILL.md 资源定义，工具执行由 SCP Hub 远程服务提供。需配置 `openteam.json → integrations.scpHub.apiKey`。

## Output

- Enriched GO terms with p-values
- Fold enrichment values
- Visualization (bar chart, network)
- GO Slim summary for dataset