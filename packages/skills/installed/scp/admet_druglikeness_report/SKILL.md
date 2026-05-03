---
name: admet_druglikeness_report
description: "ADMET drug-likeness assessment tool evaluating Absorption, Distribution, Metabolism, Excretion, and Toxicity properties for compound optimization and drug discovery."
metadata:
  scpToolId: "201"
  scpCategory: "chemistry"
  scpHubUrl: "https://scphub.intern-ai.org.cn/skill/admet_druglikeness_report"
  categoryLabel: "化学"
  tags: ["药物化学", "ADMET", "类药性", "毒理学"]
---

# ADMET Drug-Likeness Report

## Usage

### 1. MCP Server Definition

```python
import asyncio
import json
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport

class AdmetClient:
    """ADMET Drug-Likeness Assessment MCP Client using FastMCP"""

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

### 2. ADMET Drug-Likeness Assessment Workflow

This workflow evaluates the drug-likeness of chemical compounds through comprehensive ADMET analysis, essential for lead compound optimization in drug discovery.

**Workflow Steps:**

1. **Calculate Lipinski Parameters** - MW, LogP, HBD, HBA
2. **Evaluate Blood-Brain Barrier Permeability** - BBB penetration potential
3. **Assess CYP450 Interaction** - Cytochrome P450 inhibition/induction
4. **Predict hERG Channel Blockade** - Cardiotoxicity risk
5. **Generate Drug-Likeness Score** - Overall ADMET compliance

**Implementation:**

```python
## Initialize client
HEADERS = {"SCP-HUB-API-KEY": "<your-api-key>"}

client = AdmetClient(
    "https://scp.intern-ai.org.cn/api/v1/mcp/31/SciToolAgent-Chem",
    HEADERS
)

if not await client.connect():
    print("connection failed")
    exit()

## Input: SMILES string to assess
smiles = "CC(=O)OC1=CC=CC=C1C(=O)O"  # Aspirin
print(f"=== ADMET Drug-Likeness Assessment ===\n")
print(f"Input SMILES: {smiles}\n")

## Step 1: Lipinski's Rule of Five
print("Step 1: Lipinski Parameters")
result = await client.client.call_tool(
    "GetLipinskiRO5",
    arguments={"smiles": smiles}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 2: Blood-Brain Barrier Permeability
print("Step 2: BBB Permeability Prediction")
result = await client.client.call_tool(
    "PredictBBB",
    arguments={"smiles": smiles}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 3: CYP450 Interaction Prediction
print("Step 3: CYP450 Interaction")
result = await client.client.call_tool(
    "PredictCYP450",
    arguments={"smiles": smiles}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 4: hERG Cardiotoxicity Risk
print("Step 4: hERG Blockade Risk")
result = await client.client.call_tool(
    "PredicthERG",
    arguments={"smiles": smiles}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 5: Overall Drug-Likeness Score
print("Step 5: Drug-Likeness Score")
result = await client.client.call_tool(
    "GetDrugLikenessScore",
    arguments={"smiles": smiles}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

await client.disconnect()
```

### Tool Descriptions

**SciToolAgent-Chem Server (server_id: 31):**
- `GetLipinskiRO5`: Lipinski's Rule of Five evaluation
  - Args: `smiles` (str)
  - Returns: MW, LogP, HBD, HBA, pass/fail status

- `PredictBBB`: Blood-Brain Barrier permeability prediction
  - Args: `smiles` (str)
  - Returns: BBB score, penetration classification

- `PredictCYP450`: Cytochrome P450 interaction prediction
  - Args: `smiles` (str)
  - Returns: CYP1A2, CYP2C9, CYP2C19, CYP2D6, CYP3A4 predictions

- `PredicthERG`: hERG potassium channel blockade risk
  - Args: `smiles` (str)
  - Returns: Cardiotoxicity risk classification

- `GetDrugLikenessScore`: Overall drug-likeness evaluation
  - Args: `smiles` (str)
  - Returns: Composite ADMET score

### Input/Output

**Input:**
- `smiles`: Molecule in SMILES format

**Output:**
- **Lipinski Parameters**: MW, LogP, HBD, HBA with pass/fail
- **BBB Permeability**: Blood-brain barrier penetration score
- **CYP450 Profile**: Interaction predictions for major isoforms
- **hERG Risk**: Cardiotoxicity screening result
- **Drug-Likeness Score**: 0-100 composite score

### Use Cases

- Lead compound optimization
- Early drug discovery screening
- Pharmacokinetics prediction
- Toxicity risk assessment
- Drug-drug interaction prediction
- Bioavailability optimization
- CNS drug development
- Clinical candidate selection

### Lipinski's Rule of Five

| Parameter | Threshold | Rationale |
|-----------|-----------|-----------|
| MW | ≤ 500 Da | Oral absorption limit |
| LogP | ≤ 5 | Cell membrane permeability |
| HBD | ≤ 5 | Hydrogen bond donors |
| HBA | ≤ 10 | Hydrogen bond acceptors |

### ADMET Key Endpoints

- **Absorption**: Caco-2, MDCK, PAMPA
- **Distribution**: BBB penetration, plasma protein binding
- **Metabolism**: CYP450 inhibition/induction
- **Excretion**: Half-life, clearance
- **Toxicity**: hERG, Ames test, hepatotoxicity