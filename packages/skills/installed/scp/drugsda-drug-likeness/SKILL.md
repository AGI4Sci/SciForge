---
name: drugsda-drug-likeness
description: "Drug Likeness Assessment - Evaluate compound drug-likeness using Lipinski's rule of five, Veber's criteria, and other pharmaceutical filters. Use this skill for drug discovery tasks involving rule-of-five ADME prediction oral bioavailability molecular property filtering. Assess compound developability and medicinal chemistry potential."
metadata:
  scpToolId: "66"
  scpCategory: "chemistry"
  scpHubUrl: "https://scphub.intern-ai.org.cn/skill/drugsda-drug-likeness"
  categoryLabel: "化学"
  tags: ["化学", "类药性", "药物发现"]
---

# Drug Likeness Assessment

## Usage

### 1. MCP Server Definition

```python
import json
from mcp.client.streamable_http import streamablehttp_client
from mcp import ClientSession

class DrugSDAClient:    
    def __init__(self, server_url: str):
        self.server_url = server_url
        self.session = None
        
    async def connect(self):
        print(f"server url: {self.server_url}")
        try:
            self.transport = streamablehttp_client(
                url=self.server_url,
                headers={"SCP-HUB-API-KEY": "sk-a0033dde-b3cd-413b-adbe-980bc78d6126"}
            )
            self.read, self.write, self.get_session_id = await self.transport.__aenter__()
            
            self.session_ctx = ClientSession(self.read, self.write)
            self.session = await self.session_ctx.__aenter__()

            await self.session.initialize()
            session_id = self.get_session_id()
            
            print(f"✓ connect success")
            return True
            
        except Exception as e:
            print(f"✗ connect failure: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    async def disconnect(self):
        try:
            if self.session:
                await self.session_ctx.__aexit__(None, None, None)
            if hasattr(self, 'transport'):
                await self.transport.__aexit__(None, None, None)
            print("✓ already disconnect")
        except Exception as e:
            print(f"✗ disconnect error: {e}")
    
    def parse_result(self, result):
        try:
            if hasattr(result, 'content') and result.content:
                content = result.content[0]
                if hasattr(content, 'text'):
                    return json.loads(content.text)
            return str(result)
        except Exception as e:
            return {"error": f"parse error: {e}", "raw": str(result)}
```

### 2. Tool Description

Tool: *calculate_mol_drug_chemistry*

```tex
Evaluate drug-likeness based on multiple pharmaceutical filters and rules.
Args:
    smiles_list (List[str]): List of input SMILES strings, (e.g., ["CC(=O)Oc1ccccc1C(=O)O", "CC(C)C1=CC=CC=C1"])
Return:
    status (str): success/error
    msg (str): message
    drug_likeness (List[dict]): List of dict, each containing:
        --smiles (str): A SMILES string of smiles_list
        --lipinski_violations (int): Number of Lipinski's rule of five violations
        --lipinski_pass (bool): Whether compound passes Lipinski's rule
        --veber_pass (bool): Whether compound passes Veber's criteria
        --ghose_pass (bool): Whether compound passes Ghose's criteria
        -- muegelge_pass (bool): Whether compound passes Muegelge's criteria
        --overall_drug_likeness (str): Overall drug-likeness assessment (good/medium/poor)
        --warnings (List[str]): List of specific warnings
```

### 3. Example Code

How to use calculate_mol_drug_chemistry:

```python
client = DrugSDAClient("https://scp.intern-ai.org.cn/api/v1/mcp/2/DrugSDA-Tool")
if not await client.connect():
    print("connection failed")
    return

smiles_list = ["CC(=O)Oc1ccccc1C(=O)O", "CC(C)C1=CC=CC=C1"]

response = await client.session.call_tool(
    "calculate_mol_drug_chemistry",
    arguments={
        "smiles_list": smiles_list
    }
)
result = client.parse_result(response)
drug_likeness = result["drug_likeness"]

print(f"Drug Likeness Results: {json.dumps(drug_likeness, indent=2, ensure_ascii=False)}")

await client.disconnect() 
```

### Drug Likeness Rules

**Lipinski's Rule of Five:**
- Molecular weight ≤ 500 Da
- LogP ≤ 5
- Hydrogen bond donors ≤ 5
- Hydrogen bond acceptors ≤ 10

**Veber's Criteria:**
- Rotatable bonds ≤ 10
- Topological polar surface area (TPSA) ≤ 140 Å²

### Input/Output

**Input:**
- SMILES strings for compounds to evaluate

**Output:**
- Pass/fail status for each pharmaceutical rule
- Overall drug-likeness classification
- Specific warnings and recommendations
- Structural alerts if applicable

### Use Cases

- Virtual screening hit selection
- Lead compound prioritization
- Oral bioavailability prediction
- Medicinal chemistry SAR analysis

### Web Portal Access

Access this tool via SCP Hub: https://scphub.intern-ai.org.cn/skill/drugsda-drug-likeness

Direct API endpoint: `https://scp.intern-ai.org.cn/api/v1/mcp/2/DrugSDA-Tool`