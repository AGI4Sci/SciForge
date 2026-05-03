# Pdf Extract

**Owner:** xejrax  
**Version:** 1.0.0  
**Source:** [ClawHub](https://clawhub.ai/xejrax/pdf-extract)

## Description

Extract text from PDF files for LLM processing

## Requirements

### Required Binaries

| Binary | Package | Check Status |
|--------|---------|-------------|
| pdftotext | poppler-utils (Linux) / poppler (macOS) | PENDING |

### Installation

```bash
# macOS
brew install poppler

# Ubuntu/Debian
sudo apt-get install poppler-utils

# CentOS/RHEL
sudo yum install poppler-utils
```

## Usage

This skill extracts text from PDF files for downstream LLM processing.
It uses `pdftotext` from poppler-utils as the primary extraction backend.

## Capabilities

- Extract plain text from PDF files
- Preserve page structure and ordering
- Output clean text suitable for LLM context windows
