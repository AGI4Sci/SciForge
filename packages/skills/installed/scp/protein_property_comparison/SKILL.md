---
name: protein_property_comparison
description: "Compare physicochemical properties, structural features, and functional annotations between multiple proteins for evolutionary analysis and functional characterization."
metadata:
  scpToolId: "201"
  scpCategory: "life_science"
  scpHubUrl: "https://scphub.intern-ai.org.cn/skill/protein_property_comparison"
  categoryLabel: "生命科学"
  tags: ["蛋白质比较", "生物信息学", "进化分析", "蛋白性质"]
---

# Protein Property Comparison

## Usage

### 1. MCP Server Definition

```python
import asyncio
import json
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport

class ProteinComparisonClient:
    """Protein Property Comparison MCP Client using FastMCP"""

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

### 2. Protein Property Comparison Workflow

This workflow compares multiple proteins to identify similarities, differences, and evolutionary relationships based on physicochemical and structural properties.

**Workflow Steps:**

1. **Property Calculation** - Compute physicochemical properties
2. **Sequence Alignment** - Perform multiple sequence alignment
3. **Structure Comparison** - Compare 3D structures
4. **Domain Analysis** - Identify conserved domains
5. **Motif Detection** - Find functional motifs
6. **Similarity Scoring** - Generate comparison matrices

**Implementation:**

```python
## Initialize client
HEADERS = {"SCP-HUB-API-KEY": "<your-api-key>"}

client = ProteinComparisonClient(
    "https://scp.intern-ai.org.cn/api/v1/mcp/3/SCPBioinformatics",
    HEADERS
)

if not await client.connect():
    print("connection failed")
    exit()

## Input proteins to compare
proteins = ["P53_HUMAN", "P53_MOUSE", "P53_XENLA"]  # UniProt IDs
print(f"=== Protein Property Comparison ===\n")
print(f"Comparing {len(proteins)} proteins\n")

## Step 1: Calculate properties
print("Step 1: Physicochemical Properties")
result = await client.client.call_tool(
    "CalculateProperties",
    arguments={"proteins": proteins}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 2: Sequence alignment
print("Step 2: Multiple Sequence Alignment")
result = await client.client.call_tool(
    "AlignSequences",
    arguments={"proteins": proteins}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 3: Structure comparison
print("Step 3: 3D Structure Comparison")
result = await client.client.call_tool(
    "CompareStructures",
    arguments={"proteins": proteins}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 4: Domain analysis
print("Step 4: Domain Architecture")
result = await client.client.call_tool(
    "AnalyzeDomains",
    arguments={"proteins": proteins}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 5: Motif detection
print("Step 5: Functional Motif Detection")
result = await client.client.call_tool(
    "DetectMotifs",
    arguments={"alignment": result_data.get("alignment")}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 6: Generate similarity matrix
print("Step 6: Similarity Matrix")
result = await client.client.call_tool(
    "GenerateSimilarityMatrix",
    arguments={"alignment": result_data.get("alignment")}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

await client.disconnect()
```

### Tool Descriptions

**SCPBioinformatics Server (server_id: 3):**
- `CalculateProperties`: Compute physicochemical properties
  - Args: `proteins` (list)
  - Returns: MW, pI, instability, GRAVY, composition

- `AlignSequences`: Perform multiple sequence alignment
  - Args: `proteins` (list)
  - Returns: Alignment, conservation scores

- `CompareStructures`: Compare 3D structures
  - Args: `proteins` (list)
  - Returns: RMSD, TM-score, structure superposition

- `AnalyzeDomains`: Analyze domain architecture
  - Args: `proteins` (list)
  - Returns: Domain IDs, Pfam, architecture

- `DetectMotifs`: Find conserved functional motifs
  - Args: `alignment` (dict)
  - Returns: Motifs, positions, conservation

- `GenerateSimilarityMatrix`: Pairwise similarity scores
  - Args: `alignment` (dict)
  - Returns: Identity/similarity matrices

### Input/Output

**Input:**
- `proteins`: List of UniProt IDs or sequences

**Output:**
- **Physicochemical**: MW, pI, instability, hydrophobicity
- **Alignment**: MSAs with conservation scores
- **Structure**: RMSD, TM-score, superposition
- **Domains**: Pfam domains, architecture
- **Motifs**: Conserved sequence motifs
- **Similarity**: Pairwise identity matrices

### Use Cases

- Ortholog/paralog identification
- Protein family characterization
- Functional site conservation
- Structure-function relationships
- Phylogenetic analysis
- Engineered protein comparison
- Variant impact comparison
- Domain shuffling analysis

### Comparison Metrics

| Property | Range | Interpretation |
|----------|-------|----------------|
| Sequence identity | 0-100% | Evolutionary relationship |
| Similarity | 0-100% | Conservative substitutions |
| RMSD | 0-∞ Å | Structural deviation |
| TM-score | 0-1 | Fold similarity |
| Conservation | 0-1 | Amino acid conservation |

### Amino Acid Similarity Groups

| Group | Properties |
|-------|------------|
| Hydrophobic | A, V, I, L, M, F, Y, W |
| Polar | S, T, N, Q |
| Charged+ | K, R, H |
| Charged- | D, E |
| Special | G, P, C |

## Web Access

Visit: https://scphub.intern-ai.org.cn/skill/protein_property_comparison