---
name: Rare Disease Genetics
description: Identify and analyze genetic variants associated with rare diseases using multi-omics data integration, phenotype matching via HPO terms, and literature mining. Supports variant prioritization, pathway analysis, and clinical interpretation for undiagnosed rare disease cases.
metadata:
  scpToolId: rare_disease_genetics
  scpCategory: life_science
  scpType: compute_tool
  provider: 上海人工智能实验室
---

# Rare Disease Genetics

## Overview

Identifies and analyzes genetic variants associated with rare diseases by integrating multi-omics data, phenotype matching through Human Phenotype Ontology (HPO) terms, and automated literature mining. The tool prioritizes candidate variants, performs pathway enrichment analysis, and provides clinical interpretation for undiagnosed rare disease cases.

## MCP Invocation

```
toolId: rare_disease_genetics
action: analyze
params:
  gene_list?: string[]      # List of candidate genes
  hpo_terms?: string[]      # HPO phenotype terms
  variants?: string         # VCF variant data or variant IDs
  analysis_type?: string    # "variant_prioritization" | "pathway" | "literature" | "full"
  cohort_size?: number      # Optional cohort size for statistical analysis
```

## Local Description

**网页端调用**: https://scphub.intern-ai.org.cn/skill/rare_disease_genetics

**下载说明**: 本地为 SKILL.md 资源定义，工具执行由 SCP Hub 远程服务提供。需配置 `openteam.json → integrations.scpHub.apiKey`。

## Output

- Prioritized candidate variants with pathogenicity scores
- HPO phenotype matches and phenotypic similarity
- Pathway and GO enrichment results
- Literature evidence links
- Clinical interpretation summary with ACMG criteria