---
name: KEGG Gene Search
description: Query and retrieve gene information from the Kyoto Encyclopedia of Genes and Genomes (KEGG) database. Search genes by identifier, pathway, or function and retrieve associated information including orthologs, enzymes, pathways, and disease associations.
metadata:
  scpToolId: kegg-gene-search
  scpCategory: life_science
  scpType: database
  provider: 上海人工智能实验室
---

# KEGG Gene Search

## Overview

Queries and retrieves gene information from the KEGG (Kyoto Encyclopedia of Genes and Genomes) database. Supports search by gene identifier, pathway involvement, enzyme commission number, or functional annotation. Returns associated information including ortholog mappings, enzyme functions, pathway diagrams, and disease relevance.

## MCP Invocation

```python
# Python / FastMCP
from server.api.scp-tools.invoke import invokeMcpTool

result = await invokeMcpTool(
    toolId="kegg-gene-search",
    action="search",
    params={
        "query": "BRCA1",           # Gene symbol, KEGG ID, or keyword
        "organism": "hsa",          # KEGG organism code (e.g., hsa, eco, dme)
        "search_type": "gene",      # "gene" | "pathway" | "enzyme" | "compound"
        "include_orthologs": True,  # Include ortholog information
        "include_pathways": True    # Include pathway associations
    }
)
```

## Local Description

**网页端调用**: https://scphub.intern-ai.org.cn/skill/kegg-gene-search

**下载说明**: 本地为 SKILL.md 资源定义，工具执行由 SCP Hub 远程服务提供。需配置 `openteam.json → integrations.scpHub.apiKey`。

## Output

- Gene identifiers (KEGG, Entrez, UniProt)
- Ortholog groups and mappings
- Associated metabolic and signaling pathways
- Enzyme commission (EC) numbers
- Disease associations and drug targets
- Sequence and functional annotations