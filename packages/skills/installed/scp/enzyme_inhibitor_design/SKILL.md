---
name: Enzyme Inhibitor Design
description: Design and optimize enzyme inhibitors for therapeutic applications. Supports competitive, non-competitive, and allosteric inhibitor screening with Ki/Km analysis.
metadata:
  scpToolId: enzyme_inhibitor_design
  scpCategory: life_science
  scpType: compute_tool
  provider: 上海人工智能实验室
---

# Enzyme Inhibitor Design

## Overview

Designs enzyme inhibitors with optimized binding affinity and selectivity for drug discovery.

## MCP Invocation

```
toolId: enzyme_inhibitor_design
action: design
params:
  enzyme_name?: string     # Enzyme name or UniProt ID
  substrate_smiles?: string # Known substrate SMILES
  inhibitor_type?: string  # competitive, noncompetitive, allosteric
```

## Local Description

**网页端调用**: https://scphub.intern-ai.org.cn/skill/enzyme_inhibitor_design

**下载说明**: 本地为 SKILL.md 资源定义，工具执行由 SCP Hub 远程服务提供。需配置 `openteam.json → integrations.scpHub.apiKey`。

## Output

- Inhibitor candidates with binding modes
- Ki/Km values and inhibition constants
- Selectivity profile across enzyme families
- ADMET predictions for inhibitor leads