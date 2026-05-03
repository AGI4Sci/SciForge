---
name: protein_quality_assessment
description: "Protein Quality Assessment - Evaluate protein structure quality, stability, and reliability using various quality metrics and validation scores. Use this skill for quality control of modeled protein structures, assessment of X-ray/NMR structures, and confidence scoring for predictions."
metadata:
  scpToolId: "110"
  scpCategory: "life_science"
  scpHubUrl: "https://scphub.intern-ai.org.cn/skill/protein_quality_assessment"
  categoryLabel: "生命科学"
  tags: ["生命科学", "蛋白质质量", "结构验证", "质量控制"]
---

# Protein Quality Assessment

## Usage

### 1. MCP Server Definition

```python
import json
from mcp.client.streamable_http import streamablehttp_client
from mcp import ClientSession

class ProteinQualityClient:
    def __init__(self, server_url: str):
        self.server_url = server_url
        self.session = None
        
    async def connect(self):
        try:
            self.transport = streamablehttp_client(
                url=self.server_url,
                headers={"SCP-HUB-API-KEY": "<YOUR_SCP_HUB_API_KEY>"}
            )
            self.read, self.write, self.get_session_id = await self.transport.__aenter__()
            self.session_ctx = ClientSession(self.read, self.write)
            self.session = await self.session_ctx.__aenter__()
            await self.session.initialize()
            return True
        except Exception as e:
            print(f"Connection failed: {e}")
            return False
    
    async def disconnect(self):
        if self.session:
            await self.session_ctx.__aexit__(None, None, None)
        if hasattr(self, 'transport'):
            await self.transport.__aexit__(None, None, None)
    
    def parse_result(self, result):
        try:
            if hasattr(result, 'content') and result.content:
                content = result.content[0]
                if hasattr(content, 'text'):
                    return json.loads(content.text)
            return str(result)
        except:
            return str(result)
```

### 2. Protein Quality Assessment Workflow

**Workflow Steps:**

1. **Structure Input** - Provide PDB ID or upload structure file
2. **Quality Metrics** - Calculate multiple quality scores
3. **Local Assessment** - Evaluate per-residue quality
4. **Global Scoring** - Generate overall quality summary
5. **Report Generation** - Create detailed quality report

**Implementation:**

```python
# Connect to Protein Quality Assessment server
client = ProteinQualityClient("https://scp.intern-ai.org.cn/api/v1/mcp/17/BioInfo-Tools")
if not await client.connect():
    print("Connection failed")
    exit()

# Assess protein structure quality
assessment_data = {
    "structure": "1ABC",  # PDB ID or structure data
    "structure_format": "pdb",
    "metrics": [
        "global_score",
        "local_accuracy",
        "stereochemistry",
        "Ramachandran",
        "clashscore"
    ],
    "assessment_level": "full"
}

result = await client.session.call_tool(
    "assess_protein_quality",
    arguments=assessment_data
)
data = client.parse_result(result)

print(f"Quality Assessment Results: {json.dumps(data, indent=2, ensure_ascii=False)}")

await client.disconnect()
```

### Tool Descriptions

**BioInfo-Tools Server:**
- `assess_protein_quality`: Comprehensive quality assessment
  - Args:
    - `structure` (str): PDB ID or structure content
    - `structure_format` (str): Format (pdb, mmcif)
    - `metrics` (list): Quality metrics to calculate
    - `assessment_level` (str): Assessment depth (basic, full)
  - Returns:
    - Quality scores and assessment report

- `calculate_global_score`: Overall quality scoring
  - Args:
    - `structure` (str): Protein structure
    - `method` (str): Scoring method
  - Returns:
    - Global quality score (0-100)

- `analyze_ramachandran`: Ramachandran plot analysis
  - Args:
    - `structure` (str): Protein structure
    - `outlier_threshold` (float): Outlier cutoff
  - Returns:
    - Residue distribution in Ramachandran regions

- `detect_clashes`: Steric clash detection
  - Args:
    - `structure` (str): Protein structure
    - `cutoff` (float): Clash distance cutoff (Å)
  - Returns:
    - Number and positions of clashes

### Input/Output

**Input:**
- PDB ID or protein structure file
- Quality metrics selection
- Assessment depth level

**Output:**
- Global quality scores (GDT, TM-score, etc.)
- Per-residue local accuracy
- Ramachandran plot statistics
- Sterochemistry validation
- Clash detection results

### Use Cases

- Quality control for modeled protein structures
- Validation of experimental structures (X-ray, NMR)
- Assessment of AlphaFold/ESMFold predictions
- Identify problematic regions in structures
- Support drug discovery and design decisions

### Performance Notes

- **Execution time**: 30-180 seconds depending on structure size
- **Timeout recommendation**: Set to at least 300 seconds
- **Recommended input**: Structures with 50-2000 residues

### Web Portal Access

Access this tool via SCP Hub: https://scphub.intern-ai.org.cn/skill/protein_quality_assessment

Direct API endpoint: `https://scp.intern-ai.org.cn/api/v1/mcp/17/BioInfo-Tools`