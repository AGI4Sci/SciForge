---
name: protein_complex_analysis
description: "Protein Complex Analysis - Analyze protein-protein interactions, predict complex structures, and characterize quaternary structure. Use this skill for PPI network analysis, complex structure prediction, and interaction interface characterization."
metadata:
  scpToolId: "protein_complex_analysis"
  scpCategory: "life_science"
  scpHubUrl: "https://scphub.intern-ai.org.cn/skill/protein_complex_analysis"
  categoryLabel: "生命科学"
  tags: ["生命科学", "蛋白质组学", "蛋白互作", "结构生物学"]
---

# Protein Complex Analysis

## Usage

### 1. MCP Server Definition

```python
import asyncio
import json
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport

class ProteinComplexClient:
    """Protein Complex Analysis MCP Client"""

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
            print("✓ connect success")
            return True
        except Exception as e:
            print(f"✗ connect failure: {e}")
            return False

    async def disconnect(self):
        """Disconnect from server"""
        try:
            if self.client:
                await self.client.__aexit__(None, None, None)
            print("✓ disconnected")
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

### 2. Protein Complex Analysis Workflow

This workflow analyzes protein-protein interactions and predicts complex structures.

**Workflow Steps:**

1. **PPI Network Analysis** - Identify and analyze protein interactions
2. **Complex Structure Prediction** - Predict quaternary structure
3. **Interface Characterization** - Analyze interaction interfaces
4. **Functional Annotation** - Assign biological function to complexes

**Implementation:**

```python
## Initialize client
HEADERS = {"SCP-HUB-API-KEY": "<your-api-key>"}

client = ProteinComplexClient(
    "https://scp.intern-ai.org.cn/api/v1/mcp/17/BioInfo-Tools",
    HEADERS
)

if not await client.connect():
    print("connection failed")
    exit()

## Protein complex analysis
print("=== Protein Complex Analysis ===\n")
complex_data = {
    "proteins": ["P53_HUMAN", "MDM2_HUMAN"],
    "organism": "Homo sapiens",
    "analysis_type": "interaction"
}

result = await client.client.call_tool(
    "analyze_protein_complex",
    arguments=complex_data
)
data = client.parse_result(result)
print(f"Complex Analysis: {json.dumps(data, indent=2, ensure_ascii=False)}")

await client.disconnect()
```

### Tool Descriptions

**BioInfo-Tools Server:**
- `analyze_protein_complex`: Analyze protein-protein interactions
  - Args:
    - `proteins` (list): UniProt IDs or protein names
    - `organism` (str): Species name
    - `analysis_type` (str): Type of analysis
  - Returns:
    - Interaction predictions, confidence scores, interface details

- `predict_complex_structure`: Predict quaternary structure
  - Args:
    - `protein_ids` (list): Component proteins
    - `method` (str): Prediction method
  - Returns:
    - Predicted complex structure coordinates

- `characterize_interface`: Analyze interaction interfaces
  - Args:
    - `pdb_id` (str): Complex structure ID
    - `chain_ids` (list): Interacting chains
  - Returns:
    - Interface residues, interaction types, binding affinity

### Input/Output

**Input:**
- Protein identifiers (UniProt ID, gene name, PDB ID)
- Organism/species
- Analysis type preference

**Output:**
- Protein-protein interaction predictions
- Interaction confidence scores
- Interface residue predictions
- Quaternary structure predictions
- Functional annotations for complexes

### Use Cases

- PPI network construction
- Drug target identification
- Complex structure prediction
- Interface hotspot identification
- Pathway analysis
- Disease mechanism investigation

### Complex Analysis Parameters

- **Interaction Score**: Confidence of predicted interaction (0-1)
- **Interface Area**: Surface area of protein-protein interface
- **Binding Affinity**: Predicted KD or ΔG
- **Hotspot Residues**: Critical interface positions

### Performance Notes

- **Execution time**: 60-300 seconds depending on analysis complexity
- **Timeout recommendation**: Set to at least 600 seconds (10 minutes)
- **Recommended input**: Valid protein identifiers with known structures preferred

### Web Portal Access

Access this tool via SCP Hub: https://scphub.intern-ai.org.cn/skill/protein_complex_analysis

Direct API endpoint: `https://scp.intern-ai.org.cn/api/v1/mcp/17/BioInfo-Tools`