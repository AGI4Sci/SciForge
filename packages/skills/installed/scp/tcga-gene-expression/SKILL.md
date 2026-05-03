---
name: TCGA Gene Expression
description: Query and analyze tumor gene expression profiles from The Cancer Genome Atlas (TCGA). Supports cohort-level expression lookup, tumor-versus-normal comparison, subtype stratification, and candidate biomarker exploration across cancer types.
metadata:
  scpToolId: tcga-gene-expression
  scpCategory: life_science
  scpType: database
  provider: 上海人工智能实验室
---

# TCGA Gene Expression

## Overview

Queries TCGA gene expression datasets for tumor cohorts and matched clinical contexts. The tool supports expression lookup across cancer types, tumor versus normal comparison, subtype-aware stratification, and biomarker-oriented interpretation of transcriptomic patterns.

## MCP Invocation

```python
# Python / FastMCP
from server.api.scp-tools.invoke import invokeMcpTool

result = await invokeMcpTool(
    toolId="tcga-gene-expression",
    action="query",
    params={
        "gene": "EGFR",                 # Gene symbol or Ensembl ID
        "cancer_type": "LUAD",          # TCGA cohort code
        "comparison": "tumor_vs_normal",# "tumor" | "normal" | "tumor_vs_normal"
        "summary_stat": "median",       # "median" | "mean" | "distribution"
        "include_survival": True,       # Optional clinical association
        "include_subtypes": True        # Stratify by molecular subtype if available
    }
)
```

## Local Description

**网页端调用**: https://scphub.intern-ai.org.cn/skill/tcga-gene-expression

**下载说明**: 本地为 SKILL.md 资源定义，工具执行由 SCP Hub 远程服务提供。需配置 `openteam.json → integrations.scpHub.apiKey`。

## Output

- Cohort-level expression values for the queried gene
- Tumor versus normal differential expression summaries
- Cancer subtype stratification results when available
- Survival or clinical association hints for biomarker analysis
- Exportable expression statistics and cohort metadata
