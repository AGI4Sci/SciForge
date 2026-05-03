---
name: dna-sequencing
description: "DNA and RNA sequencing analysis tool for sequence validation, quality assessment, and bioinformatics processing of nucleotide sequences."
metadata:
  scpToolId: "4"
  scpCategory: "life_science"
  scpHubUrl: "https://scphub.intern-ai.org.cn/skill/dna-sequencing"
  categoryLabel: "生命科学"
  tags: ["生物信息学", "基因组学", "DNA", "RNA"]
---

# DNA/RNA Sequencing Analysis

## Usage

### 1. MCP Server Definition

```python
import asyncio
import json
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport

class DnaSequencingClient:
    """DNA/RNA Sequencing Analysis MCP Client using FastMCP"""

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

### 2. DNA/RNA Sequencing Workflow

This workflow processes and analyzes DNA and RNA sequences, including quality checks, sequence validation, and format conversion for downstream bioinformatics applications.

**Workflow Steps:**

1. **Validate Sequence** - Check sequence validity and detect invalid characters
2. **Reverse Complement** - Generate reverse complement of DNA sequences
3. **Transcribe DNA to RNA** - Convert DNA to RNA sequence
4. **Translate to Protein** - Translate nucleotide sequence to amino acid sequence
5. **GC Content Analysis** - Calculate GC content percentage

**Implementation:**

```python
## Initialize client
HEADERS = {"SCP-HUB-API-KEY": "<your-api-key>"}

client = DnaSequencingClient(
    "https://scp.intern-ai.org.cn/api/v1/mcp/3/SCPBioinformatics",
    HEADERS
)

if not await client.connect():
    print("connection failed")
    exit()

## Input: DNA sequence to analyze
sequence = "ATGCGTACGTAGCTAGCTAG"
print(f"=== DNA/RNA Sequencing Analysis ===\n")
print(f"Input sequence: {sequence}")
print(f"Length: {len(sequence)} bp\n")

## Step 1: Validate sequence
print("Step 1: Validate Sequence")
result = await client.client.call_tool(
    "ValidateSequence",
    arguments={"sequence": sequence, "seq_type": "dna"}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 2: Reverse complement
print("Step 2: Reverse Complement")
result = await client.client.call_tool(
    "ReverseComplement",
    arguments={"sequence": sequence}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 3: Transcribe DNA to RNA
print("Step 3: Transcribe to RNA")
result = await client.client.call_tool(
    "TranscribeDNA",
    arguments={"sequence": sequence}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 4: Translate to protein
print("Step 4: Translate to Protein")
result = await client.client.call_tool(
    "TranslateSequence",
    arguments={"sequence": sequence, "reading_frame": 1}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

## Step 5: GC content analysis
print("Step 5: GC Content Analysis")
result = await client.client.call_tool(
    "CalculateGCContent",
    arguments={"sequence": sequence}
)
result_data = client.parse_result(result)
print(f"{result_data}\n")

await client.disconnect()
```

### Tool Descriptions

**SCPBioinformatics Server (server_id: 3):**
- `ValidateSequence`: Validate DNA/RNA sequence for invalid characters
  - Args: `sequence` (str), `seq_type` (str: "dna"|"rna")
  - Returns: Validation status, sequence length, GC content

- `ReverseComplement`: Generate reverse complement of DNA sequence
  - Args: `sequence` (str)
  - Returns: Reverse complement sequence

- `TranscribeDNA`: Convert DNA sequence to RNA
  - Args: `sequence` (str)
  - Returns: RNA sequence (T→U conversion)

- `TranslateSequence`: Translate nucleotide to amino acid sequence
  - Args: `sequence` (str), `reading_frame` (int: 1|2|3)
  - Returns: Protein sequence in single-letter code

- `CalculateGCContent`: Calculate GC content percentage
  - Args: `sequence` (str)
  - Returns: GC percentage, G count, C count

### Input/Output

**Input:**
- `sequence`: DNA or RNA sequence (A, T/U, G, C bases)
- `seq_type`: Sequence type ("dna" or "rna")
- `reading_frame`: Translation reading frame (1, 2, or 3)

**Output:**
- **Validation**: Sequence validity, length, base composition
- **Reverse Complement**: Complementary strand in 5'→3' orientation
- **RNA Sequence**: DNA→RNA transcribed sequence
- **Protein Sequence**: Translated amino acid sequence
- **GC Content**: Percentage of G+C bases

### Use Cases

- DNA/RNA sequence validation and QC
- Primer design validation
- Gene structure analysis
- ORF (Open Reading Frame) detection
- Bioinformatics pipeline preparation
- Sequence format conversion
- Phylogenetic analysis preparation
- Gene expression analysis support
- CRISPR guide RNA design
- Viral genome analysis

### GC Content Interpretation

- High GC (>60%): Often found in thermophiles, certain gene promoters
- Moderate GC (40-60%): Typical for most eukaryotic genomes
- Low GC (<40%): Often found in AT-rich genomes, certain bacteria

### Standard Nucleotide Codes

```
DNA: A (Adenine), T (Thymine), G (Guanine), C (Cytosine)
RNA: A (Adenine), U (Uracil),  G (Guanine), C (Cytosine)
```

### Quick Example

```python
# Simple DNA validation and GC content
result = await client.client.call_tool(
    "AnalyzeSequence",
    arguments={
        "sequence": "ATGCGTACGTAGCTAGCTAG",
        "seq_type": "dna"
    }
)
```

### Reading Frames

Translation can start at three different positions:
- Frame +1: positions 1, 4, 7...
- Frame +2: positions 2, 5, 8...
- Frame +3: positions 3, 6, 9...

Use the appropriate reading frame based on known gene structure or scan all three for ORF detection.