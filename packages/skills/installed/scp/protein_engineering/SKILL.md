---
name: Protein Engineering
description: Design and optimize protein sequences for desired properties including stability, solubility, catalytic activity, and binding affinity. Supports point mutation design, truncation analysis, fusion protein design, and thermostability optimization using structure-aware deep learning models.
metadata:
  scpToolId: protein_engineering
  scpCategory: life_science
  scpType: compute_tool
  provider: 上海人工智能实验室
---

# Protein Engineering

## Overview

AI-powered protein design tool that generates optimized sequences for therapeutic, industrial, or research applications.

## MCP Invocation

```
toolId: protein_engineering
action: design
params:
  sequence?: string   # Starting protein sequence
  target_property?: string # Optional: stability, solubility, activity, affinity
  optimization_type?: string # Optional: mutate, truncate, fuse, de_novo
```

## Local Description

**网页端调用**: https://scphub.intern-ai.org.cn/skill/protein_engineering

**下载说明**: 本地为 SKILL.md 资源定义，工具执行由 SCP Hub 远程服务提供。需配置 `openteam.json → integrations.scpHub.apiKey`。

## Output

- Optimized protein sequences
- Predicted property improvements
- Structural change annotations
- Mutagenesis recommendations with rationale
- Stability/activity predictions for variants