---
name: binding_site_characterization
description: "Characterize protein binding sites including pocket detection, shape analysis, pharmacological features, and druggability assessment for structure-based drug design."
metadata:
  scpToolId: "201"
  scpCategory: "chemistry"
  scpHubUrl: "https://scphub.intern-ai.org.cn/skill/binding_site_characterization"
  categoryLabel: "化学"
  tags: ["药物设计", "分子对接", "结合位点", "结构生物学"]
---

# Binding Site Characterization

## Usage

### 1. MCP Server Definition

```python
import asyncio
import json
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport

class BindingSiteClient:
    """Binding Site Characterization MCP Client using FastMCP"""

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

### 2. Binding Site Characterization Workflow

This workflow identifies and characterizes binding sites on protein structures, essential for structure-based drug design and virtual screening.

**Workflow Steps:**

1. **Pocket Detection** - Identify potential binding cavities
2. **Shape Analysis** - Analyze pocket volume and geometry
3. **Pharmacophore Mapping** - Identify key interaction features
4. **Druggability Assessment** - Evaluate binding site tractability
5. **Hotspot Analysis** - Map energetically important regions

**Implementation:**

```python
## Initialize client
HEADERS = {"SCP-HUB-API-KEY": "<your-api-key>"}

client = BindingSiteClient(
    "https://scp.intern-ai.org.cn/api/v1/mcp/31/SciToolAgent-Chem",
    HEADERS
)

if not await client.connect():
    print("connection failed")
    exit()

## Input: PDB structure file or protein identifier
protein_id = "1ABC"  # Example PDB ID
print(f"=== Binding Site Characterization ===\n")
print(f"Input Protein: {protein_id}\n")

## Step 1: Detect binding pockets
print("Step 1: Pocket Detection")
result = await client.client.call_tool(
    "DetectPockets",
    arguments={"protein_id": protein_id}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 2: Analyze pocket shape
print("Step 2: Shape Analysis")
result = await client.client.call_tool(
    "AnalyzePocketShape",
    arguments={"pocket_id": result_data.get("pocket_id")}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 3: Pharmacophore mapping
print("Step 3: Pharmacophore Features")
result = await client.client.call_tool(
    "MapPharmacophore",
    arguments={"pocket_id": result_data.get("pocket_id")}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 4: Druggability score
print("Step 4: Druggability Assessment")
result = await client.client.call_tool(
    "AssessDruggability",
    arguments={"pocket_id": result_data.get("pocket_id")}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 5: Hotspot mapping
print("Step 5: Energetic Hotspots")
result = await client.client.call_tool(
    "MapHotspots",
    arguments={"pocket_id": result_data.get("pocket_id")}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

await client.disconnect()
```

### Tool Descriptions

**SciToolAgent-Chem Server (server_id: 31):**
- `DetectPockets`: Identify potential binding cavities in protein structure
  - Args: `protein_id` (str) - PDB ID or uploaded structure
  - Returns: List of detected pockets with coordinates

- `AnalyzePocketShape`: Characterize pocket geometry and volume
  - Args: `pocket_id` (str)
  - Returns: Volume, surface area, depth, shape descriptors

- `MapPharmacophore`: Identify key pharmacophoric features
  - Args: `pocket_id` (str)
  - Returns: H-bond donors/acceptors, hydrophobic regions, charged sites

- `AssessDruggability`: Evaluate binding site tractability
  - Args: `pocket_id` (str)
  - Returns: Druggability score (0-1), classification

- `MapHotspots`: Identify energetically favorable regions
  - Args: `pocket_id` (str)
  - Returns: Hotspot map with interaction energies

### Input/Output

**Input:**
- `protein_id`: PDB ID or structure file
- `pocket_id`: Binding pocket identifier (from DetectPockets)

**Output:**
- **Pocket List**: Coordinates and scores for detected cavities
- **Shape Metrics**: Volume (Å³), surface area, depth, radius
- **Pharmacophore**: HBD/HBA counts, hydrophobicity, charges
- **Druggability Score**: 0-1 scale (higher = more druggable)
- **Hotspot Map**: 3D grid of interaction energies

### Use Cases

- Structure-based drug design
- Virtual screening target selection
- Lead optimization
- Selectivity assessment
- Protein-protein interaction interfaces
- Allosteric site identification
- Fragment-based drug discovery
- covalent warhead placement

### Druggability Classification

| Score Range | Classification | Interpretation |
|-------------|-----------------|----------------|
| 0.8 - 1.0 | Excellent | Highly tractable for small molecules |
| 0.6 - 0.8 | Good | Suitable for drug-like compounds |
| 0.4 - 0.6 | Moderate | May require fragment screening |
| 0.0 - 0.4 | Poor | Challenging target, consider PPI |

### Pocket Properties

- **Volume**: Typical drug-binding pockets 200-1500 Å³
- **Depth**: Deeper pockets often more druggable
- **Hydrophobicity**: Hydrophobic pockets favor lipophilic ligands
- **Flexibility**: Rigid pockets easier to target

## Web Access

Visit: https://scphub.intern-ai.org.cn/skill/binding_site_characterization