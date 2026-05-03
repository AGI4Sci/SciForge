---
name: Synthetic Biology Design
description: Design synthetic biology constructs including gene circuits, CRISPR components, and metabolic pathways. Supports pathway optimization and gene expression vector design.
metadata:
  scpToolId: synthetic_biology_design
  scpCategory: life_science
  scpType: compute_tool
  provider: 上海人工智能实验室
---

# Synthetic Biology Design

## Overview

Designs synthetic biology constructs for engineered biological systems.

## MCP Invocation

```
toolId: synthetic_biology_design
action: design
params:
  design_type?: string    # circuit, crispr, pathway, vector
  target_pathway?: string # Metabolic pathway or target
  host_organism?: string  # Expression host
  optimization_level?: string  # minimal, standard, extensive
```

## Local Description

**网页端调用**: https://scphub.intern-ai.org.cn/skill/synthetic_biology_design

**下载说明**: 本地为 SKILL.md 资源定义，工具执行由 SCP Hub 远程服务提供。需配置 `openteam.json → integrations.scpHub.apiKey`。

## Output

- Gene circuit designs with logic gates
- CRISPR guide RNA sequences
- Metabolic pathway models
- Expression vector sequences