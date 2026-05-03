---
name: cancer_therapy_design
description: "Design personalized cancer therapeutic strategies by integrating multi-omics data including genomics, transcriptomics, and proteomics for target identification, drug selection, and biomarker discovery."
metadata:
  scpToolId: "cancer_therapy_design"
  scpCategory: "life_science"
  scpHubUrl: "https://scphub.intern-ai.org.cn/skill/cancer_therapy_design"
  categoryLabel: "生命科学"
  tags: ["肿瘤治疗", "精准医疗", "多组学", "生物标志物", "靶向治疗"]
---

# Cancer Therapy Design

## Usage

### 1. MCP Server Definition

```python
import asyncio
import json
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport

class CancerTherapyClient:
    """Cancer Therapy Design MCP Client using FastMCP"""

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

### 2. Cancer Therapy Design Workflow

This workflow designs personalized cancer therapeutic strategies by integrating multi-omics data for target identification, drug selection, and biomarker discovery.

**Workflow Steps:**

1. **Patient Profiling** - Integrate genomic, transcriptomic, and proteomic data
2. **Biomarker Discovery** — Identify predictive and prognostic biomarkers
3. **Target Identification** — Prioritize actionable cancer vulnerabilities
4. **Drug Selection** — Match therapies to molecular profiles
5. **Combination Strategy** — Design rational combination regimens
6. **Resistance Prediction** — Anticipate and address resistance mechanisms

**Implementation:**

```python
## Initialize client
HEADERS = {"SCP-HUB-API-KEY": "<your-api-key>"}

client = CancerTherapyClient(
    "https://scp.intern-ai.org.cn/api/v1/mcp/3/SCPBioinformatics",
    HEADERS
)

if not await client.connect():
    print("connection failed")
    exit()

## Patient multi-omics profile
patient_data = {
    "sample_id": "SAMPLE_001",
    "cancer_type": "lung_adenocarcinoma",
    "mutations": ["EGFR:L858R", "TP53:R273H", "CDKN2A:del"],
    "expression_profile": {"EGFR": 12.5, "PDL1": 8.2, "CTLA4": 3.1},
    "proteomics": {"pEGFR": "high", "pAKT": "elevated"}
}
print(f"=== Cancer Therapy Design ===\n")
print(f"Sample: {patient_data['sample_id']}\n")

## Step 1: Multi-omics integration
print("Step 1: Multi-Omics Integration")
result = await client.client.call_tool(
    "IntegrateMultiOmics",
    arguments={"patient_data": patient_data}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 2: Biomarker discovery
print("Step 2: Biomarker Discovery")
result = await client.client.call_tool(
    "DiscoverBiomarkers",
    arguments={"omics_data": result_data.get("integrated")}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 3: Target identification
print("Step 3: Actionable Target Identification")
result = await client.client.call_tool(
    "IdentifyTargets",
    arguments={"biomarkers": result_data.get("biomarkers")}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 4: Drug selection
print("Step 4: Personalized Drug Selection")
result = await client.client.call_tool(
    "SelectDrugs",
    arguments={"targets": result_data.get("targets")}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 5: Combination design
print("Step 5: Combination Therapy Design")
result = await client.client.call_tool(
    "DesignCombination",
    arguments={"drugs": result_data.get("drugs")}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 6: Resistance prediction
print("Step 6: Resistance Mechanism Prediction")
result = await client.client.call_tool(
    "PredictResistance",
    arguments={"therapy": result_data.get("combination")}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

await client.disconnect()
```

### Tool Descriptions

**SCPBioinformatics Server (server_id: 3):**

- `IntegrateMultiOmics`: Integrate genomic, transcriptomic, and proteomic data
  - Args: `patient_data` (dict) — mutations, expression, proteomics
  - Returns: Unified molecular profile

- `DiscoverBiomarkers`: Identify predictive and prognostic biomarkers
  - Args: `omics_data` (dict)
  - Returns: Biomarker list with scores and evidence

- `IdentifyTargets`: Prioritize actionable therapeutic targets
  - Args: `biomarkers` (list)
  - Returns: Ranked target list with confidence scores

- `SelectDrugs`: Match molecular profiles to approved/investigational drugs
  - Args: `targets` (list)
  - Returns: Drug recommendations with evidence

- `DesignCombination`: Design rational combination therapy regimens
  - Args: `drugs` (list)
  - Returns: Combination strategy with synergy scores

- `PredictResistance`: Anticipate resistance mechanisms
  - Args: `therapy` (dict)
  - Returns: Resistance-prone pathways, mitigation strategies

### Input/Output

**Input:**
- `sample_id`: Patient/sample identifier
- `cancer_type`: Tumor type (e.g., lung_adenocarcinoma, breast_carcinoma)
- `mutations`: List of genomic alterations (HGVS notation)
- `expression_profile`: Gene expression values (TPM/FPM)
- `proteomics`: Protein abundance or phosphorylation status

**Output:**
- **Molecular Profile**: Integrated multi-omics summary
- **Biomarkers**: Predictive biomarkers (response) and prognostic markers
- **Targets**: Ranked list of actionable vulnerabilities (0-1 score)
- **Drugs**: Recommended therapies with mechanism of action
- **Combinations**: Rational regimens with synergy predictions
- **Resistance**: Anticipated resistance mechanisms and strategies

### Use Cases

- Precision oncology treatment planning
- Immunotherapy response prediction
- Targeted therapy selection
- Resistance mechanism analysis
- Clinical trial matching
- Drug repurposing for cancer
- Combination regimen optimization
- Tumor heterogeneity assessment

### Cancer Biomarker Categories

| Category | Example | Clinical Use |
|----------|---------|-------------|
| Predictive | PD-L1 expression | Immunotherapy selection |
| Predictive | EGFR mutation | EGFR-TKI response |
| Prognostic | BRCA1/2 mutation | Disease outcome |
| Pharmacodynamic | HER2 amplification | Trastuzumab response |

### Target Priority Scoring

| Score | Priority | Recommendation |
|-------|----------|----------------|
| 0.8–1.0 | High | Pursue as primary target |
| 0.6–0.8 | Medium | Consider in combination |
| 0.4–0.6 | Low | Investigational only |
| <0.4 | None | Not actionable |

## Web Access

Visit: https://scphub.intern-ai.org.cn/skill/cancer_therapy_design
