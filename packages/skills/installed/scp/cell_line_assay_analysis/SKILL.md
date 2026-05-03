---
name: cell_line_assay_analysis
description: "Cell Line Assay Analysis - Analyze cell-based assay data including viability, cytotoxicity, proliferation, and apoptosis assays. Use this skill for drug screening, IC50 determination, and cell viability assessment across different cell lines."
metadata:
  scpToolId: "cell_line_assay_analysis"
  scpCategory: "life_science"
  scpHubUrl: "https://scphub.intern-ai.org.cn/skill/cell_line_assay_analysis"
  categoryLabel: "生命科学"
  tags: ["生命科学", "细胞实验", "药物筛选"]
---

# Cell Line Assay Analysis

## Usage

### 1. MCP Server Definition

```python
import asyncio
import json
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport

class CellAssayClient:
    """Cell Line Assay Analysis MCP Client"""

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

### 2. Cell Line Assay Analysis Workflow

This workflow analyzes cell-based assay data for drug screening and cytotoxicity assessment.

**Workflow Steps:**

1. **Cell Viability Analysis** - Calculate cell viability percentages
2. **IC50 Determination** - Fit dose-response curves and determine IC50 values
3. **Cytotoxicity Assessment** - Evaluate compound toxicity profiles
4. **Apoptosis/Necrosis Analysis** - Detect cell death mechanisms

**Implementation:**

```python
## Initialize client
HEADERS = {"SCP-HUB-API-KEY": "<your-api-key>"}

client = CellAssayClient(
    "https://scp.intern-ai.org.cn/api/v1/mcp/17/BioInfo-Tools",
    HEADERS
)

if not await client.connect():
    print("connection failed")
    exit()

## Cell viability analysis
print("=== Cell Line Assay Analysis ===\n")
viability_data = {
    "compound": "Drug_A",
    "cell_line": "HeLa",
    "concentrations": [0.001, 0.01, 0.1, 1.0, 10.0],
    "viability_percentages": [98.5, 95.2, 78.3, 45.1, 12.3]
}

result = await client.client.call_tool(
    "analyze_cell_viability",
    arguments=viability_data
)
data = client.parse_result(result)
print(f"Cell Viability Results: {json.dumps(data, indent=2, ensure_ascii=False)}")

await client.disconnect()
```

### Tool Descriptions

**BioInfo-Tools Server:**
- `analyze_cell_viability`: Calculate cell viability from assay data
  - Args:
    - `compound` (str): Compound name/identifier
    - `cell_line` (str): Cell line name
    - `concentrations` (list): Drug concentrations
    - `viability_percentages` (list): Corresponding viability values
  - Returns:
    - IC50, EC50, viability curves, and statistical metrics

- `calculate_ic50`: Determine IC50 from dose-response data
  - Args:
    - `concentrations` (list): Concentration values
    - `responses` (list): Response/effect values
  - Returns:
    - IC50 value with confidence interval

- `assess_cytotoxicity`: Evaluate compound cytotoxicity
  - Args:
    - `cell_line` (str): Target cell line
    - `compound_data` (dict): Compound screening data
  - Returns:
    - Cytotoxicity profile and selectivity index

### Input/Output

**Input:**
- Cell line identifier
- Compound name/identifier
- Concentration-response data
- Experimental conditions (time, temperature, etc.)

**Output:**
- Cell viability percentages
- IC50/EC50 values
- Dose-response curves
- Selectivity indices
- Cytotoxicity classification (low/medium/high)

### Use Cases

- Drug cytotoxicity screening
- Cancer drug discovery
- Compound potency comparison
- Dose-optimization studies
- Apoptosis pathway analysis
- Drug combination studies

### Performance Notes

- **Execution time**: 30-120 seconds depending on dataset size
- **Timeout recommendation**: Set to at least 300 seconds (5 minutes)
- **Recommended input**: 5+ concentration points for reliable IC50 fitting

### Web Portal Access

Access this tool via SCP Hub: https://scphub.intern-ai.org.cn/skill/cell_line_assay_analysis

Direct API endpoint: `https://scp.intern-ai.org.cn/api/v1/mcp/17/BioInfo-Tools`