---
name: protein_classification_analysis
description: "Protein Classification Analysis - Classify proteins into families, structural classes, and functional categories using machine learning models. Use this skill for tasks involving InterPro domain mapping, enzyme classification (EC numbers), GO term annotation, and protein family assignment. Supports batch analysis of protein sequences and identifiers."
metadata:
  scpToolId: "protein_classification_analysis"
  scpCategory: "life_science"
  scpHubUrl: "https://scphub.intern-ai.org.cn/skill/protein_classification_analysis"
  categoryLabel: "生命科学"
  tags: ["生命科学", "蛋白质分析", "功能注释"]
---

# Protein Classification Analysis

## Usage

### Web Portal Access

Access this tool via SCP Hub: https://scphub.intern-ai.org.cn/skill/protein_classification_analysis

### MCP Server Definition

```python
import json
from mcp.client.streamable_http import streamablehttp_client
from mcp import ClientSession

class ProteinClassificationClient:
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

1. **Protein Input** — Submit UniProt IDs, gene names, or FASTA sequences
2. **Domain Analysis** — Map InterPro/Pfam domains and architectural features
3. **Enzyme Classification** — Assign EC numbers for metabolic enzyme proteins
4. **GO Annotation** — Retrieve Gene Ontology terms (Molecular Function, Cellular Component, Biological Process)
5. **Family Assignment** — Classify into protein families (Pfam, SCOP, CATH)
6. **Batch Processing** — Handle multiple proteins in a single analysis run

### Input/Output

**Input:**
- Protein identifiers (UniProt AC, UniProt ID, gene name)
- Protein sequences in FASTA format
- Optional: taxonomy filter, domain family list

**Output:**
- Protein family classifications (Pfam, CDD, InterPro)
- Enzyme commission (EC) numbers
- GO term annotations with evidence codes
- Confidence scores for each classification

### Use Cases

- Annotate novel protein sequences with functional categories
- Classify enzyme proteins by metabolic pathway role
- Build protein family datasets for machine learning training
- Support structural genomics target selection workflows
- Cross-reference protein classifications with disease databases