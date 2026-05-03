---
name: atc_drug_classification
description: "Classify drugs according to the Anatomical Therapeutic Chemical (ATC) classification system. Input a drug name, compound name, or SMILES string and receive the corresponding ATC code(s) with therapeutic hierarchy (Anatomical main group → Therapeutic subgroup → Pharmacological subgroup → Chemical subgroup → Chemical substance)."
metadata:
  scpToolId: "atc_drug_classification"
  scpCategory: "life_science"
  scpHubUrl: "https://scphub.intern-ai.org.cn/skill/atc_drug_classification"
  categoryLabel: "生命科学"
  tags: ["生命科学", "药物分类", "ATC"]
---

# ATC Drug Classification

## Usage

### 1. MCP Server Definition

```python
import asyncio
import json
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport

class AtcClassificationClient:
    """ATC Drug Classification MCP Client using FastMCP"""

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

### 2. ATC Classification Workflow

Classifies drugs using the WHO ATC (Anatomical Therapeutic Chemical) classification system.

**Workflow Steps:**

1. **Classify Drug** - Query ATC classification by drug name or SMILES
2. **Retrieve Hierarchy** - Get full therapeutic hierarchy levels
3. **Map ATC Code** - Return ATC code with group descriptions

**Implementation:**

```python
import asyncio

async def main():
    HEADERS = {"SCP-HUB-API-KEY": "<your-api-key>"}

    # Use the DrugSDAMolClient or appropriate server for ATC classification
    client = AtcClassificationClient(
        "https://scp.intern-ai.org.cn/api/v1/mcp/<server-id>/AtcClassification",
        HEADERS
    )

    if not await client.connect():
        print("connection failed")
        return

    # Input: drug name or SMILES
    drug_name = "Paracetamol"
    print(f"=== ATC Classification for: {drug_name} ===\n")

    result = await client.client.call_tool(
        "atc_drug_classification_classify",
        arguments={"drug_name": drug_name}
    )
    result_data = client.parse_result(result)
    print(f"Result: {result_data}\n")

    await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
```

### Tool Description

**ATC Drug Classification Server:**
- `atc_drug_classification_classify`: Classify drug by name or SMILES
  - Args: `drug_name` (str) - Drug or compound name, `smiles` (str, optional) - SMILES string
  - Returns: ATC code with full therapeutic hierarchy

### Input/Output

**Input:**
- `drug_name`: Drug or compound name (e.g., "Paracetamol", "Aspirin", "Metformin")
- `smiles`: Optional SMILES string for structure-based classification

**Output:**
- **ATC Code**: WHO ATC code (e.g., `N02BE01` for paracetamol)
- **Classification Hierarchy**:
  - 1st level (Anatomical main group): e.g., N - Nervous system
  - 2nd level (Therapeutic subgroup): e.g., N02 - Analgesics
  - 3rd level (Pharmacological subgroup): e.g., N02B - Other analgesics and antipyretics
  - 4th level (Chemical subgroup): e.g., N02BE - Anilides
  - 5th level (Chemical substance): e.g., N02BE01 - Paracetamol
- **Therapeutic classification level**

### ATC Classification System

The WHO ATC system classifies drugs into groups according to:

| Level | Description | Example |
|-------|-------------|---------|
| 1st | Anatomical main group | N - Nervous system |
| 2nd | Therapeutic subgroup | N02 - Analgesics |
| 3rd | Pharmacological subgroup | N02B - Other analgesics |
| 4th | Chemical subgroup | N02BE - Anilides |
| 5th | Chemical substance | N02BE01 - Paracetamol |

### Use Cases

- Drug categorization and regulatory submission
- Pharmaceutical inventory management
- Comparative drug effectiveness analysis
- Drug safety surveillance by therapeutic category
- Pharmacoeconomic research
- Cross-referencing drug databases

### Local Description

**网页端调用**: https://scphub.intern-ai.org.cn/skill/atc_drug_classification

**下载说明**: 本地为 SKILL.md 资源定义，工具执行由 SCP Hub 远程服务提供。需配置 `openteam.json → integrations.scpHub.apiKey`。

### Mock Invoke (offline fallback)

When SCP Hub API key is not configured, `mockInvokeTool` in `server/api/scp-tools/invoke.ts` will return a placeholder response. Real computation requires a valid API key and network access to SCP Hub.