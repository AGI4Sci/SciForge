---
name: Example Bio-Chem Tool
description: Example biochemistry tool template for SCP Hub local skill development. Demonstrates the standard SKILL.md structure with frontmatter, MCP invocation schema, and local description format.
metadata:
  scpToolId: example-bio-chem-tool
  scpCategory: chemistry
  scpType: compute_tool
  provider: 上海人工智能实验室
---

# Example Bio-Chem Tool

## Overview

A reference biochemistry tool template demonstrating the standard SKILL.md structure for SCP Hub local skill development. This tool serves as a placeholder example showing how to define tools with SMILES/Molecular input, property calculations, and results formatting.

## MCP Invocation

```python
# Python / FastMCP
from server.api.scp-tools.invoke import invokeMcpTool

result = await invokeMcpTool(
    toolId="example-bio-chem-tool",
    action="calculate",
    params={
        "smiles": "CCO",  # Molecular input SMILES
        "properties": ["mw", "logp", "tpsa"]  # Properties to calculate
    }
)
```

## Local Description

**网页端调用**: https://scphub.intern-ai.org.cn/skill/example-bio-chem-tool

**下载说明**: 本地为 SKILL.md 资源定义，工具执行由 SCP Hub 远程服务提供。需配置 `openteam.json → integrations.scpHub.apiKey`。

## Output

- Calculated molecular properties (MW, LogP, TPSA)
- Structure validation results
- Property score metrics

## 备注

此为占位模板，供 SCP Hub 本地 skill 开发参考。配置 `openteam.json` 中 `integrations.scpHub.apiKey` 后可调用真实工具。