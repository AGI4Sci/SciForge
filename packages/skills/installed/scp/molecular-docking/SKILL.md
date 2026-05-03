---
name: molecular-docking
description: "Molecular docking tool for predicting binding modes and affinity between small molecules and protein targets."
metadata:
  scpToolId: "32"
  scpCategory: "chemistry"
  scpHubUrl: "https://scphub.intern-ai.org.cn/skill/molecular-docking"
  categoryLabel: "化学"
  tags: ["化学", "分子对接", "药物发现"]
---

# Molecular Docking

## Usage

### 1. MCP Server Definition

```python
import asyncio
import json
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport

class MolecularDockingClient:
    """Molecular Docking MCP Client using FastMCP"""

    def __init__(self, server_url: str, headers: dict = None):
        self.server_url = server_url
        self.headers = headers or {}
        self.client = None

    async def connect(self):
        """Establish connection and initialize session"""
        print(f"Connecting to: {self.server_url}")
        try:
            transport = StreamableHttpTransport(url=self.server_url, headers=self.headers)
            self.client = Client(transport)
            await self.client.__aenter__()
            print(f"✓ connect success")
            return True
        except Exception as e:
            print(f"✗ connect failure: {e}")
            import traceback; traceback.print_exc()
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
                    try: return json.loads(content.text)
                    except: return content.text
            return str(result)
        except Exception as e:
            return {"error": f"parse error: {e}", "raw": str(result)}
```

### 2. Molecular Docking Workflow

Predict binding modes and affinities between ligands and protein targets.

**Implementation:**

```python
HEADERS = {"SCP-HUB-API-KEY": "<your-api-key>"}
client = MolecularDockingClient(
    "https://scp.intern-ai.org.cn/api/v1/mcp/31/SciToolAgent-Chem",
    HEADERS
)
if not await client.connect():
    print("connection failed"); exit()

ligand_smiles = "CC(=O)Oc1ccccc1C(=O)O"
protein_pdb = "1ABC"
binding_site = {"center_x": 0.0, "center_y": 0.0, "center_z": 0.0}

## Step 1: Prepare ligand
result = await client.client.call_tool("PrepareLigand", arguments={"smiles": ligand_smiles})
print(client.parse_result(result))

## Step 2: Prepare protein
result = await client.client.call_tool("PrepareProtein", arguments={"pdb_id": protein_pdb})
print(client.parse_result(result))

## Step 3: Run docking
result = await client.client.call_tool("DockMolecule", arguments={
    "ligand": ligand_smiles, "protein": protein_pdb,
    "binding_site": binding_site, "num_poses": 10, "scoring_function": "vina"
})
print(client.parse_result(result))

await client.disconnect()
```

### Tool Descriptions

**SciToolAgent-Chem Server (server_id: 31):**
- `PrepareLigand`: Prepare ligand from SMILES
  - Args: `smiles` (str)
  - Returns: 3D ligand structure
- `PrepareProtein`: Process protein PDB
  - Args: `pdb_id` (str)
  - Returns: Processed protein
- `DockMolecule`: Perform molecular docking
  - Args: `ligand`, `protein`, `binding_site`, `num_poses`, `scoring_function`
  - Returns: Binding poses with scores

### Input/Output

**Input:** SMILES ligand, PDB protein ID, binding site coordinates
**Output:** Binding affinity (kcal/mol), docking scores, binding poses

### Use Cases
- Structure-based drug design
- Virtual screening
- Lead optimization
- Binding affinity prediction