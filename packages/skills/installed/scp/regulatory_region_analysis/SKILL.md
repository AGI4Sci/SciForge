---
name: Regulatory Region Analysis
description: Analyze genomic regulatory regions such as promoters, enhancers, silencers, transcription factor binding sites, and chromatin accessibility intervals. Supports motif scanning, cis-regulatory annotation, and candidate regulatory element prioritization.
metadata:
  scpToolId: regulatory_region_analysis
  scpCategory: life_science
  scpType: compute_tool
  provider: 上海人工智能实验室
---

# Regulatory Region Analysis

## Overview

Analyzes genomic regulatory regions to identify functional control elements that influence gene expression. The tool supports promoter and enhancer annotation, transcription factor motif discovery, chromatin accessibility interpretation, and prioritization of candidate cis-regulatory elements.

## MCP Invocation

```python
# Python / FastMCP
from server.api.scp-tools.invoke import invokeMcpTool

result = await invokeMcpTool(
    toolId="regulatory_region_analysis",
    action="analyze",
    params={
        "genomic_region": "chr8:128748315-128753680",  # Genomic interval
        "genome_build": "hg38",                        # Reference assembly
        "analysis_mode": "enhancer",                   # "promoter" | "enhancer" | "motif" | "open_chromatin"
        "gene_context": "MYC",                         # Optional nearby gene
        "include_motifs": True,                        # Run motif / TFBS search
        "include_accessibility": True                  # Integrate chromatin accessibility evidence
    }
)
```

## Local Description

**网页端调用**: https://scphub.intern-ai.org.cn/skill/regulatory_region_analysis

**下载说明**: 本地为 SKILL.md 资源定义，工具执行由 SCP Hub 远程服务提供。需配置 `openteam.json → integrations.scpHub.apiKey`。

## Output

- Candidate promoters, enhancers, or silencers in the queried region
- Transcription factor motif matches and TFBS annotations
- Nearby gene associations and regulatory context
- Chromatin accessibility and epigenomic support signals
- Prioritized cis-regulatory elements with confidence scores
