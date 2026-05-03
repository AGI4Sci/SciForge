---
name: protein-properties-calculation
description: "Calculate physicochemical properties of protein sequences including molecular weight, isoelectric point, instability index, and amino acid composition."
metadata:
  scpToolId: "1"
  scpCategory: "life_science"
  scpHubUrl: "https://scphub.intern-ai.org.cn/skill/protein-properties-calculation"
  categoryLabel: "生命科学"
  tags: ["生物信息学", "蛋白质"]
---

# Protein Properties Calculation

## Usage

### 1. MCP Server Definition

```python
import asyncio
import json
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport

class ProteinToolsClient:
    """Protein Tools MCP Client using FastMCP"""

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

### 2. Protein Properties Calculation Workflow

This workflow calculates fundamental physicochemical properties of protein sequences, useful for protein characterization, bioinformatics analysis, and structural biology research.

**Workflow Steps:**

1. **Calculate Molecular Weight** - Compute the molecular weight of the protein
2. **Calculate Isoelectric Point** - Determine the pI where net charge is zero
3. **Calculate Instability Index** - Predict protein stability in vitro
4. **Calculate Aliphatic Index** - Measure thermal stability
5. **Calculate GRAVY** - Grand average of hydropathicity
6. **Get Amino Acid Composition** - Count each amino acid residue

**Implementation:**

```python
## Initialize client
HEADERS = {"SCP-HUB-API-KEY": "<your-api-key>"}

client = ProteinToolsClient(
    "https://scp.intern-ai.org.cn/api/v1/mcp/1/VenusFactory",
    HEADERS
)

if not await client.connect():
    print("connection failed")
    exit()

## Input: Protein sequence to analyze
sequence = "MKFLILLFNILCLFPVLAADNH"  # Example peptide
print(f"=== Protein Properties for sequence ({len(sequence)} aa) ===\n")

## Step 1: Calculate molecular weight
print("Step 1: Molecular Weight")
result = await client.client.call_tool(
    "CalculateMolecularWeight",
    arguments={"sequence": sequence}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 2: Calculate isoelectric point
print("Step 2: Isoelectric Point (pI)")
result = await client.client.call_tool(
    "CalculateIsoelectricPoint",
    arguments={"sequence": sequence}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 3: Calculate instability index
print("Step 3: Instability Index")
result = await client.client.call_tool(
    "CalculateInstabilityIndex",
    arguments={"sequence": sequence}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 4: Calculate aliphatic index
print("Step 4: Aliphatic Index")
result = await client.client.call_tool(
    "CalculateAliphaticIndex",
    arguments={"sequence": sequence}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 5: Calculate GRAVY
print("Step 5: GRAVY (Grand Average of Hydropathicity)")
result = await client.client.call_tool(
    "CalculateGRAVY",
    arguments={"sequence": sequence}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 6: Get amino acid composition
print("Step 6: Amino Acid Composition")
result = await client.client.call_tool(
    "GetAminoAcidComposition",
    arguments={"sequence": sequence}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

await client.disconnect()
```

### Tool Descriptions

**VenusFactory Server (server_id: 1):**
- `CalculateMolecularWeight`: Calculate the molecular weight of a protein sequence
  - Args: `sequence` (str) - Amino acid sequence
  - Returns: Molecular weight in Daltons (Da)

- `CalculateIsoelectricPoint`: Calculate the theoretical isoelectric point (pI)
  - Args: `sequence` (str) - Amino acid sequence
  - Returns: pI value (pH at which net charge is zero)

- `CalculateInstabilityIndex`: Predict protein stability (in vitro)
  - Args: `sequence` (str) - Amino acid sequence
  - Returns: Instability index (II > 40 indicates unstable protein)

- `CalculateAliphaticIndex`: Calculate aliphatic index (thermal stability indicator)
  - Args: `sequence` (str) - Amino acid sequence
  - Returns: Aliphatic index value

- `CalculateGRAVY`: Calculate grand average of hydropathicity
  - Args: `sequence` (str) - Amino acid sequence
  - Returns: GRAVY score (positive = hydrophobic, negative = hydrophilic)

- `GetAminoAcidComposition`: Count amino acid residues
  - Args: `sequence` (str) - Amino acid sequence
  - Returns: Dictionary of amino acid counts/percentages

### Input/Output

**Input:**
- `sequence`: Protein sequence in single-letter amino acid code (e.g., "MKFLILLFNILCLFPVLAADNH")

**Output:**
- **Molecular Weight**: Mass in Daltons (Da), typically ranges from 5,000 to 200,000 Da
- **Isoelectric Point (pI)**: pH where protein has net zero charge, useful for 2D electrophoresis
- **Instability Index (II)**: Predicts in vitro stability; II < 40 = stable, II > 40 = unstable
- **Aliphatic Index**: Measures thermal stability; higher values indicate greater thermostability
- **GRAVY**: Hydropathicity index; positive = hydrophobic, negative = hydrophilic
- **Amino Acid Composition**: Percentage or count of each of the 20 standard amino acids

### Use Cases

- Recombinant protein expression planning
- Protein purification strategy (pI-based)
- Protein stability assessment
- Thermostable protein engineering
- Structural biology preparation
- Protein-protein interaction studies
- Proteomics data analysis
- Enzyme characterization

### Interpretation Guidelines

**Molecular Weight:**
- Typical range: 5-200 kDa for soluble proteins
- Larger proteins may require special handling

**Isoelectric Point (pI):**
- pI < 7: acidic protein
- pI = 7: neutral protein
- pI > 7: basic protein
- Use pI to predict migration in 2D-PAGE

**Instability Index:**
- II < 40: stable protein (in vitro)
- II > 40: unstable protein (in vitro)

**Aliphatic Index:**
- Higher values indicate greater thermostability
- Typical range: 0-150
- Proteins from thermophiles often have high aliphatic indices

**GRAVY:**
- Positive values: hydrophobic proteins (membrane proteins tend to have higher GRAVY)
- Negative values: hydrophilic proteins (soluble proteins tend to have lower GRAVY)

### Standard Amino Acids

The 20 standard amino acids used in protein sequences:
```
A (Ala), R (Arg), N (Asn), D (Asp), C (Cys),
E (Glu), Q (Gln), G (Gly), H (His), I (Ile),
L (Leu), K (Lys), M (Met), F (Phe), P (Pro),
S (Ser), T (Thr), W (Trp), Y (Tyr), V (Val)
```