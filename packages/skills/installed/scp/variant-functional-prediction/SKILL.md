---
name: variant-functional-prediction
description: "Predict the functional impact of genetic variants including missense, nonsense, synonymous, and regulatory variants for clinical variant interpretation and pathogenicity assessment."
metadata:
  scpToolId: "201"
  scpCategory: "life_science"
  scpHubUrl: "https://scphub.intern-ai.org.cn/skill/variant-functional-prediction"
  categoryLabel: "生命科学"
  tags: ["变异功能预测", "临床变异", "ACMG分类", "致病性"]
---

# Variant Functional Prediction

## Usage

### 1. MCP Server Definition

```python
import asyncio
import json
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport

class VariantPredictionClient:
    """Variant Functional Prediction MCP Client using FastMCP"""

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

### 2. Variant Functional Prediction Workflow

This workflow predicts the functional impact of genetic variants across different consequence types for clinical variant interpretation and precision medicine applications.

**Workflow Steps:**

1. **Variant Parsing** - Parse and validate variant notation
2. **Conservation Analysis** - Evaluate evolutionary conservation
3. **Pathogenicity Scoring** - Predict pathogenicity scores
4. **Protein Impact** - Assess protein-level effects
5. **ACMG Classification** - Generate ACMG-based classification
6. **Clinical Reporting** - Generate clinical interpretation report

**Implementation:**

```python
## Initialize client
HEADERS = {"SCP-HUB-API-KEY": "<your-api-key>"}

client = VariantPredictionClient(
    "https://scp.intern-ai.org.cn/api/v1/mcp/3/SCPBioinformatics",
    HEADERS
)

if not await client.connect():
    print("connection failed")
    exit()

## Input variants
variants = [
    "BRCA1:c.68_69delAG (p.Glu23fs)",
    "TP53:c.743G>A (p.Arg248Gln)",
    "EGFR:c.2573T>G (p.Leu858Arg)"
]
print(f"=== Variant Functional Prediction ===\n")
print(f"Analyzing {len(variants)} variants\n")

## Step 1: Parse variants
print("Step 1: Variant Parsing and Validation")
result = await client.client.call_tool(
    "ParseVariants",
    arguments={"variants": variants}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 2: Conservation analysis
print("Step 2: Evolutionary Conservation")
result = await client.client.call_tool(
    "AnalyzeConservation",
    arguments={"variants": result_data.get("parsed")}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 3: Pathogenicity scoring
print("Step 3: Pathogenicity Prediction")
result = await client.client.call_tool(
    "PredictPathogenicity",
    arguments={"variants": result_data.get("variants")}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 4: Protein impact
print("Step 4: Protein-Level Impact Assessment")
result = await client.client.call_tool(
    "AssessProteinImpact",
    arguments={"variants": result_data.get("variants")}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 5: ACMG classification
print("Step 5: ACMG Classification")
result = await client.client.call_tool(
    "ClassifyACMG",
    arguments={"variants": result_data.get("variants")}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 6: Clinical report
print("Step 6: Clinical Interpretation Report")
result = await client.client.call_tool(
    "GenerateReport",
    arguments={"variants": result_data.get("classified")}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

await client.disconnect()
```

### Tool Descriptions

**SCPBioinformatics Server (server_id: 3):**
- `ParseVariants`: Parse and validate variant notation
  - Args: `variants` (list)
  - Returns: Normalized HGVS, consequence type, gene

- `AnalyzeConservation`: Evaluate evolutionary conservation
  - Args: `variants` (list)
  - Returns: PhyloP, PhastCons, Grantham scores

- `PredictPathogenicity`: Score variant pathogenicity
  - Args: `variants` (list)
  - Returns: CADD, SIFT, PolyPhen scores

- `AssessProteinImpact`: Assess protein-level effects
  - Args: `variants` (list)
  - Returns: Stability changes, PPI disruption, localization

- `ClassifyACMG`: ACMG/AMP classification
  - Args: `variants` (list)
  - Returns: Pathogenicity classification, criteria

- `GenerateReport`: Clinical interpretation report
  - Args: `variants` (list)
  - Returns: Summary, evidence, recommendations

### Input/Output

**Input:**
- `variants`: List of variants in HGVS notation
- Format: `Gene:c.DNA (p.Protein)` or `chr:pos:ref:alt`

**Output:**
- **Parsed Variants**: Normalized HGVS notation
- **Conservation**: PhyloP (0-1), Grantham distance
- **Pathogenicity**: CADD (0-99), SIFT (0-1), PolyPhen (0-1)
- **Impact**: Stability ΔΔG, domain location, modification
- **ACMG**: Benign/Likely benign/VUS/Likely pathogenic/Pathogenic
- **Report**: Clinical summary with evidence codes

### Use Cases

- Clinical variant interpretation (ACMG/AMP)
- Rare disease diagnostics
- Cancer somatic variant analysis
- Pharmacogenomic variant annotation
- Newborn screening
- Carrier screening
- Tumor-normal comparison
- Variant database curation

### Pathogenicity Scores

| Tool | Score Range | Interpretation |
|------|-------------|----------------|
| CADD | 0-99 | Higher = more deleterious |
| SIFT | 0-1 | <0.05 = deleterious |
| PolyPhen-2 | 0-1 | >0.908 = probably damaging |
| REVEL | 0-1 | >0.75 = pathogenic |
| MetaRNN | 0-1 | Ensemble prediction |

### ACMG Classification

| Classification | Code | Clinical Action |
|---------------|------|----------------|
| Pathogenic | P | Report, cascade testing |
| Likely pathogenic | LP | Report with caveats |
| Variant of uncertain significance | VUS | Follow-up, segregation |
| Likely benign | LB | Typically not reported |
| Benign | B | Do not report |

### ACMG Evidence Codes

| Code | Evidence Type |
|------|--------------|
| PVS1 | Null variant in LOF gene |
| PS1 | Same amino acid change |
| PS2 | De novo (confirmed) |
| PM1 | Mutational hotspot |
| PM2 | Absent from controls |
| PP1 | Co-segregation |
| PP2 | Missense in GOF gene |
| PP3 | Computational evidence |
| BA1 | >5% in population |
| BS1 | Population frequency high |
| BP1 | Missense in non-critical domain |
| BP4 | Computational benign |

## Web Access

Visit: https://scphub.intern-ai.org.cn/skill/variant-functional-prediction