---
name: DrugSDA De Novo Sampling
description: Generate novel drug-like molecules using deep learning de novo molecular design. Receives a SMILES string or pharmacophore constraints, then produces new candidate molecules with desired properties through generative models.
metadata:
  scpToolId: drugsda-denovo-sampling
  scpCategory: chemistry
  scpType: compute_tool
  provider: 上海人工智能实验室
---

# DrugSDA De Novo Sampling

## Overview

Generates novel drug-like molecules using deep learning de novo molecular design. The tool accepts SMILES strings or pharmacophore constraints and produces new candidate molecules with desired physicochemical and pharmacological properties through generative models.

## MCP Invocation

```python
# Python / FastMCP
from server.api.scp-tools.invoke import invokeMcpTool

result = await invokeMcpTool(
    toolId="drugsda-denovo-sampling",
    action="generate",
    params={
        "smiles": "CCO",          # Reference scaffold SMILES
        "num_samples": 10,        # Number of molecules to generate
        "property_constraints": {  # Optional property filters
            "mw_range": [200, 500],
            "logp_range": [-1, 4],
            "tpsa_range": [40, 120]
        },
        "generation_method": "vae"  # "vae" | "gan" | "transformer"
    }
)
```

## Local Description

**网页端调用**: https://scphub.intern-ai.org.cn/skill/drugsda-denovo-sampling

**下载说明**: 本地为 SKILL.md 资源定义，工具执行由 SCP Hub 远程服务提供。需配置 `openteam.json → integrations.scpHub.apiKey`。

## Output

- Generated SMILES strings with validity scores
- Molecular property predictions (MW, LogP, TPSA)
- Similarity to reference scaffold
- Diversity metrics for generated ensemble
- Confidence scores per generated molecule