---
name: variant_pathogenicity
description: "Variant Pathogenicity Prediction - Predict variant pathogenicity: deleteriousness scoring, conservation analysis, clinical interpretation, and disease association. Use this skill for clinical genetics tasks involving score deleteriousness analyze conservation interpret clinically associate with disease. Combines 4 tools from 2 SCP server(s)."
metadata:
  scpToolId: "200"
  scpCategory: "life_science"
  scpHubUrl: "https://scphub.intern-ai.org.cn/skill/200"
  categoryLabel: "生命科学"
  tags: ["生命科学", "临床遗传学"]
---

# Variant Pathogenicity Assessment

**Discipline**: Clinical Genetics | **Tools Used**: 4 | **Servers**: 2

## Description

Assess variant pathogenicity: Ensembl VEP prediction, ClinVar lookup, variation details, and gene phenotype associations.

## Tools Used

- **`get_vep_hgvs`** from `ensembl-server` (streamable-http) - `https://scp.intern-ai.org.cn/api/v1/mcp/12/Origene-Ensembl`
- **`clinvar_search`** from `search-server` (streamable-http) - `https://scp.intern-ai.org.cn/api/v1/mcp/7/Origene-Search`
- **`get_variation`** from `ensembl-server` (streamable-http) - `https://scp.intern-ai.org.cn/api/v1/mcp/12/Origene-Ensembl`
- **`get_phenotype_gene`** from `ensembl-server` (streamable-http) - `https://scp.intern-ai.org.cn/api/v1/mcp/12/Origene-Ensembl`

## Workflow

1. Predict variant effects with VEP
2. Search ClinVar for clinical significance
3. Get variant details from Ensembl
4. Get gene phenotype associations

## Test Case

### Input
```json
{
    "hgvs": "ENSP00000269305.4:p.Arg175His",
    "variant_id": "rs28934578",
    "gene": "TP53"
}
```

### Expected Steps
1. Predict variant effects with VEP
2. Search ClinVar for clinical significance
3. Get variant details from Ensembl
4. Get gene phenotype associations

## Usage Example

> **Note:** Replace `<YOUR_SCP_HUB_API_KEY>` with your own SCP Hub API Key. You can obtain one from the [SCP Platform](https://scphub.intern-ai.org.cn).

```python
import asyncio
import json
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
from mcp.client.sse import sse_client

SERVERS = {
    "ensembl-server": "https://scp.intern-ai.org.cn/api/v1/mcp/12/Origene-Ensembl",
    "search-server": "https://scp.intern-ai.org.cn/api/v1/mcp/7/Origene-Search"
}

async def connect(url, transport_type):
    transport = streamablehttp_client(url=url, headers={"SCP-HUB-API-KEY": "<YOUR_SCP_HUB_API_KEY>"})
    read, write, _ = await transport.__aenter__()
    ctx = ClientSession(read, write)
    session = await ctx.__aenter__()
    await session.initialize()
    return session, ctx, transport

def parse(result):
    try:
        if hasattr(result, 'content') and result.content:
            c = result.content[0]
            if hasattr(c, 'text'):
                try: return json.loads(c.text)
                except: return c.text
        return str(result)
    except: return str(result)

async def main():
    # Connect to required servers
    sessions = {}
    sessions["ensembl-server"], _, _ = await connect("https://scp.intern-ai.org.cn/api/v1/mcp/12/Origene-Ensembl", "streamable-http")
    sessions["search-server"], _, _ = await connect("https://scp.intern-ai.org.cn/api/v1/mcp/7/Origene-Search", "streamable-http")

    # Execute workflow steps
    # Step 1: Predict variant effects with VEP
    result_1 = await sessions["ensembl-server"].call_tool("get_vep_hgvs", arguments={})
    data_1 = parse(result_1)
    print(f"Step 1 result: {json.dumps(data_1, indent=2, ensure_ascii=False)[:500]}")

    # Step 2: Search ClinVar for clinical significance
    result_2 = await sessions["search-server"].call_tool("clinvar_search", arguments={})
    data_2 = parse(result_2)
    print(f"Step 2 result: {json.dumps(data_2, indent=2, ensure_ascii=False)[:500]}")

    # Step 3: Get variant details from Ensembl
    result_3 = await sessions["ensembl-server"].call_tool("get_variation", arguments={})
    data_3 = parse(result_3)
    print(f"Step 3 result: {json.dumps(data_3, indent=2, ensure_ascii=False)[:500]}")

    # Step 4: Get gene phenotype associations
    result_4 = await sessions["ensembl-server"].call_tool("get_phenotype_gene", arguments={})
    data_4 = parse(result_4)
    print(f"Step 4 result: {json.dumps(data_4, indent=2, ensure_ascii=False)[:500]}")

    # Cleanup
    print("Workflow complete!")

if __name__ == "__main__":
    asyncio.run(main())
```