---
name: Variant GWAS Associations
description: Query and analyze genome-wide association study (GWAS) data for genetic variants. Supports SNP-trait associations, LD proxy lookups, and PheWAS analysis.
metadata:
  scpToolId: variant-gwas-associations
  scpCategory: life_science
  scpType: compute_tool
  provider: 上海人工智能实验室
---

# Variant GWAS Associations

## Overview

Queries GWAS catalog and association databases for genetic variant interpretation.

## MCP Invocation

```
toolId: variant-gwas-associations
action: query
params:
  variant_id?: string     # rsID or genomic coordinates
  trait?: string          # Phenotype/trait of interest
  p_value_threshold?: number
  population?: string     # Ancestral population
```

## Local Description

**网页端调用**: https://scphub.intern-ai.org.cn/skill/variant-gwas-associations

**下载说明**: 本地为 SKILL.md 资源定义，工具执行由 SCP Hub 远程服务提供。需配置 `openteam.json → integrations.scpHub.apiKey`。

## Output

- GWAS association statistics (OR, beta, p-value)
- Trait ontology mappings
- LD proxy variants
- PheWAS results for pleiotropy