---
name: gene_disease_association
description: "Gene-Disease Association - Explore and analyze associations between genes and diseases. Use this skill for tasks involving disease gene mapping, phenotype-gene linking, GWAS target prioritization, and pathogenicity screening. Combines multiple SCP servers for genomics and clinical genetics analysis."
metadata:
  scpToolId: "gene_disease_association"
  scpCategory: "life_science"
  scpHubUrl: "https://scphub.intern-ai.org.cn/skill/gene_disease_association"
  categoryLabel: "生命科学"
  tags: ["生命科学", "基因组学", "疾病关联"]
---

# Gene-Disease Association

## Usage

### Web Portal Access

Access this tool via SCP Hub: https://scphub.intern-ai.org.cn/skill/gene_disease_association

### MCP Server Definition

```python
import json
from mcp.client.streamable_http import streamablehttp_client
from mcp import ClientSession

class GeneDiseaseClient:
    def __init__(self, server_url: str):
        self.server_url = server_url
        self.session = None

    async def connect(self):
        try:
            self.transport = streamablehttp_client(
                url=self.server_url,
                headers={"SCP-HUB-API-KEY": "<YOUR_SCP_HUB_API_KEY>"}
            )
            self.read, self.write, self.get_session_id = await self.transport.__aenter__()
            self.session_ctx = ClientSession(self.read, self.write)
            self.session = await self.session_ctx.__aenter__()
            await self.session.initialize()
            return True
        except Exception as e:
            print(f"Connection failed: {e}")
            return False

    async def disconnect(self):
        if self.session:
            await self.session_ctx.__aexit__(None, None, None)
        if hasattr(self, 'transport'):
            await self.transport.__aexit__(None, None, None)

    def parse_result(self, result):
        try:
            if hasattr(result, 'content') and result.content:
                content = result.content[0]
                if hasattr(content, 'text'):
                    return json.loads(content.text)
            return str(result)
        except:
            return str(result)
```

### Workflow Steps

1. **Gene Query** — Input gene symbol, Ensembl ID, or gene list
2. **Disease Association** — Retrieve associated diseases from curated databases
3. **Evidence Mapping** — Collect supporting literature and pathway evidence
4. **GWAS Cross-reference** — Validate with population-level GWAS data
5. **Pathogenicity Assessment** — Score variant impact on gene-disease links

### Input/Output

**Input:**
- Gene identifiers (HGNC symbols, Ensembl IDs, Entrez IDs)
- Disease terms (OMIM codes, MONDO IDs, DO terms)
- Optional: phenotype terms (HPO IDs)

**Output:**
- Gene-disease association scores and confidence levels
- Supporting evidence from literature and databases
- Pathway and functional annotation summaries
- GWAS-derived population statistics

### Use Cases

- Prioritize candidate genes from GWAS summary statistics
- Map disease phenotypes to underlying genetic causes
- Build disease-gene knowledge graphs for drug repurposing
- Support clinical genetics variant interpretation pipelines