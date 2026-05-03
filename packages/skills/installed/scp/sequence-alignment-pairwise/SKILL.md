---
name: sequence-alignment-pairwise
description: "Pairwise sequence alignment tool for DNA, RNA, and protein sequences with global and local alignment modes."
metadata:
  scpToolId: "3"
  scpCategory: "life_science"
  scpHubUrl: "https://scphub.intern-ai.org.cn/skill/sequence-alignment-pairwise"
  categoryLabel: "生命科学"
  tags: ["生物信息学", "序列比对"]
---

# Pairwise Sequence Alignment

## Usage

### 1. MCP Server Definition

```python
import asyncio
import json
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport

class SequenceAlignmentClient:
    """Pairwise Sequence Alignment MCP Client using FastMCP"""

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

### 2. Pairwise Sequence Alignment Workflow

This workflow performs pairwise sequence alignment for DNA, RNA, and protein sequences using standard alignment algorithms (Needleman-Wunsch for global, Smith-Waterman for local).

**Workflow Steps:**

1. **Global Alignment (Needleman-Wunsch)** - Align entire sequences, optimal for homologous sequences of similar length
2. **Local Alignment (Smith-Waterman)** - Find best local region alignment, optimal for finding conserved domains
3. **Calculate Identity & Similarity** - Quantify sequence similarity

**Implementation:**

```python
## Initialize client
HEADERS = {"SCP-HUB-API-KEY": "<your-api-key>"}

client = SequenceAlignmentClient(
    "https://scp.intern-ai.org.cn/api/v1/mcp/3/SCPBioinformatics",
    HEADERS
)

if not await client.connect():
    print("connection failed")
    exit()

## Input: Two sequences to align
seq_a = "ATGCGTACGTAGCTAGCTAG"
seq_b = "ATG---ACGTAGCTAGCTAG"

print(f"=== Pairwise Sequence Alignment ===\n")
print(f"Sequence A: {seq_a}")
print(f"Sequence B: {seq_b}\n")

## Step 1: Global alignment (Needleman-Wunsch)
print("Step 1: Global Alignment (Needleman-Wunsch)")
result = await client.client.call_tool(
    "GlobalAlignment",
    arguments={
        "seq_a": seq_a,
        "seq_b": seq_b,
        "mode": "protein"  # or "dna", "rna"
    }
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 2: Local alignment (Smith-Waterman)
print("Step 2: Local Alignment (Smith-Waterman)")
result = await client.client.call_tool(
    "LocalAlignment",
    arguments={
        "seq_a": seq_a,
        "seq_b": seq_b,
        "mode": "protein"  # or "dna", "rna"
    }
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 3: Calculate sequence identity
print("Step 3: Calculate Identity & Similarity")
result = await client.client.call_tool(
    "CalculateIdentity",
    arguments={
        "seq_a": seq_a,
        "seq_b": seq_b
    }
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

await client.disconnect()
```

### Tool Descriptions

**SCPBioinformatics Server (server_id: 3):**
- `GlobalAlignment`: Perform global sequence alignment (Needleman-Wunsch algorithm)
  - Args: `seq_a` (str), `seq_b` (str), `mode` (str: "dna"|"rna"|"protein")
  - Returns: Aligned sequences, score, and alignment statistics

- `LocalAlignment`: Perform local sequence alignment (Smith-Waterman algorithm)
  - Args: `seq_a` (str), `seq_b` (str), `mode` (str: "dna"|"rna"|"protein")
  - Returns: Best local alignment, score, and aligned region coordinates

- `CalculateIdentity`: Calculate pairwise sequence identity and similarity
  - Args: `seq_a` (str), `seq_b` (str)
  - Returns: Identity percentage, similarity percentage, alignment length

### Input/Output

**Input:**
- `seq_a`: First sequence (DNA/RNA/Protein)
- `seq_b`: Second sequence (DNA/RNA/Protein)
- `mode`: Alignment mode - "dna", "rna", or "protein"

**Output:**
- **Aligned Sequences**: Sequences with gaps (-) inserted for optimal alignment
- **Alignment Score**: Numerical score based on substitution matrix and gap penalties
- **Identity %**: Percentage of identical positions
- **Similarity %**: Percentage of identical + similar positions
- **Gaps**: Number and percentage of gap positions

### Alignment Modes

**Global Alignment (Needleman-Wunsch):**
- Aligns entire sequences from start to end
- Best for: sequences of similar length, overall similarity assessment
- Use when: sequences are homologous and full-length

**Local Alignment (Smith-Waterman):**
- Finds the best-matching region(s) between sequences
- Best for: finding conserved domains, distantly related sequences
- Use when: sequences may have variable regions or are partially homologous

### Use Cases

- Homology detection
- Evolutionary relationship analysis
- Gene family identification
- Conserved domain detection
- Primer design validation
- Mutation analysis
- Phylogenetic tree building (preprocessing)
- Functional annotation support
- Drug target validation
- Species identification (DNA barcoding)

### Interpretation Guidelines

**Identity Thresholds:**
- > 90%: likely orthologs (same function)
- 50-90%: possible orthologs, functional prediction uncertain
- 20-50%: remote homology, domain-level conservation likely
- < 20%: may be unrelated or very distant

**Similarity vs Identity:**
- Similarity considers conservative substitutions (similar amino acids)
- Identity only counts exact matches
- BLOSUM/PAM matrices used for protein similarity

### Quick Alignment Example

```python
# Simple pairwise alignment using default parameters
result = await client.client.call_tool(
    "AlignPairwise",
    arguments={
        "seq_a": "MKFLILLFNILCLFPVLAADNH",
        "seq_b": "MKFLIL---ILCLFPVLAADNH",
        "mode": "protein"
    }
)
```

### Standard Substitution Matrices

**For Proteins:**
- BLOSUM62: default for database searches (62% identity)
- BLOSUM80: for closely related sequences
- PAM250: for distant relationships

**For DNA/RNA:**
- Simple match/mismatch scoring
- Custom scoring matrices available

### Gap Penalties

- Gap opening: penalty for starting a gap
- Gap extension: penalty for extending an existing gap
- Typical settings: gap_open = 10, gap_extend = 1