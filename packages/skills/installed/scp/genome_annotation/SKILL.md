---
name: Genome Annotation
description: Perform automated genome annotation by identifying and classifying genomic features including genes, exons, introns, promoters, regulatory regions, and other functional elements. Supports both prokaryotic and eukaryotic genome annotation workflows.
metadata:
  scpToolId: genome_annotation
  scpCategory: life_science
  scpType: compute_tool
  provider: 上海人工智能实验室
---

# Genome Annotation

## Overview

Performs automated genome annotation to identify and classify genomic features. The tool analyzes DNA sequences to detect genes, exons, introns, promoters, regulatory regions, and other functional elements across both prokaryotic and eukaryotic genomes.

## MCP Invocation

```
toolId: genome_annotation
action: annotate
params:
  sequence?: string      # DNA sequence input
  organism_type?: string # "prokaryotic" | "eukaryotic"
  annotation_level?: string  # "basic" | "comprehensive"
```

## Local Description

**网页端调用**: https://scphub.intern-ai.org.cn/skill/genome_annotation

**下载说明**: 本地为 SKILL.md 资源定义，工具执行由 SCP Hub 远程服务提供。需配置 `openteam.json → integrations.scpHub.apiKey`。

## Output

- Gene predictions with coordinates
- Exon/intron structures
- Functional annotations (GO, KEGG)
- Regulatory region predictions
- Protein-coding potential scores