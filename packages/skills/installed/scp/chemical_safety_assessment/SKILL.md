---
name: Chemical Safety Assessment
description: Evaluate chemical compound safety profiles including toxicity endpoints, hazard classification, MSDS generation, and regulatory compliance assessment. Supports GHS classification, LD50 analysis, and acute/chronic toxicity predictions.
metadata:
  scpToolId: chemical_safety_assessment
  scpCategory: chemistry
  scpType: compute_tool
  provider: 上海人工智能实验室
---

# Chemical Safety Assessment

## Overview

Assesses chemical compound safety profiles for regulatory compliance and hazard evaluation. Supports multiple toxicity endpoints and international safety standards.

## MCP Invocation

```
toolId: chemical_safety_assessment
action: assess
params:
  smiles?: string      # SMILES structure input
  compound_name?: string # Alternative name input
  assessment_type?: string  # acute, chronic, ghs, msds
```

## Local Description

**网页端调用**: https://scphub.intern-ai.org.cn/skill/chemical_safety_assessment

**下载说明**: 本地为 SKILL.md 资源定义，工具执行由 SCP Hub 远程服务提供。需配置 `openteam.json → integrations.scpHub.apiKey`。

## Output

- Toxicity classification (GHS hazard codes)
- LD50/LC50 values and species data
- MSDS-ready safety data sheets
- Risk assessment recommendations