---
name: drugsda-rgroup-sampling
description: "DrugSDA R-Group Sampling - Generate R-group substituents and scaffold modifications using generative AI models. Use this skill for lead optimization, structure-activity relationship exploration, and multi-objective molecular generation with specified attachment points."
metadata:
  scpToolId: "drugsda-rgroup-sampling"
  scpCategory: "chemistry"
  scpHubUrl: "https://scphub.intern-ai.org.cn/skill/drugsda-rgroup-sampling"
  categoryLabel: "化学"
  tags: ["化学", "AI分子生成", "R-基团采样", "药物设计"]
---

# DrugSDA R-Group Sampling

## Usage

### MCP Server Definition

```python
import json
from mcp.client.streamable_http import streamablehttp_client
from mcp import ClientSession

class RGroupSamplingClient:
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
```

### Tool Descriptions

**DrugSDA-Tool Server (toolId: 2):**
- `sample_rgroups`: Sample R-group substituents
- `optimize_rgroup`: Multi-objective R-group optimization
- `analyze_sar`: SAR analysis for R-groups
- `diversity_sampling`: Diverse R-group sampling

### Web Portal Access

Access via SCP Hub: https://scphub.intern-ai.org.cn/skill/drugsda-rgroup-sampling

Direct API: `https://scp.intern-ai.org.cn/api/v1/mcp/2/DrugSDA-Tool`
