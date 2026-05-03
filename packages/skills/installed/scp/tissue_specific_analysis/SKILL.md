---
name: Tissue Specific Analysis
description: Analyze gene expression patterns across different tissue types to identify tissue-specific genes, functional enrichment in specific tissues, and cross-tissue regulatory networks. Integrates with GTEx, human protein atlas, and other expression databases.
metadata:
  scpToolId: tissue_specific_analysis
  scpCategory: life_science
  scpType: compute_tool
  provider: 上海人工智能实验室
---

# Tissue Specific Analysis

## Overview

Analyzes gene expression patterns across different tissue types to identify tissue-specific genes, functional enrichment patterns, and cross-tissue regulatory networks. Integrates with major expression databases including GTEx and Human Protein Atlas.

## MCP Invocation

```
toolId: tissue_specific_analysis
action: analyze
params:
  gene_list?: string[]    # List of gene symbols/IDs
  tissue_types?: string[] # Target tissue types (e.g., "liver", "brain", "heart")
  analysis_type?: string  # "specificity" | "enrichment" | "network"
  data_source?: string   # "gtex" | "hpa" | "combined"
```

## Local Description

**网页端调用**: https://scphub.intern-ai.org.cn/skill/tissue_specific_analysis

**下载说明**: 本地为 SKILL.md 资源定义，工具执行由 SCP Hub 远程服务提供。需配置 `openteam.json → integrations.scpHub.apiKey`。

## Output

- Tissue-specific gene lists with expression scores
- Functional enrichment analysis per tissue
- Cross-tissue co-expression networks
- Specificity indices (tau score, z-score)
- Disease relevance annotations