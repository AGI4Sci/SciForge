---
name: biomedical-web-search
description: "Search biomedical literature, databases, and clinical resources across PubMed, UniProt, DrugBank, and other life science repositories. Supports keyword search, MeSH terms, and filtered queries for genes, proteins, diseases, and compounds."
metadata:
  scpToolId: "biomedical-web-search"
  scpCategory: "life_science"
  scpHubUrl: "https://scphub.intern-ai.org.cn/skill/biomedical-web-search"
  categoryLabel: "生命科学"
  tags: ["生命科学", "文献检索", "生物医学"]
---

# Biomedical Web Search

## Usage

### 1. MCP Server Definition

```python
import asyncio
import json
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport

class BiomedicalSearchClient:
    """Biomedical Web Search MCP Client using FastMCP"""

    def __init__(self, server_url: str, headers: dict = None):
        self.server_url = server_url
        self.headers = headers or {}
        self.client = None

    async def connect(self):
        """Establish connection and initialize session"""
        print(f"Connecting to: {self.server_url}")
        try:
            transport = StreamableHttpTransport(
                url=self.server_url,
                headers=self.headers
            )
            self.client = Client(transport)
            await self.client.__aenter__()
            print(f"✓ connect success")
            return True
        except Exception as e:
            print(f"✗ connect failure: {e}")
            import traceback
            traceback.print_exc()
            return False

    async def disconnect(self):
        """Disconnect from server"""
        try:
            if self.client:
                await self.client.__aexit__(None, None, None)
            print("✓ already disconnect")
        except Exception as e:
            print(f"✗ disconnect error: {e}")

    def parse_result(self, result):
        """Parse MCP tool call result"""
        try:
            if hasattr(result, 'content') and result.content:
                content = result.content[0]
                if hasattr(content, 'text'):
                    try:
                        return json.loads(content.text)
                    except:
                        return content.text
            return str(result)
        except Exception as e:
            return {"error": f"parse error: {e}", "raw": str(result)}
```

### 2. Biomedical Search Workflow

Searches biomedical literature and databases across multiple life science resources.

**Workflow Steps:**

1. **Construct Query** - Build search query with optional domain filter
2. **Execute Search** - Call biomedical web search with domain targeting
3. **Parse Results** - Extract documents, metadata, and relevance scores

**Implementation:**

```python
import asyncio

async def main():
    HEADERS = {"SCP-HUB-API-KEY": "<your-api-key>"}

    client = BiomedicalSearchClient(
        "https://scp.intern-ai.org.cn/api/v1/mcp/<server-id>/BiomedicalSearch",
        HEADERS
    )

    if not await client.connect():
        print("connection failed")
        return

    # Input: biomedical search query
    query = "TP53 mutation cancer drug response"
    domain = "pubmed"
    print(f"=== Biomedical Search: {query} ===\n")

    result = await client.client.call_tool(
        "biomedical-web-search_search",
        arguments={
            "query": query,
            "domain": domain,
            "filters": {"species": "Homo sapiens", "date_range": "5y"}
        }
    )
    result_data = client.parse_result(result)
    print(f"Result: {result_data}\n")

    await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
```

### Tool Description

**Biomedical Web Search Server:**
- `biomedical-web-search_search`: Perform biomedical literature and database search
  - Args:
    - `query` (str) - Search query string (supports keywords, MeSH terms)
    - `domain` (str, optional) - Target database: pubmed, uniprot, drugbank, clinicaltrials
    - `filters` (object, optional) - Filtering options: species, date_range, document_type
  - Returns: List of matching documents with titles, abstracts, metadata, and relevance scores

### Input/Output

**Input:**
- `query`: Biomedical search query (e.g., "BRCA1 breast cancer", "EGFR inhibitor lung cancer")
- `domain`: Optional target database (pubmed, uniprot, drugbank, clinicaltrials, all)
- `filters`: Optional filters
  - `species`: Species filter (e.g., "Homo sapiens", "Mus musculus")
  - `date_range`: Date range filter (e.g., "1y", "5y", "10y")
  - `document_type`: Document type (article, review, clinical_trial, etc.)

**Output:**
- **Document List**: Matching records with titles, abstracts, and source attribution
- **Source Database**: Database of origin (PubMed, UniProt, DrugBank, ClinicalTrials.gov)
- **Relevance Scores**: Query-document relevance
- **Citations**: Citation counts and references
- **Metadata**: Authors, publication dates, journal names

### Supported Databases

| Database | Coverage | Best For |
|----------|----------|----------|
| PubMed | ~35M abstracts | Literature, clinical studies |
| UniProt | Protein sequences & annotations | Protein function, pathways |
| DrugBank | Drug targets, interactions | Drug mechanism, compounds |
| ClinicalTrials.gov | Clinical trial registry | Ongoing trials, recruitment |
| GeneCards | Gene-disease associations | Gene-centric queries |
| OMIM | Mendelian disorders | Genetic disease phenotypes |

### Use Cases

- Literature review for drug discovery
- Target validation research
- Biomarker identification
- Clinical evidence synthesis
- Competitive intelligence on drug pipelines
- Gene/protein function discovery
- Disease mechanism investigation

### Local Description

**网页端调用**: https://scphub.intern-ai.org.cn/skill/biomedical-web-search

**下载说明**: 本地为 SKILL.md 资源定义，工具执行由 SCP Hub 远程服务提供。需配置 `openteam.json → integrations.scpHub.apiKey`。

### Mock Invoke (offline fallback)

When SCP Hub API key is not configured, `mockInvokeTool` in `server/api/scp-tools/invoke.ts` will return a placeholder response. Real computation requires a valid API key and network access to SCP Hub.