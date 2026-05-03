import type { SkillPackageManifest } from './types';

export const skillPackageManifests = [
  {
    "id": "pdf-extract",
    "packageName": "@bioagent-skill/pdf-extract",
    "kind": "skill",
    "version": "1.0.0",
    "label": "Pdf Extract",
    "description": "Extract text from PDF files for LLM processing",
    "source": "package",
    "skillDomains": [
      "literature",
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/xejrax/pdf-extract/SKILL.md"
    },
    "outputArtifactTypes": [
      "research-report",
      "structure-summary"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "pdf extract",
      "extract processing",
      "Use pdf extract and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/xejrax/pdf-extract/SKILL.md",
      "agentSummary": "Extract text from PDF files for LLM processing"
    },
    "packageRoot": "packages/skills/installed/xejrax/pdf-extract",
    "tags": [
      "package",
      "",
      "literature",
      "structure",
      "knowledge"
    ]
  },
  {
    "id": "scp.admet_druglikeness_report",
    "packageName": "@bioagent-skill/admet_druglikeness_report",
    "kind": "skill",
    "version": "1.0.0",
    "label": "admet_druglikeness_report",
    "description": "ADMET drug-likeness assessment tool evaluating Absorption, Distribution, Metabolism, Excretion, and Toxicity properties for compound optimization and drug discovery.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/admet_druglikeness_report/SKILL.md"
    },
    "outputArtifactTypes": [
      "research-report",
      "sequence-alignment",
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "admet druglikeness report",
      "likeness assessment evaluating absorption distribution metabolism excretion toxicity",
      "Use admet druglikeness report and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/admet_druglikeness_report/SKILL.md",
      "agentSummary": "ADMET drug-likeness assessment tool evaluating Absorption, Distribution, Metabolism, Excretion, and Toxicity properties for compound optimization and drug discovery."
    },
    "packageRoot": "packages/skills/installed/scp/admet_druglikeness_report",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "药物化学",
      "ADMET",
      "类药性",
      "毒理学"
    ],
    "scpToolId": "201",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/admet_druglikeness_report"
  },
  {
    "id": "scp.antibody_drug_development",
    "packageName": "@bioagent-skill/antibody_drug_development",
    "kind": "skill",
    "version": "1.0.0",
    "label": "antibody_drug_development",
    "description": "Antibody Drug Development - Develop antibody drugs: epitope prediction, humanness scoring, developability assessment, and immunogenicity prediction. Use this skill for biologics tasks involving predict epitope humanness score developability assess immunogenicity predict. Combines 4 tools from 2 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/antibody_drug_development/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "antibody drug development",
      "antibody development develop antibody epitope prediction humanness scoring",
      "Use antibody drug development and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/antibody_drug_development/SKILL.md",
      "agentSummary": "Antibody Drug Development - Develop antibody drugs: epitope prediction, humanness scoring, developability assessment, and immunogenicity prediction. Use this skill for biologics tasks involving predict epitope humanness score developability assess immunogenicity predict. Combines 4 tools from 2 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/antibody_drug_development",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "生命科学",
      "生物制剂学"
    ],
    "scpToolId": "6",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/6"
  },
  {
    "id": "scp.antibody_target_analysis",
    "packageName": "@bioagent-skill/antibody_target_analysis",
    "kind": "skill",
    "version": "1.0.0",
    "label": "antibody_target_analysis",
    "description": "Antibody Target Analysis - Identify and validate antibody drug targets through target antigen analysis, epitope mapping, and binding affinity prediction. Use this skill for antibody discovery tasks involving analyze target validate epitope predict binding affinity.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/antibody_target_analysis/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "antibody target analysis",
      "antibody target analysis identify validate antibody targets through",
      "Use antibody target analysis and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/antibody_target_analysis/SKILL.md",
      "agentSummary": "Antibody Target Analysis - Identify and validate antibody drug targets through target antigen analysis, epitope mapping, and binding affinity prediction. Use this skill for antibody discovery tasks involving analyze target validate epitope predict binding affinity."
    },
    "packageRoot": "packages/skills/installed/scp/antibody_target_analysis",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "生命科学",
      "抗体药物"
    ],
    "scpToolId": "101",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/antibody_target_analysis"
  },
  {
    "id": "scp.atc_drug_classification",
    "packageName": "@bioagent-skill/atc_drug_classification",
    "kind": "skill",
    "version": "1.0.0",
    "label": "atc_drug_classification",
    "description": "Classify drugs according to the Anatomical Therapeutic Chemical (ATC) classification system. Input a drug name, compound name, or SMILES string and receive the corresponding ATC code(s) with therapeutic hierarchy (Anatomical main group → Therapeutic subgroup → Pharmacological subgroup → Chemical subgroup → Chemical substance).",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/atc_drug_classification/SKILL.md"
    },
    "outputArtifactTypes": [
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "atc drug classification",
      "classify according anatomical therapeutic chemical classification system compound",
      "Use atc drug classification and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/atc_drug_classification/SKILL.md",
      "agentSummary": "Classify drugs according to the Anatomical Therapeutic Chemical (ATC) classification system. Input a drug name, compound name, or SMILES string and receive the corresponding ATC code(s) with therapeutic hierarchy (Anatomical main group → Therapeutic subgroup → Pharmacological subgroup → Chemical subgroup → Chemical substance)."
    },
    "packageRoot": "packages/skills/installed/scp/atc_drug_classification",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge",
      "生命科学",
      "药物分类",
      "ATC"
    ],
    "scpToolId": "atc_drug_classification",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/atc_drug_classification"
  },
  {
    "id": "scp.binding_site_characterization",
    "packageName": "@bioagent-skill/binding_site_characterization",
    "kind": "skill",
    "version": "1.0.0",
    "label": "binding_site_characterization",
    "description": "Characterize protein binding sites including pocket detection, shape analysis, pharmacological features, and druggability assessment for structure-based drug design.",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/binding_site_characterization/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "binding site characterization",
      "characterize protein binding including pocket detection analysis pharmacological",
      "Use binding site characterization and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/binding_site_characterization/SKILL.md",
      "agentSummary": "Characterize protein binding sites including pocket detection, shape analysis, pharmacological features, and druggability assessment for structure-based drug design."
    },
    "packageRoot": "packages/skills/installed/scp/binding_site_characterization",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge",
      "药物设计",
      "分子对接",
      "结合位点",
      "结构生物学"
    ],
    "scpToolId": "201",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/binding_site_characterization"
  },
  {
    "id": "scp.biomarker_discovery",
    "packageName": "@bioagent-skill/biomarker_discovery",
    "kind": "skill",
    "version": "1.0.0",
    "label": "biomarker_discovery",
    "description": "Biomarker Discovery - Identify and validate diagnostic, prognostic, and predictive biomarkers from omics data. Use this skill for biomarker tasks involving gene expression differential analysis pathway enrichment disease signature discovery. Combines multiple tools from SCP servers for multi-omics biomarker identification.",
    "source": "package",
    "skillDomains": [
      "omics",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/biomarker_discovery/SKILL.md"
    },
    "outputArtifactTypes": [
      "evidence-matrix",
      "sequence-alignment",
      "omics-differential-expression",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "biomarker discovery",
      "biomarker discovery identify validate diagnostic prognostic predictive biomarkers",
      "Use biomarker discovery and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/biomarker_discovery/SKILL.md",
      "agentSummary": "Biomarker Discovery - Identify and validate diagnostic, prognostic, and predictive biomarkers from omics data. Use this skill for biomarker tasks involving gene expression differential analysis pathway enrichment disease signature discovery. Combines multiple tools from SCP servers for multi-omics biomarker identification."
    },
    "packageRoot": "packages/skills/installed/scp/biomarker_discovery",
    "tags": [
      "package",
      "scp",
      "omics",
      "knowledge",
      "生命科学",
      "生物标志物",
      "精准医疗"
    ],
    "scpToolId": "110",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/biomarker_discovery"
  },
  {
    "id": "scp.biomedical-web-search",
    "packageName": "@bioagent-skill/biomedical-web-search",
    "kind": "skill",
    "version": "1.0.0",
    "label": "biomedical-web-search",
    "description": "Search biomedical literature, databases, and clinical resources across PubMed, UniProt, DrugBank, and other life science repositories. Supports keyword search, MeSH terms, and filtered queries for genes, proteins, diseases, and compounds.",
    "source": "package",
    "skillDomains": [
      "literature",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/biomedical-web-search/SKILL.md"
    },
    "outputArtifactTypes": [
      "paper-list",
      "evidence-matrix",
      "research-report",
      "sequence-alignment",
      "omics-differential-expression",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "biomedical web search",
      "search biomedical literature databases clinical resources across pubmed",
      "Use biomedical web search and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/biomedical-web-search/SKILL.md",
      "agentSummary": "Search biomedical literature, databases, and clinical resources across PubMed, UniProt, DrugBank, and other life science repositories. Supports keyword search, MeSH terms, and filtered queries for genes, proteins, diseases, and compounds."
    },
    "packageRoot": "packages/skills/installed/scp/biomedical-web-search",
    "tags": [
      "package",
      "scp",
      "literature",
      "knowledge",
      "生命科学",
      "文献检索",
      "生物医学"
    ],
    "scpToolId": "biomedical-web-search",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/biomedical-web-search"
  },
  {
    "id": "scp.cancer_therapy_design",
    "packageName": "@bioagent-skill/cancer_therapy_design",
    "kind": "skill",
    "version": "1.0.0",
    "label": "cancer_therapy_design",
    "description": "Design personalized cancer therapeutic strategies by integrating multi-omics data including genomics, transcriptomics, and proteomics for target identification, drug selection, and biomarker discovery.",
    "source": "package",
    "skillDomains": [
      "omics",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/cancer_therapy_design/SKILL.md"
    },
    "outputArtifactTypes": [
      "evidence-matrix",
      "research-report",
      "sequence-alignment",
      "omics-differential-expression",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "cancer therapy design",
      "design personalized cancer therapeutic strategies integrating including genomics",
      "Use cancer therapy design and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/cancer_therapy_design/SKILL.md",
      "agentSummary": "Design personalized cancer therapeutic strategies by integrating multi-omics data including genomics, transcriptomics, and proteomics for target identification, drug selection, and biomarker discovery."
    },
    "packageRoot": "packages/skills/installed/scp/cancer_therapy_design",
    "tags": [
      "package",
      "scp",
      "omics",
      "knowledge",
      "肿瘤治疗",
      "精准医疗",
      "多组学",
      "生物标志物",
      "靶向治疗"
    ],
    "scpToolId": "cancer_therapy_design",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/cancer_therapy_design"
  },
  {
    "id": "scp.cell_line_assay_analysis",
    "packageName": "@bioagent-skill/cell_line_assay_analysis",
    "kind": "skill",
    "version": "1.0.0",
    "label": "cell_line_assay_analysis",
    "description": "Cell Line Assay Analysis - Analyze cell-based assay data including viability, cytotoxicity, proliferation, and apoptosis assays. Use this skill for drug screening, IC50 determination, and cell viability assessment across different cell lines.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/cell_line_assay_analysis/SKILL.md"
    },
    "outputArtifactTypes": [
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "cell line assay analysis",
      "analysis analyze including viability cytotoxicity proliferation apoptosis assays",
      "Use cell line assay analysis and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/cell_line_assay_analysis/SKILL.md",
      "agentSummary": "Cell Line Assay Analysis - Analyze cell-based assay data including viability, cytotoxicity, proliferation, and apoptosis assays. Use this skill for drug screening, IC50 determination, and cell viability assessment across different cell lines."
    },
    "packageRoot": "packages/skills/installed/scp/cell_line_assay_analysis",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "生命科学",
      "细胞实验",
      "药物筛选"
    ],
    "scpToolId": "cell_line_assay_analysis",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/cell_line_assay_analysis"
  },
  {
    "id": "scp.chembl-molecule-search",
    "packageName": "@bioagent-skill/chembl-molecule-search",
    "kind": "skill",
    "version": "1.0.0",
    "label": "ChEMBL Molecule Search",
    "description": "Search the ChEMBL database for bioactive molecules, drug-like compounds, and their associated biological activity data. Supports search by compound name, SMILES, InChI, or ChEMBL ID.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/chembl-molecule-search/SKILL.md"
    },
    "outputArtifactTypes": [
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "chembl molecule search",
      "search chembl database bioactive molecules compounds associated biological",
      "Use chembl molecule search and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/chembl-molecule-search/SKILL.md",
      "agentSummary": "Search the ChEMBL database for bioactive molecules, drug-like compounds, and their associated biological activity data. Supports search by compound name, SMILES, InChI, or ChEMBL ID."
    },
    "packageRoot": "packages/skills/installed/scp/chembl-molecule-search",
    "tags": [
      "package",
      "scp",
      "knowledge"
    ],
    "scpToolId": "chembl-molecule-search"
  },
  {
    "id": "scp.chemical_structure_comparison",
    "packageName": "@bioagent-skill/chemical_structure_comparison",
    "kind": "skill",
    "version": "1.0.0",
    "label": "chemical_structure_comparison",
    "description": "Chemical Structure Comparison - Compare molecular structures using SMILES, molecular fingerprints, and structural similarity metrics. Use this skill for molecular similarity analysis, scaffold comparison, R-group analysis, and structure-activity relationship studies. Combines PubChem data with similarity algorithms.",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/chemical_structure_comparison/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "chemical structure comparison",
      "chemical structure comparison compare molecular structures smiles molecular",
      "Use chemical structure comparison and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/chemical_structure_comparison/SKILL.md",
      "agentSummary": "Chemical Structure Comparison - Compare molecular structures using SMILES, molecular fingerprints, and structural similarity metrics. Use this skill for molecular similarity analysis, scaffold comparison, R-group analysis, and structure-activity relationship studies. Combines PubChem data with similarity algorithms."
    },
    "packageRoot": "packages/skills/installed/scp/chemical_structure_comparison",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge",
      "化学",
      "分子结构",
      "结构相似性",
      "药物化学"
    ],
    "scpToolId": "chemical_structure_comparison",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/chemical_structure_comparison"
  },
  {
    "id": "scp.chemical-mass-percent-calculation",
    "packageName": "@bioagent-skill/chemical-mass-percent-calculation",
    "kind": "skill",
    "version": "1.0.0",
    "label": "chemical-mass-percent-calculation",
    "description": "Calculate mass percent composition of chemical compounds from molecular formula or SMILES.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/chemical-mass-percent-calculation/SKILL.md"
    },
    "outputArtifactTypes": [
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "chemical mass percent calculation",
      "calculate percent composition chemical compounds molecular formula smiles",
      "Use chemical mass percent calculation and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/chemical-mass-percent-calculation/SKILL.md",
      "agentSummary": "Calculate mass percent composition of chemical compounds from molecular formula or SMILES."
    },
    "packageRoot": "packages/skills/installed/scp/chemical-mass-percent-calculation",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "化学"
    ],
    "scpToolId": "23",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/23"
  },
  {
    "id": "scp.chemical-safety-assessment",
    "packageName": "@bioagent-skill/chemical-safety-assessment",
    "kind": "skill",
    "version": "1.0.0",
    "label": "Chemical Safety Assessment",
    "description": "Evaluate chemical compound safety profiles including toxicity endpoints, hazard classification, MSDS generation, and regulatory compliance assessment. Supports GHS classification, LD50 analysis, and acute/chronic toxicity predictions.",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/chemical_safety_assessment/SKILL.md"
    },
    "outputArtifactTypes": [
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "chemical safety assessment",
      "evaluate chemical compound safety profiles including toxicity endpoints",
      "Use chemical safety assessment and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/chemical_safety_assessment/SKILL.md",
      "agentSummary": "Evaluate chemical compound safety profiles including toxicity endpoints, hazard classification, MSDS generation, and regulatory compliance assessment. Supports GHS classification, LD50 analysis, and acute/chronic toxicity predictions."
    },
    "packageRoot": "packages/skills/installed/scp/chemical_safety_assessment",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge"
    ],
    "scpToolId": "chemical_safety_assessment"
  },
  {
    "id": "scp.combinatorial_chemistry",
    "packageName": "@bioagent-skill/combinatorial_chemistry",
    "kind": "skill",
    "version": "1.0.0",
    "label": "combinatorial_chemistry",
    "description": "Combinatorial Chemistry Library Design - Design combinatorial library: validate core SMILES, generate variants, compute properties, and predict ADMET for library. Use this skill for combinatorial chemistry tasks involving is valid smiles calculate mol basic info calculate mol drug chemistry pred molecule admet. Combines 4 tools from 2 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/combinatorial_chemistry/SKILL.md"
    },
    "outputArtifactTypes": [
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "combinatorial chemistry",
      "combinatorial chemistry library design design combinatorial library validate",
      "Use combinatorial chemistry and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/combinatorial_chemistry/SKILL.md",
      "agentSummary": "Combinatorial Chemistry Library Design - Design combinatorial library: validate core SMILES, generate variants, compute properties, and predict ADMET for library. Use this skill for combinatorial chemistry tasks involving is valid smiles calculate mol basic info calculate mol drug chemistry pred molecule admet. Combines 4 tools from 2 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/combinatorial_chemistry",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "化学",
      "组合化学"
    ],
    "scpToolId": "33",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/33"
  },
  {
    "id": "scp.comparative_drug_analysis",
    "packageName": "@bioagent-skill/comparative_drug_analysis",
    "kind": "skill",
    "version": "1.0.0",
    "label": "comparative_drug_analysis",
    "description": "Comparative Drug Analysis - Compare drugs: mechanism of action, target profiling, pathway analysis, and clinical outcomes. Use this skill for comparative pharmacology tasks involving get drug mechanism get target profile get pathway analysis get clinical outcomes. Combines 4 tools from 3 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/comparative_drug_analysis/SKILL.md"
    },
    "outputArtifactTypes": [
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "comparative drug analysis",
      "comparative analysis compare mechanism action target profiling pathway",
      "Use comparative drug analysis and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/comparative_drug_analysis/SKILL.md",
      "agentSummary": "Comparative Drug Analysis - Compare drugs: mechanism of action, target profiling, pathway analysis, and clinical outcomes. Use this skill for comparative pharmacology tasks involving get drug mechanism get target profile get pathway analysis get clinical outcomes. Combines 4 tools from 3 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/comparative_drug_analysis",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge",
      "生命科学",
      "比较药理学"
    ],
    "scpToolId": "34",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/34"
  },
  {
    "id": "scp.compound_database_crossref",
    "packageName": "@bioagent-skill/compound_database_crossref",
    "kind": "skill",
    "version": "1.0.0",
    "label": "compound_database_crossref",
    "description": "Cross-reference chemical compounds across multiple databases including PubChem, ChEMBL, DrugBank, and ChemSpider.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/compound_database_crossref/SKILL.md"
    },
    "outputArtifactTypes": [
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "compound database crossref",
      "reference chemical compounds across multiple databases including pubchem",
      "Use compound database crossref and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/compound_database_crossref/SKILL.md",
      "agentSummary": "Cross-reference chemical compounds across multiple databases including PubChem, ChEMBL, DrugBank, and ChemSpider."
    },
    "packageRoot": "packages/skills/installed/scp/compound_database_crossref",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "化学",
      "化学信息学"
    ],
    "scpToolId": "36",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/36"
  },
  {
    "id": "scp.compound-name-retrieval",
    "packageName": "@bioagent-skill/compound-name-retrieval",
    "kind": "skill",
    "version": "1.0.0",
    "label": "compound-name-retrieval",
    "description": "Retrieve chemical compounds by common name, synonyms, or brand names from multiple chemical databases.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/compound-name-retrieval/SKILL.md"
    },
    "outputArtifactTypes": [
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "compound name retrieval",
      "retrieve chemical compounds common synonyms multiple chemical databases",
      "Use compound name retrieval and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/compound-name-retrieval/SKILL.md",
      "agentSummary": "Retrieve chemical compounds by common name, synonyms, or brand names from multiple chemical databases."
    },
    "packageRoot": "packages/skills/installed/scp/compound-name-retrieval",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "化学"
    ],
    "scpToolId": "35",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/35"
  },
  {
    "id": "scp.compound-to-drug-pipeline",
    "packageName": "@bioagent-skill/compound-to-drug-pipeline",
    "kind": "skill",
    "version": "1.0.0",
    "label": "Compound-to-Drug Pipeline",
    "description": "Multi-stage pipeline for drug discovery stages including ADMET prediction, target identification, lead optimization.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/compound_to_drug_pipeline/SKILL.md"
    },
    "outputArtifactTypes": [
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "compound to drug pipeline",
      "pipeline discovery stages including prediction target identification optimization",
      "Use compound to drug pipeline and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/compound_to_drug_pipeline/SKILL.md",
      "agentSummary": "Multi-stage pipeline for drug discovery stages including ADMET prediction, target identification, lead optimization."
    },
    "packageRoot": "packages/skills/installed/scp/compound_to_drug_pipeline",
    "tags": [
      "package",
      "scp",
      "knowledge"
    ],
    "scpToolId": "compound_to_drug_pipeline"
  },
  {
    "id": "scp.comprehensive-protein-analysis",
    "packageName": "@bioagent-skill/comprehensive-protein-analysis",
    "kind": "skill",
    "version": "1.0.0",
    "label": "comprehensive-protein-analysis",
    "description": "Comprehensive Protein Analysis - Analyze proteins: sequence features, structural predictions, functional domains, and post-translational modifications. Use this skill for proteomics tasks involving extract sequence features predict structure get functional domains predict PTMs. Combines 4 tools from 2 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/comprehensive-protein-analysis/SKILL.md"
    },
    "outputArtifactTypes": [
      "research-report",
      "sequence-alignment",
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "comprehensive protein analysis",
      "comprehensive protein analysis analyze proteins sequence features structural",
      "Use comprehensive protein analysis and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/comprehensive-protein-analysis/SKILL.md",
      "agentSummary": "Comprehensive Protein Analysis - Analyze proteins: sequence features, structural predictions, functional domains, and post-translational modifications. Use this skill for proteomics tasks involving extract sequence features predict structure get functional domains predict PTMs. Combines 4 tools from 2 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/comprehensive-protein-analysis",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge",
      "生命科学"
    ],
    "scpToolId": "38",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/38"
  },
  {
    "id": "scp.cross_species_genomics",
    "packageName": "@bioagent-skill/cross_species_genomics",
    "kind": "skill",
    "version": "1.0.0",
    "label": "cross_species_genomics",
    "description": "Cross-Species Comparative Genomics - Compare genomes across species: Ensembl comparisons, alignments, gene trees, and NCBI taxonomy. Use this skill for comparative genomics tasks involving get info get species set get aligned regions get genetree member symbol get taxonomy. Combines 4 tools from 2 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/cross_species_genomics/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "cross species genomics",
      "species comparative genomics compare genomes across species ensembl",
      "Use cross species genomics and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/cross_species_genomics/SKILL.md",
      "agentSummary": "Cross-Species Comparative Genomics - Compare genomes across species: Ensembl comparisons, alignments, gene trees, and NCBI taxonomy. Use this skill for comparative genomics tasks involving get info get species set get aligned regions get genetree member symbol get taxonomy. Combines 4 tools from 2 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/cross_species_genomics",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "生命科学",
      "比较基因组学"
    ],
    "scpToolId": "40",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/40"
  },
  {
    "id": "scp.disease_compound_pipeline",
    "packageName": "@bioagent-skill/disease_compound_pipeline",
    "kind": "skill",
    "version": "1.0.0",
    "label": "disease_compound_pipeline",
    "description": "Disease-Compound Pipeline - Link diseases to compounds: disease gene identification, target validation, compound screening, and efficacy prediction. Use this skill for drug discovery tasks involving identify disease genes validate targets screen compounds predict efficacy. Combines 4 tools from 3 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/disease_compound_pipeline/SKILL.md"
    },
    "outputArtifactTypes": [
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "disease compound pipeline",
      "disease compound pipeline diseases compounds disease identification target",
      "Use disease compound pipeline and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/disease_compound_pipeline/SKILL.md",
      "agentSummary": "Disease-Compound Pipeline - Link diseases to compounds: disease gene identification, target validation, compound screening, and efficacy prediction. Use this skill for drug discovery tasks involving identify disease genes validate targets screen compounds predict efficacy. Combines 4 tools from 3 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/disease_compound_pipeline",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "生命科学",
      "药物发现"
    ],
    "scpToolId": "42",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/42"
  },
  {
    "id": "scp.disease_knowledge_graph",
    "packageName": "@bioagent-skill/disease_knowledge_graph",
    "kind": "skill",
    "version": "1.0.0",
    "label": "disease_knowledge_graph",
    "description": "Disease Knowledge Graph - Build disease knowledge graph: disease relationships, gene associations, drug targets, and pathway connections. Use this skill for disease informatics tasks involving get disease relationships get disease genes get drug targets get pathway connections. Combines 4 tools from 2 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/disease_knowledge_graph/SKILL.md"
    },
    "outputArtifactTypes": [
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "disease knowledge graph",
      "disease knowledge disease knowledge disease relationships associations targets",
      "Use disease knowledge graph and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/disease_knowledge_graph/SKILL.md",
      "agentSummary": "Disease Knowledge Graph - Build disease knowledge graph: disease relationships, gene associations, drug targets, and pathway connections. Use this skill for disease informatics tasks involving get disease relationships get disease genes get drug targets get pathway connections. Combines 4 tools from 2 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/disease_knowledge_graph",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "生命科学",
      "疾病信息学"
    ],
    "scpToolId": "44",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/44"
  },
  {
    "id": "scp.disease_protein_profiling",
    "packageName": "@bioagent-skill/disease_protein_profiling",
    "kind": "skill",
    "version": "1.0.0",
    "label": "disease_protein_profiling",
    "description": "Disease Protein Profiling - Profile a disease protein: UniProt data, AlphaFold structure, InterPro domains, phenotype associations from Ensembl. Use this skill for medical proteomics tasks involving query uniprot download alphafold structure query interpro get phenotype gene. Combines 4 tools from 2 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/disease_protein_profiling/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "disease protein profiling",
      "disease protein profiling profile disease protein uniprot alphafold",
      "Use disease protein profiling and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/disease_protein_profiling/SKILL.md",
      "agentSummary": "Disease Protein Profiling - Profile a disease protein: UniProt data, AlphaFold structure, InterPro domains, phenotype associations from Ensembl. Use this skill for medical proteomics tasks involving query uniprot download alphafold structure query interpro get phenotype gene. Combines 4 tools from 2 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/disease_protein_profiling",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge",
      "生命科学",
      "医学蛋白质组学"
    ],
    "scpToolId": "45",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/45"
  },
  {
    "id": "scp.dna-rna-sequence-analysis",
    "packageName": "@bioagent-skill/dna-rna-sequence-analysis",
    "kind": "skill",
    "version": "1.0.0",
    "label": "dna-rna-sequence-analysis",
    "description": "DNA/RNA Sequence Analysis - Analyze DNA/RNA sequences: sequence alignment, motif finding, expression analysis, and variant calling. Use this skill for genomics tasks involving align sequences find motifs analyze expression call variants. Combines 4 tools from 2 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "omics",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/dna-rna-sequence-analysis/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "omics-differential-expression",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "dna rna sequence analysis",
      "sequence analysis analyze sequences sequence alignment finding expression",
      "Use dna rna sequence analysis and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/dna-rna-sequence-analysis/SKILL.md",
      "agentSummary": "DNA/RNA Sequence Analysis - Analyze DNA/RNA sequences: sequence alignment, motif finding, expression analysis, and variant calling. Use this skill for genomics tasks involving align sequences find motifs analyze expression call variants. Combines 4 tools from 2 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/dna-rna-sequence-analysis",
    "tags": [
      "package",
      "scp",
      "omics",
      "knowledge",
      "生命科学"
    ],
    "scpToolId": "46",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/46"
  },
  {
    "id": "scp.dna-sequencing",
    "packageName": "@bioagent-skill/dna-sequencing",
    "kind": "skill",
    "version": "1.0.0",
    "label": "dna-sequencing",
    "description": "DNA and RNA sequencing analysis tool for sequence validation, quality assessment, and bioinformatics processing of nucleotide sequences.",
    "source": "package",
    "skillDomains": [
      "omics",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/dna-sequencing/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "structure-summary",
      "omics-differential-expression",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "dna sequencing",
      "sequencing analysis sequence validation quality assessment bioinformatics processing",
      "Use dna sequencing and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/dna-sequencing/SKILL.md",
      "agentSummary": "DNA and RNA sequencing analysis tool for sequence validation, quality assessment, and bioinformatics processing of nucleotide sequences."
    },
    "packageRoot": "packages/skills/installed/scp/dna-sequencing",
    "tags": [
      "package",
      "scp",
      "omics",
      "knowledge",
      "生物信息学",
      "基因组学",
      "DNA",
      "RNA"
    ],
    "scpToolId": "4",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/dna-sequencing"
  },
  {
    "id": "scp.drug_indication_mapping",
    "packageName": "@bioagent-skill/drug_indication_mapping",
    "kind": "skill",
    "version": "1.0.0",
    "label": "drug_indication_mapping",
    "description": "Drug-Indication Mapping - Map drug indications: ChEMBL drug indications, FDA indications, OpenTargets drug associations, and literature. Use this skill for clinical informatics tasks involving get drug indication by id get indications by drug name get associated drugs by target name pubmed search. Combines 4 tools from 4 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "literature",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/drug_indication_mapping/SKILL.md"
    },
    "outputArtifactTypes": [
      "paper-list",
      "evidence-matrix",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "drug indication mapping",
      "indication mapping indications chembl indications indications opentargets associations",
      "Use drug indication mapping and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/drug_indication_mapping/SKILL.md",
      "agentSummary": "Drug-Indication Mapping - Map drug indications: ChEMBL drug indications, FDA indications, OpenTargets drug associations, and literature. Use this skill for clinical informatics tasks involving get drug indication by id get indications by drug name get associated drugs by target name pubmed search. Combines 4 tools from 4 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/drug_indication_mapping",
    "tags": [
      "package",
      "scp",
      "literature",
      "knowledge",
      "生命科学",
      "临床信息学"
    ],
    "scpToolId": "48",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/48"
  },
  {
    "id": "scp.drug_interaction_checker",
    "packageName": "@bioagent-skill/drug_interaction_checker",
    "kind": "skill",
    "version": "1.0.0",
    "label": "drug_interaction_checker",
    "description": "Drug-Drug Interaction Checker - Check interactions between multiple drugs using FDA interaction data, PubChem compound info, and ChEMBL target overlap analysis. Use this skill for clinical pharmacology tasks involving get drug interaction by drug name get compound by name get target by name. Combines 3 tools from 3 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/drug_interaction_checker/SKILL.md"
    },
    "outputArtifactTypes": [
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "drug interaction checker",
      "interaction checker interactions between multiple interaction pubchem compound",
      "Use drug interaction checker and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/drug_interaction_checker/SKILL.md",
      "agentSummary": "Drug-Drug Interaction Checker - Check interactions between multiple drugs using FDA interaction data, PubChem compound info, and ChEMBL target overlap analysis. Use this skill for clinical pharmacology tasks involving get drug interaction by drug name get compound by name get target by name. Combines 3 tools from 3 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/drug_interaction_checker",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "生命科学",
      "临床药理学"
    ],
    "scpToolId": "49",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/49"
  },
  {
    "id": "scp.drug_metabolism_study",
    "packageName": "@bioagent-skill/drug_metabolism_study",
    "kind": "skill",
    "version": "1.0.0",
    "label": "drug_metabolism_study",
    "description": "Drug Metabolism Study - Analyze drug metabolism pathways, predict metabolites, and assess metabolic stability. Use this skill for ADME studies, metabolite prediction, enzyme interaction analysis, and pharmacokinetic profiling. Supports cytochrome P450 metabolism and phase I/II reaction prediction.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/drug_metabolism_study/SKILL.md"
    },
    "outputArtifactTypes": [
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "drug metabolism study",
      "metabolism analyze metabolism pathways predict metabolites assess metabolic",
      "Use drug metabolism study and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/drug_metabolism_study/SKILL.md",
      "agentSummary": "Drug Metabolism Study - Analyze drug metabolism pathways, predict metabolites, and assess metabolic stability. Use this skill for ADME studies, metabolite prediction, enzyme interaction analysis, and pharmacokinetic profiling. Supports cytochrome P450 metabolism and phase I/II reaction prediction."
    },
    "packageRoot": "packages/skills/installed/scp/drug_metabolism_study",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "化学",
      "药物代谢",
      "ADME",
      "药物化学"
    ],
    "scpToolId": "drug_metabolism_study",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/drug_metabolism_study"
  },
  {
    "id": "scp.drug_repurposing_screen",
    "packageName": "@bioagent-skill/drug_repurposing_screen",
    "kind": "skill",
    "version": "1.0.0",
    "label": "drug_repurposing_screen",
    "description": "Drug Repurposing Screen - Screen drugs for repurposing: target identification, disease matching, safety profiling, and efficacy prediction. Use this skill for drug discovery tasks involving identify targets match diseases profile safety predict efficacy. Combines 4 tools from 3 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/drug_repurposing_screen/SKILL.md"
    },
    "outputArtifactTypes": [
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "drug repurposing screen",
      "repurposing screen screen repurposing target identification disease matching",
      "Use drug repurposing screen and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/drug_repurposing_screen/SKILL.md",
      "agentSummary": "Drug Repurposing Screen - Screen drugs for repurposing: target identification, disease matching, safety profiling, and efficacy prediction. Use this skill for drug discovery tasks involving identify targets match diseases profile safety predict efficacy. Combines 4 tools from 3 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/drug_repurposing_screen",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "生命科学",
      "药物发现"
    ],
    "scpToolId": "51",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/51"
  },
  {
    "id": "scp.drug_safety_profile",
    "packageName": "@bioagent-skill/drug_safety_profile",
    "kind": "skill",
    "version": "1.0.0",
    "label": "drug_safety_profile",
    "description": "Drug Safety Profile - Profile drug safety: adverse reactions, toxicity prediction, drug interactions, and contraindications. Use this skill for pharmacology tasks involving get adverse reactions predict toxicity check interactions get contraindications. Combines 4 tools from 2 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/drug_safety_profile/SKILL.md"
    },
    "outputArtifactTypes": [
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "drug safety profile",
      "safety profile profile safety adverse reactions toxicity prediction",
      "Use drug safety profile and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/drug_safety_profile/SKILL.md",
      "agentSummary": "Drug Safety Profile - Profile drug safety: adverse reactions, toxicity prediction, drug interactions, and contraindications. Use this skill for pharmacology tasks involving get adverse reactions predict toxicity check interactions get contraindications. Combines 4 tools from 2 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/drug_safety_profile",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "生命科学",
      "药理学"
    ],
    "scpToolId": "52",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/52"
  },
  {
    "id": "scp.drug-screening-docking",
    "packageName": "@bioagent-skill/drug-screening-docking",
    "kind": "skill",
    "version": "1.0.0",
    "label": "drug-screening-docking",
    "description": "Comprehensive drug screening pipeline from molecular filtering through QED/ADMET criteria to protein-ligand docking, identifying promising drug candidates.",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/drug-screening-docking/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "drug screening docking",
      "comprehensive screening pipeline molecular filtering through criteria protein",
      "Use drug screening docking and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/drug-screening-docking/SKILL.md",
      "agentSummary": "Comprehensive drug screening pipeline from molecular filtering through QED/ADMET criteria to protein-ligand docking, identifying promising drug candidates."
    },
    "packageRoot": "packages/skills/installed/scp/drug-screening-docking",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge",
      "生命科学"
    ],
    "scpToolId": "47",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/47"
  },
  {
    "id": "scp.drug-target-structure",
    "packageName": "@bioagent-skill/drug-target-structure",
    "kind": "skill",
    "version": "1.0.0",
    "label": "Drug Target Structure",
    "description": "Analyze and predict drug-protein binding structures. Supports target identification, binding pose prediction, and structure-activity relationship analysis for drug discovery.",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/drug_target_structure/SKILL.md"
    },
    "outputArtifactTypes": [
      "research-report",
      "sequence-alignment",
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "drug target structure",
      "analyze predict protein binding structures supports target identification",
      "Use drug target structure and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/drug_target_structure/SKILL.md",
      "agentSummary": "Analyze and predict drug-protein binding structures. Supports target identification, binding pose prediction, and structure-activity relationship analysis for drug discovery."
    },
    "packageRoot": "packages/skills/installed/scp/drug_target_structure",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge"
    ],
    "scpToolId": "drug_target_structure"
  },
  {
    "id": "scp.drug-warning-report",
    "packageName": "@bioagent-skill/drug-warning-report",
    "kind": "skill",
    "version": "1.0.0",
    "label": "Drug Warning Report",
    "description": "Drug safety warnings, black box warnings, contraindications from FDA/EMA/NMPA.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/drug_warning_report/SKILL.md"
    },
    "outputArtifactTypes": [
      "research-report",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "drug warning report",
      "safety warnings warnings contraindications",
      "Use drug warning report and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/drug_warning_report/SKILL.md",
      "agentSummary": "Drug safety warnings, black box warnings, contraindications from FDA/EMA/NMPA."
    },
    "packageRoot": "packages/skills/installed/scp/drug_warning_report",
    "tags": [
      "package",
      "scp",
      "knowledge"
    ],
    "scpToolId": "drug_warning_report"
  },
  {
    "id": "scp.drugsda-admet",
    "packageName": "@bioagent-skill/drugsda-admet",
    "kind": "skill",
    "version": "1.0.0",
    "label": "drugsda-admet",
    "description": "Predict the ADMET (absorption, distribution, metabolism, excretion, and toxicity) properties of the input molecules.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/drugsda-admet/SKILL.md"
    },
    "outputArtifactTypes": [
      "data-table",
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "drugsda admet",
      "predict absorption distribution metabolism excretion toxicity properties molecules",
      "Use drugsda admet and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/drugsda-admet/SKILL.md",
      "agentSummary": "Predict the ADMET (absorption, distribution, metabolism, excretion, and toxicity) properties of the input molecules."
    },
    "packageRoot": "packages/skills/installed/scp/drugsda-admet",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "化学"
    ],
    "scpToolId": "56",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/56"
  },
  {
    "id": "scp.drugsda-compound-retrieve",
    "packageName": "@bioagent-skill/drugsda-compound-retrieve",
    "kind": "skill",
    "version": "1.0.0",
    "label": "drugsda-compound-retrieve",
    "description": "Retrieve compound information from DrugSDA database including structures, properties, and literature references.",
    "source": "package",
    "skillDomains": [
      "literature",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/drugsda-compound-retrieve/SKILL.md"
    },
    "outputArtifactTypes": [
      "paper-list",
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "drugsda compound retrieve",
      "retrieve compound information drugsda database including structures properties",
      "Use drugsda compound retrieve and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/drugsda-compound-retrieve/SKILL.md",
      "agentSummary": "Retrieve compound information from DrugSDA database including structures, properties, and literature references."
    },
    "packageRoot": "packages/skills/installed/scp/drugsda-compound-retrieve",
    "tags": [
      "package",
      "scp",
      "literature",
      "knowledge",
      "化学"
    ],
    "scpToolId": "57",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/57"
  },
  {
    "id": "scp.drugsda-de-novo-sampling",
    "packageName": "@bioagent-skill/drugsda-de-novo-sampling",
    "kind": "skill",
    "version": "1.0.0",
    "label": "DrugSDA De Novo Sampling",
    "description": "Generate novel drug-like molecules using deep learning de novo molecular design. Receives a SMILES string or pharmacophore constraints, then produces new candidate molecules with desired properties through generative models.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/drugsda-denovo-sampling/SKILL.md"
    },
    "outputArtifactTypes": [
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "drugsda de novo sampling",
      "generate molecules learning molecular design receives smiles string",
      "Use drugsda de novo sampling and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/drugsda-denovo-sampling/SKILL.md",
      "agentSummary": "Generate novel drug-like molecules using deep learning de novo molecular design. Receives a SMILES string or pharmacophore constraints, then produces new candidate molecules with desired properties through generative models."
    },
    "packageRoot": "packages/skills/installed/scp/drugsda-denovo-sampling",
    "tags": [
      "package",
      "scp",
      "knowledge"
    ],
    "scpToolId": "drugsda-denovo-sampling"
  },
  {
    "id": "scp.drugsda-drug-likeness",
    "packageName": "@bioagent-skill/drugsda-drug-likeness",
    "kind": "skill",
    "version": "1.0.0",
    "label": "drugsda-drug-likeness",
    "description": "Drug Likeness Assessment - Evaluate compound drug-likeness using Lipinski's rule of five, Veber's criteria, and other pharmaceutical filters. Use this skill for drug discovery tasks involving rule-of-five ADME prediction oral bioavailability molecular property filtering. Assess compound developability and medicinal chemistry potential.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/drugsda-drug-likeness/SKILL.md"
    },
    "outputArtifactTypes": [
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "drugsda drug likeness",
      "likeness assessment evaluate compound likeness lipinski criteria pharmaceutical",
      "Use drugsda drug likeness and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/drugsda-drug-likeness/SKILL.md",
      "agentSummary": "Drug Likeness Assessment - Evaluate compound drug-likeness using Lipinski's rule of five, Veber's criteria, and other pharmaceutical filters. Use this skill for drug discovery tasks involving rule-of-five ADME prediction oral bioavailability molecular property filtering. Assess compound developability and medicinal chemistry potential."
    },
    "packageRoot": "packages/skills/installed/scp/drugsda-drug-likeness",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "化学",
      "类药性",
      "药物发现"
    ],
    "scpToolId": "66",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/drugsda-drug-likeness"
  },
  {
    "id": "scp.drugsda-esmfold",
    "packageName": "@bioagent-skill/drugsda-esmfold",
    "kind": "skill",
    "version": "1.0.0",
    "label": "drugsda-esmfold",
    "description": "Use ESMFold model to predict 3D structure of the input protein sequence.",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/drugsda-esmfold/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "drugsda esmfold",
      "esmfold predict structure protein sequence",
      "Use drugsda esmfold and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/drugsda-esmfold/SKILL.md",
      "agentSummary": "Use ESMFold model to predict 3D structure of the input protein sequence."
    },
    "packageRoot": "packages/skills/installed/scp/drugsda-esmfold",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge",
      "生命科学"
    ],
    "scpToolId": "62",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/62"
  },
  {
    "id": "scp.drugsda-linker-sampling",
    "packageName": "@bioagent-skill/drugsda-linker-sampling",
    "kind": "skill",
    "version": "1.0.0",
    "label": "drugsda-linker-sampling",
    "description": "Sample chemical linkers for molecular fusion connecting two pharmacophores with optimal properties.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/drugsda-linker-sampling/SKILL.md"
    },
    "outputArtifactTypes": [
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "drugsda linker sampling",
      "sample chemical linkers molecular fusion connecting pharmacophores optimal",
      "Use drugsda linker sampling and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/drugsda-linker-sampling/SKILL.md",
      "agentSummary": "Sample chemical linkers for molecular fusion connecting two pharmacophores with optimal properties."
    },
    "packageRoot": "packages/skills/installed/scp/drugsda-linker-sampling",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "化学"
    ],
    "scpToolId": "64",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/64"
  },
  {
    "id": "scp.drugsda-mol-properties",
    "packageName": "@bioagent-skill/drugsda-mol-properties",
    "kind": "skill",
    "version": "1.0.0",
    "label": "drugsda-mol-properties",
    "description": "Calculate different types of molecular properties based on SMILES strings, covering basic physicochemical properties, hydrophobicity, hydrogen bonding capability, molecular complexity, topological structures, charge distribution, and custom complexity metrics, respectively.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/drugsda-mol-properties/SKILL.md"
    },
    "outputArtifactTypes": [
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "drugsda mol properties",
      "calculate different molecular properties smiles strings covering physicochemical",
      "Use drugsda mol properties and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/drugsda-mol-properties/SKILL.md",
      "agentSummary": "Calculate different types of molecular properties based on SMILES strings, covering basic physicochemical properties, hydrophobicity, hydrogen bonding capability, molecular complexity, topological structures, charge distribution, and custom complexity metrics, respectively."
    },
    "packageRoot": "packages/skills/installed/scp/drugsda-mol-properties",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "化学"
    ],
    "scpToolId": "65",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/65"
  },
  {
    "id": "scp.drugsda-mol-similarity",
    "packageName": "@bioagent-skill/drugsda-mol-similarity",
    "kind": "skill",
    "version": "1.0.0",
    "label": "drugsda-mol-similarity",
    "description": "Search for similar molecules in DrugSDA database using molecular fingerprints and Tanimoto similarity.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/drugsda-mol-similarity/SKILL.md"
    },
    "outputArtifactTypes": [
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "drugsda mol similarity",
      "search similar molecules drugsda database molecular fingerprints tanimoto",
      "Use drugsda mol similarity and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/drugsda-mol-similarity/SKILL.md",
      "agentSummary": "Search for similar molecules in DrugSDA database using molecular fingerprints and Tanimoto similarity."
    },
    "packageRoot": "packages/skills/installed/scp/drugsda-mol-similarity",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "化学"
    ],
    "scpToolId": "66",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/66"
  },
  {
    "id": "scp.drugsda-mol2mol-sampling",
    "packageName": "@bioagent-skill/drugsda-mol2mol-sampling",
    "kind": "skill",
    "version": "1.0.0",
    "label": "DrugSDA Mol2Mol Sampling",
    "description": "Generate novel molecules using Mol2Mol transformer models.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/drugsda-mol2mol-sampling/SKILL.md"
    },
    "outputArtifactTypes": [
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "drugsda mol2mol sampling",
      "generate molecules mol2mol transformer models",
      "Use drugsda mol2mol sampling and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/drugsda-mol2mol-sampling/SKILL.md",
      "agentSummary": "Generate novel molecules using Mol2Mol transformer models."
    },
    "packageRoot": "packages/skills/installed/scp/drugsda-mol2mol-sampling",
    "tags": [
      "package",
      "scp",
      "knowledge"
    ],
    "scpToolId": "drugsda-mol2mol-sampling"
  },
  {
    "id": "scp.drugsda-p2rank",
    "packageName": "@bioagent-skill/drugsda-p2rank",
    "kind": "skill",
    "version": "1.0.0",
    "label": "drugsda-p2rank",
    "description": "Predict protein binding sites using P2Rank machine learning algorithm for druggable site identification.",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/drugsda-p2rank/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "drugsda p2rank",
      "predict protein binding p2rank machine learning algorithm druggable",
      "Use drugsda p2rank and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/drugsda-p2rank/SKILL.md",
      "agentSummary": "Predict protein binding sites using P2Rank machine learning algorithm for druggable site identification."
    },
    "packageRoot": "packages/skills/installed/scp/drugsda-p2rank",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge",
      "生命科学"
    ],
    "scpToolId": "68",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/68"
  },
  {
    "id": "scp.drugsda-peptide-sampling",
    "packageName": "@bioagent-skill/drugsda-peptide-sampling",
    "kind": "skill",
    "version": "1.0.0",
    "label": "drugsda-peptide-sampling",
    "description": "Design and generate novel therapeutic peptides using deep learning models, predicting secondary structure, stability, and target binding affinity for peptide drug discovery.",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/drugsda-peptide-sampling/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "structure-summary",
      "omics-differential-expression",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "drugsda peptide sampling",
      "design generate therapeutic peptides learning models predicting secondary",
      "Use drugsda peptide sampling and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/drugsda-peptide-sampling/SKILL.md",
      "agentSummary": "Design and generate novel therapeutic peptides using deep learning models, predicting secondary structure, stability, and target binding affinity for peptide drug discovery."
    },
    "packageRoot": "packages/skills/installed/scp/drugsda-peptide-sampling",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge",
      "多肽药物",
      "分子生成",
      "蛋白肽设计",
      "AI制药"
    ],
    "scpToolId": "201",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/drugsda-peptide-sampling"
  },
  {
    "id": "scp.drugsda-rgroup-sampling",
    "packageName": "@bioagent-skill/drugsda-rgroup-sampling",
    "kind": "skill",
    "version": "1.0.0",
    "label": "drugsda-rgroup-sampling",
    "description": "DrugSDA R-Group Sampling - Generate R-group substituents and scaffold modifications using generative AI models. Use this skill for lead optimization, structure-activity relationship exploration, and multi-objective molecular generation with specified attachment points.",
    "source": "package",
    "skillDomains": [
      "structure"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/drugsda-rgroup-sampling/SKILL.md"
    },
    "outputArtifactTypes": [
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "drugsda rgroup sampling",
      "drugsda sampling generate substituents scaffold modifications generative models",
      "Use drugsda rgroup sampling and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/drugsda-rgroup-sampling/SKILL.md",
      "agentSummary": "DrugSDA R-Group Sampling - Generate R-group substituents and scaffold modifications using generative AI models. Use this skill for lead optimization, structure-activity relationship exploration, and multi-objective molecular generation with specified attachment points."
    },
    "packageRoot": "packages/skills/installed/scp/drugsda-rgroup-sampling",
    "tags": [
      "package",
      "scp",
      "structure",
      "化学",
      "AI分子生成",
      "R-基团采样",
      "药物设计"
    ],
    "scpToolId": "drugsda-rgroup-sampling",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/drugsda-rgroup-sampling"
  },
  {
    "id": "scp.drugsda-target-retrieve",
    "packageName": "@bioagent-skill/drugsda-target-retrieve",
    "kind": "skill",
    "version": "1.0.0",
    "label": "DrugSDA Target Retrieve",
    "description": "Identify protein targets for drug molecules using similarity and binding prediction.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/drugsda-target-retrieve/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "drugsda target retrieve",
      "identify protein targets molecules similarity binding prediction",
      "Use drugsda target retrieve and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/drugsda-target-retrieve/SKILL.md",
      "agentSummary": "Identify protein targets for drug molecules using similarity and binding prediction."
    },
    "packageRoot": "packages/skills/installed/scp/drugsda-target-retrieve",
    "tags": [
      "package",
      "scp",
      "knowledge"
    ],
    "scpToolId": "drugsda-target-retrieve"
  },
  {
    "id": "scp.enetic_counseling_report",
    "packageName": "@bioagent-skill/enetic_counseling_report",
    "kind": "skill",
    "version": "1.0.0",
    "label": "enetic_counseling_report",
    "description": "Genetic Counseling Report - Generate genetic counseling reports: variant interpretation, inheritance patterns, recurrence risks, and clinical recommendations. Use this skill for clinical genetics tasks involving interpret variants determine inheritance calculate recurrence recommend clinically. Combines 4 tools from 2 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/enetic_counseling_report/SKILL.md"
    },
    "outputArtifactTypes": [
      "research-report",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "enetic counseling report",
      "genetic counseling report generate genetic counseling reports variant",
      "Use enetic counseling report and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/enetic_counseling_report/SKILL.md",
      "agentSummary": "Genetic Counseling Report - Generate genetic counseling reports: variant interpretation, inheritance patterns, recurrence risks, and clinical recommendations. Use this skill for clinical genetics tasks involving interpret variants determine inheritance calculate recurrence recommend clinically. Combines 4 tools from 2 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/enetic_counseling_report",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "生命科学",
      "临床遗传学"
    ],
    "scpToolId": "92",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/92"
  },
  {
    "id": "scp.ensembl-sequence-retrieval",
    "packageName": "@bioagent-skill/ensembl-sequence-retrieval",
    "kind": "skill",
    "version": "1.0.0",
    "label": "ensembl-sequence-retrieval",
    "description": "Retrieve DNA, RNA, and protein sequences from Ensembl database for any species and gene region.",
    "source": "package",
    "skillDomains": [
      "omics",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/ensembl-sequence-retrieval/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "ensembl sequence retrieval",
      "retrieve protein sequences ensembl database species region",
      "Use ensembl sequence retrieval and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/ensembl-sequence-retrieval/SKILL.md",
      "agentSummary": "Retrieve DNA, RNA, and protein sequences from Ensembl database for any species and gene region."
    },
    "packageRoot": "packages/skills/installed/scp/ensembl-sequence-retrieval",
    "tags": [
      "package",
      "scp",
      "omics",
      "knowledge",
      "生命科学"
    ],
    "scpToolId": "76",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/76"
  },
  {
    "id": "scp.enzyme-inhibitor-design",
    "packageName": "@bioagent-skill/enzyme-inhibitor-design",
    "kind": "skill",
    "version": "1.0.0",
    "label": "Enzyme Inhibitor Design",
    "description": "Design and optimize enzyme inhibitors for therapeutic applications. Supports competitive, non-competitive, and allosteric inhibitor screening with Ki/Km analysis.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/enzyme_inhibitor_design/SKILL.md"
    },
    "outputArtifactTypes": [
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "enzyme inhibitor design",
      "design optimize enzyme inhibitors therapeutic applications supports competitive",
      "Use enzyme inhibitor design and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/enzyme_inhibitor_design/SKILL.md",
      "agentSummary": "Design and optimize enzyme inhibitors for therapeutic applications. Supports competitive, non-competitive, and allosteric inhibitor screening with Ki/Km analysis."
    },
    "packageRoot": "packages/skills/installed/scp/enzyme_inhibitor_design",
    "tags": [
      "package",
      "scp",
      "knowledge"
    ],
    "scpToolId": "enzyme_inhibitor_design"
  },
  {
    "id": "scp.epigenetics_drug",
    "packageName": "@bioagent-skill/epigenetics_drug",
    "kind": "skill",
    "version": "1.0.0",
    "label": "epigenetics_drug",
    "description": "Epigenetics Drug Analysis - Analyze epigenetic drugs: histone modification targeting, DNA methylation patterns, epigenetic enzyme inhibition, and chromatin remodeling. Use this skill for epigenomics tasks involving get histone targets get methylation patterns get enzyme inhibition get chromatin analysis. Combines 4 tools from 2 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "omics",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/epigenetics_drug/SKILL.md"
    },
    "outputArtifactTypes": [
      "omics-differential-expression",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "epigenetics drug",
      "epigenetics analysis analyze epigenetic histone modification targeting methylation",
      "Use epigenetics drug and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/epigenetics_drug/SKILL.md",
      "agentSummary": "Epigenetics Drug Analysis - Analyze epigenetic drugs: histone modification targeting, DNA methylation patterns, epigenetic enzyme inhibition, and chromatin remodeling. Use this skill for epigenomics tasks involving get histone targets get methylation patterns get enzyme inhibition get chromatin analysis. Combines 4 tools from 2 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/epigenetics_drug",
    "tags": [
      "package",
      "scp",
      "omics",
      "knowledge",
      "生命科学",
      "表观基因组学"
    ],
    "scpToolId": "79",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/79"
  },
  {
    "id": "scp.example-bio-chem-tool",
    "packageName": "@bioagent-skill/example-bio-chem-tool",
    "kind": "skill",
    "version": "1.0.0",
    "label": "Example Bio-Chem Tool",
    "description": "Example biochemistry tool template for SCP Hub local skill development. Demonstrates the standard SKILL.md structure with frontmatter, MCP invocation schema, and local description format.",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/example-bio-chem-tool/SKILL.md"
    },
    "outputArtifactTypes": [
      "structure-summary"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "example bio chem tool",
      "example biochemistry template development demonstrates standard structure frontmatter",
      "Use example bio chem tool and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/example-bio-chem-tool/SKILL.md",
      "agentSummary": "Example biochemistry tool template for SCP Hub local skill development. Demonstrates the standard SKILL.md structure with frontmatter, MCP invocation schema, and local description format."
    },
    "packageRoot": "packages/skills/installed/scp/example-bio-chem-tool",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge"
    ],
    "scpToolId": "example-bio-chem-tool"
  },
  {
    "id": "scp.fda-drug-risk-assessment",
    "packageName": "@bioagent-skill/fda-drug-risk-assessment",
    "kind": "skill",
    "version": "1.0.0",
    "label": "fda-drug-risk-assessment",
    "description": "FDA Drug Risk Assessment - Assess drug risks from FDA data: black box warnings, adverse event reports, recall history, and safety communications. Use this skill for pharmacovigilance tasks involving get black box warnings get adverse events get recall history get safety communications. Combines 4 tools from 1 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/fda-drug-risk-assessment/SKILL.md"
    },
    "outputArtifactTypes": [
      "research-report",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "fda drug risk assessment",
      "assessment assess warnings adverse reports recall history safety",
      "Use fda drug risk assessment and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/fda-drug-risk-assessment/SKILL.md",
      "agentSummary": "FDA Drug Risk Assessment - Assess drug risks from FDA data: black box warnings, adverse event reports, recall history, and safety communications. Use this skill for pharmacovigilance tasks involving get black box warnings get adverse events get recall history get safety communications. Combines 4 tools from 1 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/fda-drug-risk-assessment",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "生命科学"
    ],
    "scpToolId": "81",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/81"
  },
  {
    "id": "scp.full_protein_analysis",
    "packageName": "@bioagent-skill/full_protein_analysis",
    "kind": "skill",
    "version": "1.0.0",
    "label": "full_protein_analysis",
    "description": "Full Protein Analysis - Comprehensive protein sequence and structure analysis including functional annotation, domain identification, post-translational modification prediction, and variant impact assessment. Use this skill for complete protein characterization combining multiple bioinformatics tools.",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/full_protein_analysis/SKILL.md"
    },
    "outputArtifactTypes": [
      "research-report",
      "sequence-alignment",
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "full protein analysis",
      "protein analysis comprehensive protein sequence structure analysis including",
      "Use full protein analysis and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/full_protein_analysis/SKILL.md",
      "agentSummary": "Full Protein Analysis - Comprehensive protein sequence and structure analysis including functional annotation, domain identification, post-translational modification prediction, and variant impact assessment. Use this skill for complete protein characterization combining multiple bioinformatics tools."
    },
    "packageRoot": "packages/skills/installed/scp/full_protein_analysis",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge",
      "生命科学",
      "蛋白质分析",
      "功能注释",
      "结构预测"
    ],
    "scpToolId": "full_protein_analysis",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/full_protein_analysis"
  },
  {
    "id": "scp.functional_group_profiling",
    "packageName": "@bioagent-skill/functional_group_profiling",
    "kind": "skill",
    "version": "1.0.0",
    "label": "functional_group_profiling",
    "description": "Functional Group Profiling - Profile functional groups: radical assignment, H-bond analysis, aromaticity, and abbreviation condensation. Use this skill for organic chemistry tasks involving AssignRadicals GetHBANum AromaticityAnalyzer CondenseAbbreviationSubstanceGroups. Combines 4 tools from 2 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/functional_group_profiling/SKILL.md"
    },
    "outputArtifactTypes": [
      "structure-summary"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "functional group profiling",
      "functional profiling profile functional groups radical assignment analysis",
      "Use functional group profiling and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/functional_group_profiling/SKILL.md",
      "agentSummary": "Functional Group Profiling - Profile functional groups: radical assignment, H-bond analysis, aromaticity, and abbreviation condensation. Use this skill for organic chemistry tasks involving AssignRadicals GetHBANum AromaticityAnalyzer CondenseAbbreviationSubstanceGroups. Combines 4 tools from 2 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/functional_group_profiling",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "化学",
      "有机化学"
    ],
    "scpToolId": "83",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/83"
  },
  {
    "id": "scp.gene_disease_association",
    "packageName": "@bioagent-skill/gene_disease_association",
    "kind": "skill",
    "version": "1.0.0",
    "label": "gene_disease_association",
    "description": "Gene-Disease Association - Explore and analyze associations between genes and diseases. Use this skill for tasks involving disease gene mapping, phenotype-gene linking, GWAS target prioritization, and pathogenicity screening. Combines multiple SCP servers for genomics and clinical genetics analysis.",
    "source": "package",
    "skillDomains": [
      "literature",
      "omics",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/gene_disease_association/SKILL.md"
    },
    "outputArtifactTypes": [
      "paper-list",
      "evidence-matrix",
      "research-report",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "gene disease association",
      "disease association explore analyze associations between diseases involving",
      "Use gene disease association and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/gene_disease_association/SKILL.md",
      "agentSummary": "Gene-Disease Association - Explore and analyze associations between genes and diseases. Use this skill for tasks involving disease gene mapping, phenotype-gene linking, GWAS target prioritization, and pathogenicity screening. Combines multiple SCP servers for genomics and clinical genetics analysis."
    },
    "packageRoot": "packages/skills/installed/scp/gene_disease_association",
    "tags": [
      "package",
      "scp",
      "literature",
      "omics",
      "knowledge",
      "生命科学",
      "基因组学",
      "疾病关联"
    ],
    "scpToolId": "gene_disease_association",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/gene_disease_association"
  },
  {
    "id": "scp.gene_family_evolution",
    "packageName": "@bioagent-skill/gene_family_evolution",
    "kind": "skill",
    "version": "1.0.0",
    "label": "gene_family_evolution",
    "description": "Gene Family Evolution Analysis - Analyze gene family evolution: CAFE gene tree, homology, Ensembl gene tree, and taxonomy. Use this skill for molecular evolution tasks involving get cafe genetree member symbol get homology symbol get genetree member symbol get taxonomy classification. Combines 4 tools from 1 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/gene_family_evolution/SKILL.md"
    },
    "outputArtifactTypes": [
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "gene family evolution",
      "family evolution analysis analyze family evolution homology ensembl",
      "Use gene family evolution and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/gene_family_evolution/SKILL.md",
      "agentSummary": "Gene Family Evolution Analysis - Analyze gene family evolution: CAFE gene tree, homology, Ensembl gene tree, and taxonomy. Use this skill for molecular evolution tasks involving get cafe genetree member symbol get homology symbol get genetree member symbol get taxonomy classification. Combines 4 tools from 1 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/gene_family_evolution",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "生命科学",
      "分子进化学"
    ],
    "scpToolId": "88",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/88"
  },
  {
    "id": "scp.gene_therapy_target",
    "packageName": "@bioagent-skill/gene_therapy_target",
    "kind": "skill",
    "version": "1.0.0",
    "label": "gene_therapy_target",
    "description": "Gene Therapy Target Identification - Identify gene therapy targets: disease gene prioritization, delivery vector selection, off-target analysis, and efficacy prediction. Use this skill for gene therapy tasks involving prioritize genes select vectors analyze off-targets predict efficacy. Combines 4 tools from 2 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/gene_therapy_target/SKILL.md"
    },
    "outputArtifactTypes": [
      "evidence-matrix",
      "sequence-alignment",
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "gene therapy target",
      "therapy target identification identify therapy targets disease prioritization",
      "Use gene therapy target and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/gene_therapy_target/SKILL.md",
      "agentSummary": "Gene Therapy Target Identification - Identify gene therapy targets: disease gene prioritization, delivery vector selection, off-target analysis, and efficacy prediction. Use this skill for gene therapy tasks involving prioritize genes select vectors analyze off-targets predict efficacy. Combines 4 tools from 2 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/gene_therapy_target",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge",
      "生命科学",
      "基因治疗"
    ],
    "scpToolId": "89",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/89"
  },
  {
    "id": "scp.genome-annotation",
    "packageName": "@bioagent-skill/genome-annotation",
    "kind": "skill",
    "version": "1.0.0",
    "label": "Genome Annotation",
    "description": "Perform automated genome annotation by identifying and classifying genomic features including genes, exons, introns, promoters, regulatory regions, and other functional elements. Supports both prokaryotic and eukaryotic genome annotation workflows.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/genome_annotation/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "genome annotation",
      "perform automated genome annotation identifying classifying genomic features",
      "Use genome annotation and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/genome_annotation/SKILL.md",
      "agentSummary": "Perform automated genome annotation by identifying and classifying genomic features including genes, exons, introns, promoters, regulatory regions, and other functional elements. Supports both prokaryotic and eukaryotic genome annotation workflows."
    },
    "packageRoot": "packages/skills/installed/scp/genome_annotation",
    "tags": [
      "package",
      "scp",
      "knowledge"
    ],
    "scpToolId": "genome_annotation"
  },
  {
    "id": "scp.go-term-analysis",
    "packageName": "@bioagent-skill/go-term-analysis",
    "kind": "skill",
    "version": "1.0.0",
    "label": "GO Term Analysis",
    "description": "Perform Gene Ontology enrichment analysis and functional annotation. Supports GO Slim mapping, pathway enrichment, and gene set analysis for genomics datasets.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/go_term_analysis/SKILL.md"
    },
    "outputArtifactTypes": [
      "research-report",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "go term analysis",
      "perform ontology enrichment analysis functional annotation supports mapping",
      "Use go term analysis and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/go_term_analysis/SKILL.md",
      "agentSummary": "Perform Gene Ontology enrichment analysis and functional annotation. Supports GO Slim mapping, pathway enrichment, and gene set analysis for genomics datasets."
    },
    "packageRoot": "packages/skills/installed/scp/go_term_analysis",
    "tags": [
      "package",
      "scp",
      "knowledge"
    ],
    "scpToolId": "go_term_analysis"
  },
  {
    "id": "scp.infectious_disease_analysis",
    "packageName": "@bioagent-skill/infectious_disease_analysis",
    "kind": "skill",
    "version": "1.0.0",
    "label": "infectious_disease_analysis",
    "description": "Infectious Disease Analysis - Analyze infectious diseases: pathogen identification, transmission tracking, antimicrobial resistance, and outbreak prediction. Use this skill for infectious disease tasks involving identify pathogens track transmission monitor resistance predict outbreaks. Combines 4 tools from 2 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "literature",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/infectious_disease_analysis/SKILL.md"
    },
    "outputArtifactTypes": [
      "paper-list",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "infectious disease analysis",
      "infectious disease analysis analyze infectious diseases pathogen identification",
      "Use infectious disease analysis and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/infectious_disease_analysis/SKILL.md",
      "agentSummary": "Infectious Disease Analysis - Analyze infectious diseases: pathogen identification, transmission tracking, antimicrobial resistance, and outbreak prediction. Use this skill for infectious disease tasks involving identify pathogens track transmission monitor resistance predict outbreaks. Combines 4 tools from 2 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/infectious_disease_analysis",
    "tags": [
      "package",
      "scp",
      "literature",
      "knowledge",
      "生命科学",
      "感染性疾病"
    ],
    "scpToolId": "97",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/97"
  },
  {
    "id": "scp.interproscan-domain-analysis",
    "packageName": "@bioagent-skill/interproscan-domain-analysis",
    "kind": "skill",
    "version": "1.0.0",
    "label": "interproscan-domain-analysis",
    "description": "Analyze protein sequences for functional domains using InterProScan database and prediction tools.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/interproscan-domain-analysis/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "interproscan domain analysis",
      "analyze protein sequences functional domains interproscan database prediction",
      "Use interproscan domain analysis and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/interproscan-domain-analysis/SKILL.md",
      "agentSummary": "Analyze protein sequences for functional domains using InterProScan database and prediction tools."
    },
    "packageRoot": "packages/skills/installed/scp/interproscan-domain-analysis",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "生命科学"
    ],
    "scpToolId": "98",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/98"
  },
  {
    "id": "scp.interproscan-pipeline",
    "packageName": "@bioagent-skill/interproscan-pipeline",
    "kind": "skill",
    "version": "1.0.0",
    "label": "InterProScan Pipeline",
    "description": "Predict protein domain families and functional annotation using InterProScan. Input a protein sequence and receive domain architecture, Gene Ontology (GO) terms, pathway annotations, and cross-references to protein databases including Pfam, SMART, PANTHER, and CDD.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/interproscan_pipeline/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "interproscan pipeline",
      "predict protein domain families functional annotation interproscan protein",
      "Use interproscan pipeline and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/interproscan_pipeline/SKILL.md",
      "agentSummary": "Predict protein domain families and functional annotation using InterProScan. Input a protein sequence and receive domain architecture, Gene Ontology (GO) terms, pathway annotations, and cross-references to protein databases including Pfam, SMART, PANTHER, and CDD."
    },
    "packageRoot": "packages/skills/installed/scp/interproscan_pipeline",
    "tags": [
      "package",
      "scp",
      "knowledge"
    ],
    "scpToolId": "interproscan_pipeline"
  },
  {
    "id": "scp.kegg-gene-search",
    "packageName": "@bioagent-skill/kegg-gene-search",
    "kind": "skill",
    "version": "1.0.0",
    "label": "KEGG Gene Search",
    "description": "Query and retrieve gene information from the Kyoto Encyclopedia of Genes and Genomes (KEGG) database. Search genes by identifier, pathway, or function and retrieve associated information including orthologs, enzymes, pathways, and disease associations.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/kegg-gene-search/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "kegg gene search",
      "retrieve information encyclopedia genomes database search identifier pathway",
      "Use kegg gene search and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/kegg-gene-search/SKILL.md",
      "agentSummary": "Query and retrieve gene information from the Kyoto Encyclopedia of Genes and Genomes (KEGG) database. Search genes by identifier, pathway, or function and retrieve associated information including orthologs, enzymes, pathways, and disease associations."
    },
    "packageRoot": "packages/skills/installed/scp/kegg-gene-search",
    "tags": [
      "package",
      "scp",
      "knowledge"
    ],
    "scpToolId": "kegg-gene-search"
  },
  {
    "id": "scp.lead_compound_optimization",
    "packageName": "@bioagent-skill/lead_compound_optimization",
    "kind": "skill",
    "version": "1.0.0",
    "label": "lead_compound_optimization",
    "description": "Lead Compound Optimization - Optimize lead compounds through iterative medicinal chemistry modifications guided by structure-activity relationships. Use this skill for drug discovery tasks involving SAR analysis pharmacophore modeling molecular modification bioisosteric replacement. Transform hits to leads with improved potency and ADMET properties.",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/lead_compound_optimization/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "lead compound optimization",
      "compound optimization optimize compounds through iterative medicinal chemistry",
      "Use lead compound optimization and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/lead_compound_optimization/SKILL.md",
      "agentSummary": "Lead Compound Optimization - Optimize lead compounds through iterative medicinal chemistry modifications guided by structure-activity relationships. Use this skill for drug discovery tasks involving SAR analysis pharmacophore modeling molecular modification bioisosteric replacement. Transform hits to leads with improved potency and ADMET properties."
    },
    "packageRoot": "packages/skills/installed/scp/lead_compound_optimization",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge",
      "化学",
      "先导优化",
      "药物设计"
    ],
    "scpToolId": "115",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/lead_compound_optimization"
  },
  {
    "id": "scp.metabolomics_pathway",
    "packageName": "@bioagent-skill/metabolomics_pathway",
    "kind": "skill",
    "version": "1.0.0",
    "label": "metabolomics_pathway",
    "description": "Metabolomics Pathway Analysis - Analyze metabolomics: compound identification, KEGG pathway mapping, enzyme linking, and PubChem data. Use this skill for metabolomics tasks involving kegg find kegg link kegg get pubchem search by name. Combines 4 tools from 2 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "omics",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/metabolomics_pathway/SKILL.md"
    },
    "outputArtifactTypes": [
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "metabolomics pathway",
      "metabolomics pathway analysis analyze metabolomics compound identification pathway",
      "Use metabolomics pathway and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/metabolomics_pathway/SKILL.md",
      "agentSummary": "Metabolomics Pathway Analysis - Analyze metabolomics: compound identification, KEGG pathway mapping, enzyme linking, and PubChem data. Use this skill for metabolomics tasks involving kegg find kegg link kegg get pubchem search by name. Combines 4 tools from 2 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/metabolomics_pathway",
    "tags": [
      "package",
      "scp",
      "omics",
      "knowledge",
      "生命科学",
      "代谢组学"
    ],
    "scpToolId": "107",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/107"
  },
  {
    "id": "scp.molecular_docking_pipeline",
    "packageName": "@bioagent-skill/molecular_docking_pipeline",
    "kind": "skill",
    "version": "1.0.0",
    "label": "molecular_docking_pipeline",
    "description": "Molecular Docking Pipeline - Dock molecules to proteins: structure preparation, binding site identification, docking simulation, and affinity prediction. Use this skill for structural biology tasks involving prepare structure identify site simulate docking predict affinity. Combines 4 tools from 2 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/molecular_docking_pipeline/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "molecular docking pipeline",
      "molecular docking pipeline molecules proteins structure preparation binding",
      "Use molecular docking pipeline and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/molecular_docking_pipeline/SKILL.md",
      "agentSummary": "Molecular Docking Pipeline - Dock molecules to proteins: structure preparation, binding site identification, docking simulation, and affinity prediction. Use this skill for structural biology tasks involving prepare structure identify site simulate docking predict affinity. Combines 4 tools from 2 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/molecular_docking_pipeline",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge",
      "生命科学",
      "结构生物学"
    ],
    "scpToolId": "115",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/115"
  },
  {
    "id": "scp.molecular_fingerprint_analysis",
    "packageName": "@bioagent-skill/molecular_fingerprint_analysis",
    "kind": "skill",
    "version": "1.0.0",
    "label": "molecular_fingerprint_analysis",
    "description": "Molecular Fingerprint Analysis - Analyze molecular fingerprints: Morgan fingerprints, MACCS keys, topological fingerprints, and pharmacophore patterns. Use this skill for cheminformatics tasks involving generate morgan generate maccs generate topological analyze pharmacophore. Combines 4 tools from 1 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/molecular_fingerprint_analysis/SKILL.md"
    },
    "outputArtifactTypes": [
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "molecular fingerprint analysis",
      "molecular fingerprint analysis analyze molecular fingerprints morgan fingerprints",
      "Use molecular fingerprint analysis and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/molecular_fingerprint_analysis/SKILL.md",
      "agentSummary": "Molecular Fingerprint Analysis - Analyze molecular fingerprints: Morgan fingerprints, MACCS keys, topological fingerprints, and pharmacophore patterns. Use this skill for cheminformatics tasks involving generate morgan generate maccs generate topological analyze pharmacophore. Combines 4 tools from 1 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/molecular_fingerprint_analysis",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge",
      "化学",
      "化学信息学"
    ],
    "scpToolId": "116",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/116"
  },
  {
    "id": "scp.molecular_visualization_suite",
    "packageName": "@bioagent-skill/molecular_visualization_suite",
    "kind": "skill",
    "version": "1.0.0",
    "label": "molecular_visualization_suite",
    "description": "Molecular Visualization Suite - Visualize molecules: SMILES to formats, molecular visualization, protein visualization, complex visualization. Use this skill for chemistry visualization tasks involving smiles to format visualize molecule visualize protein visualize complex. Combines 4 tools from 1 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/molecular_visualization_suite/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "molecular visualization suite",
      "molecular visualization visualize molecules smiles formats molecular visualization",
      "Use molecular visualization suite and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/molecular_visualization_suite/SKILL.md",
      "agentSummary": "Molecular Visualization Suite - Visualize molecules: SMILES to formats, molecular visualization, protein visualization, complex visualization. Use this skill for chemistry visualization tasks involving smiles to format visualize molecule visualize protein visualize complex. Combines 4 tools from 1 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/molecular_visualization_suite",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge",
      "化学",
      "化学可视化"
    ],
    "scpToolId": "117",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/117"
  },
  {
    "id": "scp.molecular-descriptors-calculation",
    "packageName": "@bioagent-skill/molecular-descriptors-calculation",
    "kind": "skill",
    "version": "1.0.0",
    "label": "molecular-descriptors-calculation",
    "description": "Calculate advanced molecular descriptors including QSAR and shape indices, connectivity indices, and structural features for drug discovery.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/molecular-descriptors-calculation/SKILL.md"
    },
    "outputArtifactTypes": [
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "molecular descriptors calculation",
      "calculate advanced molecular descriptors including indices connectivity indices",
      "Use molecular descriptors calculation and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/molecular-descriptors-calculation/SKILL.md",
      "agentSummary": "Calculate advanced molecular descriptors including QSAR and shape indices, connectivity indices, and structural features for drug discovery."
    },
    "packageRoot": "packages/skills/installed/scp/molecular-descriptors-calculation",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "化学"
    ],
    "scpToolId": "110",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/110"
  },
  {
    "id": "scp.molecular-docking",
    "packageName": "@bioagent-skill/molecular-docking",
    "kind": "skill",
    "version": "1.0.0",
    "label": "molecular-docking",
    "description": "Molecular docking tool for predicting binding modes and affinity between small molecules and protein targets.",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/molecular-docking/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "molecular docking",
      "molecular docking predicting binding affinity between molecules protein",
      "Use molecular docking and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/molecular-docking/SKILL.md",
      "agentSummary": "Molecular docking tool for predicting binding modes and affinity between small molecules and protein targets."
    },
    "packageRoot": "packages/skills/installed/scp/molecular-docking",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge",
      "化学",
      "分子对接",
      "药物发现"
    ],
    "scpToolId": "32",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/molecular-docking"
  },
  {
    "id": "scp.molecular-properties-calculation",
    "packageName": "@bioagent-skill/molecular-properties-calculation",
    "kind": "skill",
    "version": "1.0.0",
    "label": "molecular-properties-calculation",
    "description": "Calculate basic molecular properties from SMILES including molecular weight, formula, atom count, and exact mass.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/molecular-properties-calculation/SKILL.md"
    },
    "outputArtifactTypes": [
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "molecular properties calculation",
      "calculate molecular properties smiles including molecular weight formula",
      "Use molecular properties calculation and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/molecular-properties-calculation/SKILL.md",
      "agentSummary": "Calculate basic molecular properties from SMILES including molecular weight, formula, atom count, and exact mass."
    },
    "packageRoot": "packages/skills/installed/scp/molecular-properties-calculation",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "化学"
    ],
    "scpToolId": "112",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/112"
  },
  {
    "id": "scp.molecular-property-profiling",
    "packageName": "@bioagent-skill/molecular-property-profiling",
    "kind": "skill",
    "version": "1.0.0",
    "label": "molecular-property-profiling",
    "description": "Comprehensive molecular property analysis covering basic info, hydrophobicity, hydrogen bonding, structural complexity, topology, drug-likeness, charge distribution, and complexity metrics.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/molecular-property-profiling/SKILL.md"
    },
    "outputArtifactTypes": [
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "molecular property profiling",
      "comprehensive molecular property analysis covering hydrophobicity hydrogen bonding",
      "Use molecular property profiling and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/molecular-property-profiling/SKILL.md",
      "agentSummary": "Comprehensive molecular property analysis covering basic info, hydrophobicity, hydrogen bonding, structural complexity, topology, drug-likeness, charge distribution, and complexity metrics."
    },
    "packageRoot": "packages/skills/installed/scp/molecular-property-profiling",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "化学"
    ],
    "scpToolId": "113",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/113"
  },
  {
    "id": "scp.molecular-similarity-search",
    "packageName": "@bioagent-skill/molecular-similarity-search",
    "kind": "skill",
    "version": "1.0.0",
    "label": "molecular-similarity-search",
    "description": "Search similar molecules using Tanimoto similarity with Morgan fingerprints to identify structurally related compounds.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/molecular-similarity-search/SKILL.md"
    },
    "outputArtifactTypes": [
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "molecular similarity search",
      "search similar molecules tanimoto similarity morgan fingerprints identify",
      "Use molecular similarity search and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/molecular-similarity-search/SKILL.md",
      "agentSummary": "Search similar molecules using Tanimoto similarity with Morgan fingerprints to identify structurally related compounds."
    },
    "packageRoot": "packages/skills/installed/scp/molecular-similarity-search",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "化学"
    ],
    "scpToolId": "114",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/114"
  },
  {
    "id": "scp.mouse_model_analysis",
    "packageName": "@bioagent-skill/mouse_model_analysis",
    "kind": "skill",
    "version": "1.0.0",
    "label": "mouse_model_analysis",
    "description": "Mouse Model Analysis - Analyze mouse models: phenotype data, genetic modifications, disease relevance, and translational potential. Use this skill for model biology tasks involving get phenotype data get genetic mods get disease relevance assess translation. Combines 4 tools from 2 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/mouse_model_analysis/SKILL.md"
    },
    "outputArtifactTypes": [
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "mouse model analysis",
      "analysis analyze models phenotype genetic modifications disease relevance",
      "Use mouse model analysis and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/mouse_model_analysis/SKILL.md",
      "agentSummary": "Mouse Model Analysis - Analyze mouse models: phenotype data, genetic modifications, disease relevance, and translational potential. Use this skill for model biology tasks involving get phenotype data get genetic mods get disease relevance assess translation. Combines 4 tools from 2 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/mouse_model_analysis",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "生命科学",
      "模式生物学"
    ],
    "scpToolId": "118",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/118"
  },
  {
    "id": "scp.multispecies_gene_analysis",
    "packageName": "@bioagent-skill/multispecies_gene_analysis",
    "kind": "skill",
    "version": "1.0.0",
    "label": "multispecies_gene_analysis",
    "description": "Multispecies Gene Analysis - Analyze genes across species: orthology mapping, conservation analysis, expression profiling, and functional annotation. Use this skill for molecular biology tasks involving map orthology analyze conservation profile expression annotate function. Combines 4 tools from 2 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "omics",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/multispecies_gene_analysis/SKILL.md"
    },
    "outputArtifactTypes": [
      "omics-differential-expression",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "multispecies gene analysis",
      "multispecies analysis analyze across species orthology mapping conservation",
      "Use multispecies gene analysis and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/multispecies_gene_analysis/SKILL.md",
      "agentSummary": "Multispecies Gene Analysis - Analyze genes across species: orthology mapping, conservation analysis, expression profiling, and functional annotation. Use this skill for molecular biology tasks involving map orthology analyze conservation profile expression annotate function. Combines 4 tools from 2 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/multispecies_gene_analysis",
    "tags": [
      "package",
      "scp",
      "omics",
      "knowledge",
      "生命科学",
      "分子生物学"
    ],
    "scpToolId": "120",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/120"
  },
  {
    "id": "scp.natural_product_analysis",
    "packageName": "@bioagent-skill/natural_product_analysis",
    "kind": "skill",
    "version": "1.0.0",
    "label": "natural_product_analysis",
    "description": "Natural Product Analysis - Analyze natural products: name-to-SMILES, PubChem lookup, structural analysis, and KEGG natural product search. Use this skill for natural product chemistry tasks involving NameToSMILES ChemicalStructureAnalyzer kegg find pubchem search by name. Combines 4 tools from 4 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/natural_product_analysis/SKILL.md"
    },
    "outputArtifactTypes": [
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "natural product analysis",
      "natural product analysis analyze natural products smiles pubchem",
      "Use natural product analysis and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/natural_product_analysis/SKILL.md",
      "agentSummary": "Natural Product Analysis - Analyze natural products: name-to-SMILES, PubChem lookup, structural analysis, and KEGG natural product search. Use this skill for natural product chemistry tasks involving NameToSMILES ChemicalStructureAnalyzer kegg find pubchem search by name. Combines 4 tools from 4 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/natural_product_analysis",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge",
      "化学",
      "天然产物化学"
    ],
    "scpToolId": "121",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/121"
  },
  {
    "id": "scp.ncbi_gene_deep_dive",
    "packageName": "@bioagent-skill/ncbi_gene_deep_dive",
    "kind": "skill",
    "version": "1.0.0",
    "label": "ncbi_gene_deep_dive",
    "description": "NCBI Gene Deep Dive - Deep dive into gene data: comprehensive retrieval, pathway involvement, disease associations, and literature mining. Use this skill for gene biology tasks involving get comprehensive gene data get pathway involvement get disease associations mine literature. Combines 4 tools from 1 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "literature",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/ncbi_gene_deep_dive/SKILL.md"
    },
    "outputArtifactTypes": [
      "paper-list",
      "research-report",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "ncbi gene deep dive",
      "comprehensive retrieval pathway involvement disease associations literature mining",
      "Use ncbi gene deep dive and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/ncbi_gene_deep_dive/SKILL.md",
      "agentSummary": "NCBI Gene Deep Dive - Deep dive into gene data: comprehensive retrieval, pathway involvement, disease associations, and literature mining. Use this skill for gene biology tasks involving get comprehensive gene data get pathway involvement get disease associations mine literature. Combines 4 tools from 1 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/ncbi_gene_deep_dive",
    "tags": [
      "package",
      "scp",
      "literature",
      "knowledge",
      "生命科学",
      "基因生物学"
    ],
    "scpToolId": "123",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/123"
  },
  {
    "id": "scp.ncbi-gene-retrieval",
    "packageName": "@bioagent-skill/ncbi-gene-retrieval",
    "kind": "skill",
    "version": "1.0.0",
    "label": "ncbi-gene-retrieval",
    "description": "Retrieve gene information from NCBI including sequences, aliases, summaries, and genomic location.",
    "source": "package",
    "skillDomains": [
      "omics",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/ncbi-gene-retrieval/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "omics-differential-expression",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "ncbi gene retrieval",
      "retrieve information including sequences aliases summaries genomic location",
      "Use ncbi gene retrieval and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/ncbi-gene-retrieval/SKILL.md",
      "agentSummary": "Retrieve gene information from NCBI including sequences, aliases, summaries, and genomic location."
    },
    "packageRoot": "packages/skills/installed/scp/ncbi-gene-retrieval",
    "tags": [
      "package",
      "scp",
      "omics",
      "knowledge",
      "生命科学"
    ],
    "scpToolId": "122",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/122"
  },
  {
    "id": "scp.one_health_analysis",
    "packageName": "@bioagent-skill/one_health_analysis",
    "kind": "skill",
    "version": "1.0.0",
    "label": "one_health_analysis",
    "description": "One Health Pathogen Analysis - One Health analysis: pathogen genomes, cross-species gene comparisons, antimicrobial drugs, and environmental context. Use this skill for one health tasks involving get genomic dataset report by taxonomy get homology symbol by drug name get mechanism of action get quick search get taxonomy. Combines 5 tools from 4 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/one_health_analysis/SKILL.md"
    },
    "outputArtifactTypes": [
      "research-report",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "one health analysis",
      "health pathogen analysis health analysis pathogen genomes species",
      "Use one health analysis and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/one_health_analysis/SKILL.md",
      "agentSummary": "One Health Pathogen Analysis - One Health analysis: pathogen genomes, cross-species gene comparisons, antimicrobial drugs, and environmental context. Use this skill for one health tasks involving get genomic dataset report by taxonomy get homology symbol by drug name get mechanism of action get quick search get taxonomy. Combines 5 tools from 4 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/one_health_analysis",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "生命科学",
      "同一健康"
    ],
    "scpToolId": "126",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/126"
  },
  {
    "id": "scp.opentargets-disease-target",
    "packageName": "@bioagent-skill/opentargets-disease-target",
    "kind": "skill",
    "version": "1.0.0",
    "label": "opentargets-disease-target",
    "description": "Use disease EFO ID to retrieve disease-related targets from OpenTargets to identify therapeutic targets.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/opentargets-disease-target/SKILL.md"
    },
    "outputArtifactTypes": [
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "opentargets disease target",
      "disease retrieve disease related targets opentargets identify therapeutic",
      "Use opentargets disease target and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/opentargets-disease-target/SKILL.md",
      "agentSummary": "Use disease EFO ID to retrieve disease-related targets from OpenTargets to identify therapeutic targets."
    },
    "packageRoot": "packages/skills/installed/scp/opentargets-disease-target",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "生命科学"
    ],
    "scpToolId": "127",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/127"
  },
  {
    "id": "scp.organism_classification",
    "packageName": "@bioagent-skill/organism_classification",
    "kind": "skill",
    "version": "1.0.0",
    "label": "organism_classification",
    "description": "Organism Classification Database - Classify organisms: NCBI taxonomy, Ensembl classification, ChEMBL organisms, and genomic information. Use this skill for taxonomy tasks involving get taxonomy get taxonomy ID get organism by taxonomy ID get genomic dataset report by taxonomy. Combines 4 tools from 3 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/organism_classification/SKILL.md"
    },
    "outputArtifactTypes": [
      "research-report"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "organism classification",
      "organism classification database classify organisms taxonomy ensembl classification",
      "Use organism classification and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/organism_classification/SKILL.md",
      "agentSummary": "Organism Classification Database - Classify organisms: NCBI taxonomy, Ensembl classification, ChEMBL organisms, and genomic information. Use this skill for taxonomy tasks involving get taxonomy get taxonomy ID get organism by taxonomy ID get genomic dataset report by taxonomy. Combines 4 tools from 3 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/organism_classification",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "生命科学",
      "分类学"
    ],
    "scpToolId": "130",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/130"
  },
  {
    "id": "scp.orphan_drug_analysis",
    "packageName": "@bioagent-skill/orphan_drug_analysis",
    "kind": "skill",
    "version": "1.0.0",
    "label": "orphan_drug_analysis",
    "description": "Orphan Drug and Rare Disease Analysis - Analyze orphan drugs: Monarch disease phenotypes, OpenTargets targets, FDA drug data, and clinical studies. Use this skill for orphan drug development tasks involving get joint related disease by HPO ID list get related targets by disease EFO ID get clinical study info by drug name pubmed search. Combines 4 tools from 4 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "literature",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/orphan_drug_analysis/SKILL.md"
    },
    "outputArtifactTypes": [
      "paper-list",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "orphan drug analysis",
      "orphan disease analysis analyze orphan monarch disease phenotypes",
      "Use orphan drug analysis and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/orphan_drug_analysis/SKILL.md",
      "agentSummary": "Orphan Drug and Rare Disease Analysis - Analyze orphan drugs: Monarch disease phenotypes, OpenTargets targets, FDA drug data, and clinical studies. Use this skill for orphan drug development tasks involving get joint related disease by HPO ID list get related targets by disease EFO ID get clinical study info by drug name pubmed search. Combines 4 tools from 4 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/orphan_drug_analysis",
    "tags": [
      "package",
      "scp",
      "literature",
      "knowledge",
      "生命科学",
      "孤儿药研发"
    ],
    "scpToolId": "131",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/131"
  },
  {
    "id": "scp.pandemic_preparedness",
    "packageName": "@bioagent-skill/pandemic_preparedness",
    "kind": "skill",
    "version": "1.0.0",
    "label": "pandemic_preparedness",
    "description": "Pandemic Preparedness Analysis - Analyze pandemic preparedness: pathogen surveillance, transmission modeling, therapeutic development, and public health interventions. Use this skill for public health tasks involving monitor pathogens model transmission develop therapeutics plan interventions. Combines 4 tools from 2 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "literature",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/pandemic_preparedness/SKILL.md"
    },
    "outputArtifactTypes": [
      "paper-list",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "pandemic preparedness",
      "pandemic preparedness analysis analyze pandemic preparedness pathogen surveillance",
      "Use pandemic preparedness and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/pandemic_preparedness/SKILL.md",
      "agentSummary": "Pandemic Preparedness Analysis - Analyze pandemic preparedness: pathogen surveillance, transmission modeling, therapeutic development, and public health interventions. Use this skill for public health tasks involving monitor pathogens model transmission develop therapeutics plan interventions. Combines 4 tools from 2 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/pandemic_preparedness",
    "tags": [
      "package",
      "scp",
      "literature",
      "knowledge",
      "生命科学",
      "公共卫生"
    ],
    "scpToolId": "132",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/132"
  },
  {
    "id": "scp.pediatric_drug_safety",
    "packageName": "@bioagent-skill/pediatric_drug_safety",
    "kind": "skill",
    "version": "1.0.0",
    "label": "pediatric_drug_safety",
    "description": "Pediatric Drug Safety Review - Evaluate pediatric drug safety: pediatric use information from FDA, child safety, dosage forms, and overdose information. Use this skill for pediatric pharmacology tasks involving get pediatric use info by drug name get child safety info by drug name get dosage forms and specs by drug name get overdose info by drug name. Combines 4 tools from 1 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/pediatric_drug_safety/SKILL.md"
    },
    "outputArtifactTypes": [
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "pediatric drug safety",
      "pediatric safety review evaluate pediatric safety pediatric information",
      "Use pediatric drug safety and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/pediatric_drug_safety/SKILL.md",
      "agentSummary": "Pediatric Drug Safety Review - Evaluate pediatric drug safety: pediatric use information from FDA, child safety, dosage forms, and overdose information. Use this skill for pediatric pharmacology tasks involving get pediatric use info by drug name get child safety info by drug name get dosage forms and specs by drug name get overdose info by drug name. Combines 4 tools from 1 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/pediatric_drug_safety",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "生命科学",
      "儿科药理学"
    ],
    "scpToolId": "133",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/133"
  },
  {
    "id": "scp.peptide-properties-calculation",
    "packageName": "@bioagent-skill/peptide-properties-calculation",
    "kind": "skill",
    "version": "1.0.0",
    "label": "peptide-properties-calculation",
    "description": "Calculate peptide properties including isoelectric point, hydrophobicity, charge, and stability predictions.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/peptide-properties-calculation/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "peptide properties calculation",
      "calculate peptide properties including isoelectric hydrophobicity charge stability",
      "Use peptide properties calculation and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/peptide-properties-calculation/SKILL.md",
      "agentSummary": "Calculate peptide properties including isoelectric point, hydrophobicity, charge, and stability predictions."
    },
    "packageRoot": "packages/skills/installed/scp/peptide-properties-calculation",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "生命科学"
    ],
    "scpToolId": "134",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/134"
  },
  {
    "id": "scp.personalized_medicine",
    "packageName": "@bioagent-skill/personalized_medicine",
    "kind": "skill",
    "version": "1.0.0",
    "label": "personalized_medicine",
    "description": "Personalized Medicine Analysis - Analyze for personalized medicine: genomic markers, drug response prediction, treatment optimization, and outcome prediction. Use this skill for precision medicine tasks involving find genomic markers predict drug response optimize treatment predict outcomes. Combines 4 tools from 3 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/personalized_medicine/SKILL.md"
    },
    "outputArtifactTypes": [
      "research-report",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "personalized medicine",
      "personalized medicine analysis analyze personalized medicine genomic markers",
      "Use personalized medicine and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/personalized_medicine/SKILL.md",
      "agentSummary": "Personalized Medicine Analysis - Analyze for personalized medicine: genomic markers, drug response prediction, treatment optimization, and outcome prediction. Use this skill for precision medicine tasks involving find genomic markers predict drug response optimize treatment predict outcomes. Combines 4 tools from 3 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/personalized_medicine",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "生命科学",
      "精准医学"
    ],
    "scpToolId": "135",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/135"
  },
  {
    "id": "scp.pharmacogenomics_analysis",
    "packageName": "@bioagent-skill/pharmacogenomics_analysis",
    "kind": "skill",
    "version": "1.0.0",
    "label": "pharmacogenomics_analysis",
    "description": "Pharmacogenomics Analysis - Analyze pharmacogenomics: drug response genes, variant effects, dosing recommendations, and adverse reaction predictions. Use this skill for pharmacogenomics tasks involving get drug response genes predict variant effects recommend dosing predict adverse reactions. Combines 4 tools from 2 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "omics",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/pharmacogenomics_analysis/SKILL.md"
    },
    "outputArtifactTypes": [
      "omics-differential-expression",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "pharmacogenomics analysis",
      "pharmacogenomics analysis analyze pharmacogenomics response variant effects dosing",
      "Use pharmacogenomics analysis and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/pharmacogenomics_analysis/SKILL.md",
      "agentSummary": "Pharmacogenomics Analysis - Analyze pharmacogenomics: drug response genes, variant effects, dosing recommendations, and adverse reaction predictions. Use this skill for pharmacogenomics tasks involving get drug response genes predict variant effects recommend dosing predict adverse reactions. Combines 4 tools from 2 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/pharmacogenomics_analysis",
    "tags": [
      "package",
      "scp",
      "omics",
      "knowledge",
      "生命科学",
      "药物基因组学"
    ],
    "scpToolId": "136",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/136"
  },
  {
    "id": "scp.pharmacokinetics_profile",
    "packageName": "@bioagent-skill/pharmacokinetics_profile",
    "kind": "skill",
    "version": "1.0.0",
    "label": "pharmacokinetics_profile",
    "description": "Pharmacokinetics Profile - Profile drug pharmacokinetics: absorption prediction, distribution modeling, metabolism pathways, excretion kinetics, and drug-drug interactions. Use this skill for pharmacology tasks involving predict absorption model distribution map metabolism predict excretion. Combines 4 tools from 2 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/pharmacokinetics_profile/SKILL.md"
    },
    "outputArtifactTypes": [
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "pharmacokinetics profile",
      "pharmacokinetics profile profile pharmacokinetics absorption prediction distribution modeling",
      "Use pharmacokinetics profile and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/pharmacokinetics_profile/SKILL.md",
      "agentSummary": "Pharmacokinetics Profile - Profile drug pharmacokinetics: absorption prediction, distribution modeling, metabolism pathways, excretion kinetics, and drug-drug interactions. Use this skill for pharmacology tasks involving predict absorption model distribution map metabolism predict excretion. Combines 4 tools from 2 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/pharmacokinetics_profile",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge",
      "生命科学",
      "药理学"
    ],
    "scpToolId": "137",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/137"
  },
  {
    "id": "scp.phenotype-by-hpo-id",
    "packageName": "@bioagent-skill/phenotype-by-hpo-id",
    "kind": "skill",
    "version": "1.0.0",
    "label": "phenotype-by-hpo-id",
    "description": "Retrieve clinical phenotypes and associated genes using Human Phenotype Ontology (HPO) IDs.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/phenotype-by-hpo-id/SKILL.md"
    },
    "outputArtifactTypes": [
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "phenotype by hpo id",
      "retrieve clinical phenotypes associated phenotype ontology",
      "Use phenotype by hpo id and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/phenotype-by-hpo-id/SKILL.md",
      "agentSummary": "Retrieve clinical phenotypes and associated genes using Human Phenotype Ontology (HPO) IDs."
    },
    "packageRoot": "packages/skills/installed/scp/phenotype-by-hpo-id",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "生命科学"
    ],
    "scpToolId": "138",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/138"
  },
  {
    "id": "scp.polypharmacology_analysis",
    "packageName": "@bioagent-skill/polypharmacology_analysis",
    "kind": "skill",
    "version": "1.0.0",
    "label": "polypharmacology_analysis",
    "description": "Polypharmacology Analysis - Analyze polypharmacology: multi-target profiling, pathway network analysis, selectivity assessment, and combination therapy design. Use this skill for pharmacology tasks involving profile multi-targets analyze networks assess selectivity design combinations. Combines 4 tools from 2 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/polypharmacology_analysis/SKILL.md"
    },
    "outputArtifactTypes": [
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "polypharmacology analysis",
      "polypharmacology analysis analyze polypharmacology target profiling pathway network",
      "Use polypharmacology analysis and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/polypharmacology_analysis/SKILL.md",
      "agentSummary": "Polypharmacology Analysis - Analyze polypharmacology: multi-target profiling, pathway network analysis, selectivity assessment, and combination therapy design. Use this skill for pharmacology tasks involving profile multi-targets analyze networks assess selectivity design combinations. Combines 4 tools from 2 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/polypharmacology_analysis",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "生命科学",
      "药理学"
    ],
    "scpToolId": "140",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/140"
  },
  {
    "id": "scp.population_genetics",
    "packageName": "@bioagent-skill/population_genetics",
    "kind": "skill",
    "version": "1.0.0",
    "label": "population_genetics",
    "description": "Population Genetics Analysis - Analyze population genetics: allele frequency, linkage disequilibrium, selection signatures, and ancestry inference. Use this skill for population genetics tasks involving get allele frequencies calculate LD detect selection infer ancestry. Combines 4 tools from 2 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/population_genetics/SKILL.md"
    },
    "outputArtifactTypes": [
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "population genetics",
      "population genetics analysis analyze population genetics allele frequency",
      "Use population genetics and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/population_genetics/SKILL.md",
      "agentSummary": "Population Genetics Analysis - Analyze population genetics: allele frequency, linkage disequilibrium, selection signatures, and ancestry inference. Use this skill for population genetics tasks involving get allele frequencies calculate LD detect selection infer ancestry. Combines 4 tools from 2 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/population_genetics",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "生命科学",
      "群体遗传学"
    ],
    "scpToolId": "141",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/141"
  },
  {
    "id": "scp.precision_oncology",
    "packageName": "@bioagent-skill/precision_oncology",
    "kind": "skill",
    "version": "1.0.0",
    "label": "precision_oncology",
    "description": "Precision Oncology Analysis - Analyze precision oncology: tumor profiling, target identification, treatment matching, and resistance prediction. Use this skill for precision oncology tasks involving profile tumor identify targets match treatments predict resistance. Combines 4 tools from 3 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "omics",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/precision_oncology/SKILL.md"
    },
    "outputArtifactTypes": [
      "paper-list",
      "evidence-matrix",
      "omics-differential-expression",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "precision oncology",
      "precision oncology analysis analyze precision oncology profiling target",
      "Use precision oncology and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/precision_oncology/SKILL.md",
      "agentSummary": "Precision Oncology Analysis - Analyze precision oncology: tumor profiling, target identification, treatment matching, and resistance prediction. Use this skill for precision oncology tasks involving profile tumor identify targets match treatments predict resistance. Combines 4 tools from 3 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/precision_oncology",
    "tags": [
      "package",
      "scp",
      "omics",
      "knowledge",
      "生命科学",
      "精准肿瘤学"
    ],
    "scpToolId": "142",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/142"
  },
  {
    "id": "scp.protein_classification_analysis",
    "packageName": "@bioagent-skill/protein_classification_analysis",
    "kind": "skill",
    "version": "1.0.0",
    "label": "protein_classification_analysis",
    "description": "Protein Classification Analysis - Classify proteins into families, structural classes, and functional categories using machine learning models. Use this skill for tasks involving InterPro domain mapping, enzyme classification (EC numbers), GO term annotation, and protein family assignment. Supports batch analysis of protein sequences and identifiers.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/protein_classification_analysis/SKILL.md"
    },
    "outputArtifactTypes": [
      "evidence-matrix",
      "sequence-alignment",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "protein classification analysis",
      "protein classification analysis classify proteins families structural classes",
      "Use protein classification analysis and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/protein_classification_analysis/SKILL.md",
      "agentSummary": "Protein Classification Analysis - Classify proteins into families, structural classes, and functional categories using machine learning models. Use this skill for tasks involving InterPro domain mapping, enzyme classification (EC numbers), GO term annotation, and protein family assignment. Supports batch analysis of protein sequences and identifiers."
    },
    "packageRoot": "packages/skills/installed/scp/protein_classification_analysis",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "生命科学",
      "蛋白质分析",
      "功能注释"
    ],
    "scpToolId": "protein_classification_analysis",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/protein_classification_analysis"
  },
  {
    "id": "scp.protein_complex_analysis",
    "packageName": "@bioagent-skill/protein_complex_analysis",
    "kind": "skill",
    "version": "1.0.0",
    "label": "protein_complex_analysis",
    "description": "Protein Complex Analysis - Analyze protein-protein interactions, predict complex structures, and characterize quaternary structure. Use this skill for PPI network analysis, complex structure prediction, and interaction interface characterization.",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/protein_complex_analysis/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "protein complex analysis",
      "protein complex analysis analyze protein protein interactions predict",
      "Use protein complex analysis and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/protein_complex_analysis/SKILL.md",
      "agentSummary": "Protein Complex Analysis - Analyze protein-protein interactions, predict complex structures, and characterize quaternary structure. Use this skill for PPI network analysis, complex structure prediction, and interaction interface characterization."
    },
    "packageRoot": "packages/skills/installed/scp/protein_complex_analysis",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge",
      "生命科学",
      "蛋白质组学",
      "蛋白互作",
      "结构生物学"
    ],
    "scpToolId": "protein_complex_analysis",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/protein_complex_analysis"
  },
  {
    "id": "scp.protein_property_comparison",
    "packageName": "@bioagent-skill/protein_property_comparison",
    "kind": "skill",
    "version": "1.0.0",
    "label": "protein_property_comparison",
    "description": "Compare physicochemical properties, structural features, and functional annotations between multiple proteins for evolutionary analysis and functional characterization.",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/protein_property_comparison/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "protein property comparison",
      "compare physicochemical properties structural features functional annotations between",
      "Use protein property comparison and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/protein_property_comparison/SKILL.md",
      "agentSummary": "Compare physicochemical properties, structural features, and functional annotations between multiple proteins for evolutionary analysis and functional characterization."
    },
    "packageRoot": "packages/skills/installed/scp/protein_property_comparison",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge",
      "蛋白质比较",
      "生物信息学",
      "进化分析",
      "蛋白性质"
    ],
    "scpToolId": "201",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/protein_property_comparison"
  },
  {
    "id": "scp.protein_quality_assessment",
    "packageName": "@bioagent-skill/protein_quality_assessment",
    "kind": "skill",
    "version": "1.0.0",
    "label": "protein_quality_assessment",
    "description": "Protein Quality Assessment - Evaluate protein structure quality, stability, and reliability using various quality metrics and validation scores. Use this skill for quality control of modeled protein structures, assessment of X-ray/NMR structures, and confidence scoring for predictions.",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/protein_quality_assessment/SKILL.md"
    },
    "outputArtifactTypes": [
      "research-report",
      "sequence-alignment",
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "protein quality assessment",
      "protein quality assessment evaluate protein structure quality stability",
      "Use protein quality assessment and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/protein_quality_assessment/SKILL.md",
      "agentSummary": "Protein Quality Assessment - Evaluate protein structure quality, stability, and reliability using various quality metrics and validation scores. Use this skill for quality control of modeled protein structures, assessment of X-ray/NMR structures, and confidence scoring for predictions."
    },
    "packageRoot": "packages/skills/installed/scp/protein_quality_assessment",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge",
      "生命科学",
      "蛋白质质量",
      "结构验证",
      "质量控制"
    ],
    "scpToolId": "110",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/protein_quality_assessment"
  },
  {
    "id": "scp.protein-blast-search",
    "packageName": "@bioagent-skill/protein-blast-search",
    "kind": "skill",
    "version": "1.0.0",
    "label": "protein-blast-search",
    "description": "Search for similar protein sequences in UniProt Swiss-Prot database using BLAST to identify homologous proteins and functional relationships.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/protein-blast-search/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "protein blast search",
      "search similar protein sequences uniprot database identify homologous",
      "Use protein blast search and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/protein-blast-search/SKILL.md",
      "agentSummary": "Search for similar protein sequences in UniProt Swiss-Prot database using BLAST to identify homologous proteins and functional relationships."
    },
    "packageRoot": "packages/skills/installed/scp/protein-blast-search",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "生命科学"
    ],
    "scpToolId": "143",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/143"
  },
  {
    "id": "scp.protein-database-crossref",
    "packageName": "@bioagent-skill/protein-database-crossref",
    "kind": "skill",
    "version": "1.0.0",
    "label": "Protein Database CrossRef",
    "description": "Cross-reference protein data across multiple databases including UniProt, PDB, Pfam, InterPro, and Gene Ontology. Aggregate protein annotations and functional data from authoritative sources.",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/protein_database_crossref/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "protein database crossref",
      "reference protein across multiple databases including uniprot interpro",
      "Use protein database crossref and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/protein_database_crossref/SKILL.md",
      "agentSummary": "Cross-reference protein data across multiple databases including UniProt, PDB, Pfam, InterPro, and Gene Ontology. Aggregate protein annotations and functional data from authoritative sources."
    },
    "packageRoot": "packages/skills/installed/scp/protein_database_crossref",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge"
    ],
    "scpToolId": "protein_database_crossref"
  },
  {
    "id": "scp.protein-engineering",
    "packageName": "@bioagent-skill/protein-engineering",
    "kind": "skill",
    "version": "1.0.0",
    "label": "Protein Engineering",
    "description": "Design and optimize protein sequences for desired properties including stability, solubility, catalytic activity, and binding affinity. Supports point mutation design, truncation analysis, fusion protein design, and thermostability optimization using structure-aware deep learning models.",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/protein_engineering/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "protein engineering",
      "design optimize protein sequences desired properties including stability",
      "Use protein engineering and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/protein_engineering/SKILL.md",
      "agentSummary": "Design and optimize protein sequences for desired properties including stability, solubility, catalytic activity, and binding affinity. Supports point mutation design, truncation analysis, fusion protein design, and thermostability optimization using structure-aware deep learning models."
    },
    "packageRoot": "packages/skills/installed/scp/protein_engineering",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge"
    ],
    "scpToolId": "protein_engineering"
  },
  {
    "id": "scp.protein-properties-calculation",
    "packageName": "@bioagent-skill/protein-properties-calculation",
    "kind": "skill",
    "version": "1.0.0",
    "label": "protein-properties-calculation",
    "description": "Calculate physicochemical properties of protein sequences including molecular weight, isoelectric point, instability index, and amino acid composition.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/protein-properties-calculation/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "omics-differential-expression"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "protein properties calculation",
      "calculate physicochemical properties protein sequences including molecular weight",
      "Use protein properties calculation and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/protein-properties-calculation/SKILL.md",
      "agentSummary": "Calculate physicochemical properties of protein sequences including molecular weight, isoelectric point, instability index, and amino acid composition."
    },
    "packageRoot": "packages/skills/installed/scp/protein-properties-calculation",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "生物信息学",
      "蛋白质"
    ],
    "scpToolId": "1",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/protein-properties-calculation"
  },
  {
    "id": "scp.protein-similarity-search",
    "packageName": "@bioagent-skill/protein-similarity-search",
    "kind": "skill",
    "version": "1.0.0",
    "label": "Protein Similarity Search",
    "description": "SCP skill for protein_similarity_search.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/protein_similarity_search/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "protein similarity search",
      "protein_similarity_search",
      "Use protein similarity search and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/protein_similarity_search/SKILL.md",
      "agentSummary": "SCP skill for protein_similarity_search."
    },
    "packageRoot": "packages/skills/installed/scp/protein_similarity_search",
    "tags": [
      "package",
      "scp",
      "knowledge"
    ],
    "scpToolId": "protein_similarity_search"
  },
  {
    "id": "scp.protein-structure-analysis",
    "packageName": "@bioagent-skill/protein-structure-analysis",
    "kind": "skill",
    "version": "1.0.0",
    "label": "Protein Structure Analysis",
    "description": "Analyze protein 3D structures to predict secondary structure elements (alpha-helices, beta-strands), domain boundaries, solvent accessibility, and structural homology. Integrates with AlphaFold predictions and experimental structure databases (PDB).",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/protein_structure_analysis/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "structure-summary"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "protein structure analysis",
      "analyze protein structures predict secondary structure elements helices",
      "Use protein structure analysis and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/protein_structure_analysis/SKILL.md",
      "agentSummary": "Analyze protein 3D structures to predict secondary structure elements (alpha-helices, beta-strands), domain boundaries, solvent accessibility, and structural homology. Integrates with AlphaFold predictions and experimental structure databases (PDB)."
    },
    "packageRoot": "packages/skills/installed/scp/protein_structure_analysis",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge"
    ],
    "scpToolId": "protein_structure_analysis"
  },
  {
    "id": "scp.pubchem-deep-dive",
    "packageName": "@bioagent-skill/pubchem-deep-dive",
    "kind": "skill",
    "version": "1.0.0",
    "label": "PubChem Deep Dive",
    "description": "Comprehensive PubChem database exploration including compound properties, bioactivity data, spectral information, and patent records. Supports CID/SMILES/InChI queries.",
    "source": "package",
    "skillDomains": [
      "literature",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/pubchem_deep_dive/SKILL.md"
    },
    "outputArtifactTypes": [
      "paper-list",
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "pubchem deep dive",
      "comprehensive pubchem database exploration including compound properties bioactivity",
      "Use pubchem deep dive and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/pubchem_deep_dive/SKILL.md",
      "agentSummary": "Comprehensive PubChem database exploration including compound properties, bioactivity data, spectral information, and patent records. Supports CID/SMILES/InChI queries."
    },
    "packageRoot": "packages/skills/installed/scp/pubchem_deep_dive",
    "tags": [
      "package",
      "scp",
      "literature",
      "knowledge"
    ],
    "scpToolId": "pubchem_deep_dive"
  },
  {
    "id": "scp.rare-disease-genetics",
    "packageName": "@bioagent-skill/rare-disease-genetics",
    "kind": "skill",
    "version": "1.0.0",
    "label": "Rare Disease Genetics",
    "description": "Identify and analyze genetic variants associated with rare diseases using multi-omics data integration, phenotype matching via HPO terms, and literature mining. Supports variant prioritization, pathway analysis, and clinical interpretation for undiagnosed rare disease cases.",
    "source": "package",
    "skillDomains": [
      "literature",
      "omics",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/rare_disease_genetics/SKILL.md"
    },
    "outputArtifactTypes": [
      "paper-list",
      "evidence-matrix",
      "research-report",
      "omics-differential-expression",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "rare disease genetics",
      "identify analyze genetic variants associated diseases integration phenotype",
      "Use rare disease genetics and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/rare_disease_genetics/SKILL.md",
      "agentSummary": "Identify and analyze genetic variants associated with rare diseases using multi-omics data integration, phenotype matching via HPO terms, and literature mining. Supports variant prioritization, pathway analysis, and clinical interpretation for undiagnosed rare disease cases."
    },
    "packageRoot": "packages/skills/installed/scp/rare_disease_genetics",
    "tags": [
      "package",
      "scp",
      "literature",
      "omics",
      "knowledge"
    ],
    "scpToolId": "rare_disease_genetics"
  },
  {
    "id": "scp.regulatory-region-analysis",
    "packageName": "@bioagent-skill/regulatory-region-analysis",
    "kind": "skill",
    "version": "1.0.0",
    "label": "Regulatory Region Analysis",
    "description": "Analyze genomic regulatory regions such as promoters, enhancers, silencers, transcription factor binding sites, and chromatin accessibility intervals. Supports motif scanning, cis-regulatory annotation, and candidate regulatory element prioritization.",
    "source": "package",
    "skillDomains": [
      "omics",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/regulatory_region_analysis/SKILL.md"
    },
    "outputArtifactTypes": [
      "evidence-matrix",
      "omics-differential-expression",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "regulatory region analysis",
      "analyze genomic regulatory regions promoters enhancers silencers transcription",
      "Use regulatory region analysis and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/regulatory_region_analysis/SKILL.md",
      "agentSummary": "Analyze genomic regulatory regions such as promoters, enhancers, silencers, transcription factor binding sites, and chromatin accessibility intervals. Supports motif scanning, cis-regulatory annotation, and candidate regulatory element prioritization."
    },
    "packageRoot": "packages/skills/installed/scp/regulatory_region_analysis",
    "tags": [
      "package",
      "scp",
      "omics",
      "knowledge"
    ],
    "scpToolId": "regulatory_region_analysis"
  },
  {
    "id": "scp.sequence-alignment-pairwise",
    "packageName": "@bioagent-skill/sequence-alignment-pairwise",
    "kind": "skill",
    "version": "1.0.0",
    "label": "sequence-alignment-pairwise",
    "description": "Pairwise sequence alignment tool for DNA, RNA, and protein sequences with global and local alignment modes.",
    "source": "package",
    "skillDomains": [
      "omics",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/sequence-alignment-pairwise/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "sequence alignment pairwise",
      "pairwise sequence alignment protein sequences global alignment",
      "Use sequence alignment pairwise and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/sequence-alignment-pairwise/SKILL.md",
      "agentSummary": "Pairwise sequence alignment tool for DNA, RNA, and protein sequences with global and local alignment modes."
    },
    "packageRoot": "packages/skills/installed/scp/sequence-alignment-pairwise",
    "tags": [
      "package",
      "scp",
      "omics",
      "knowledge",
      "生物信息学",
      "序列比对"
    ],
    "scpToolId": "3",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/sequence-alignment-pairwise"
  },
  {
    "id": "scp.smiles_comprehensive_analysis",
    "packageName": "@bioagent-skill/smiles_comprehensive_analysis",
    "kind": "skill",
    "version": "1.0.0",
    "label": "smiles_comprehensive_analysis",
    "description": "SMILES Comprehensive Analysis - Comprehensive analysis of molecules from SMILES: structure validation, property calculation, similarity search, and reaction prediction. Use this skill for cheminformatics tasks involving validate SMILES calculate properties search similar predict reactions. Combines 4 tools from 2 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/smiles_comprehensive_analysis/SKILL.md"
    },
    "outputArtifactTypes": [
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "smiles comprehensive analysis",
      "smiles comprehensive analysis comprehensive analysis molecules smiles structure",
      "Use smiles comprehensive analysis and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/smiles_comprehensive_analysis/SKILL.md",
      "agentSummary": "SMILES Comprehensive Analysis - Comprehensive analysis of molecules from SMILES: structure validation, property calculation, similarity search, and reaction prediction. Use this skill for cheminformatics tasks involving validate SMILES calculate properties search similar predict reactions. Combines 4 tools from 2 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/smiles_comprehensive_analysis",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge",
      "化学",
      "化学信息学"
    ],
    "scpToolId": "173",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/173"
  },
  {
    "id": "scp.structural_pharmacogenomics",
    "packageName": "@bioagent-skill/structural_pharmacogenomics",
    "kind": "skill",
    "version": "1.0.0",
    "label": "structural_pharmacogenomics",
    "description": "Structural Pharmacogenomics - Analyze genetic variants in drug target proteins and predict their impact on drug response using structural information. Use this skill for pharmacogenomics tasks involving variant effect prediction drug response SNP protein structure genotype phenotype. Link genomic variations to drug efficacy and toxicity.",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/structural_pharmacogenomics/SKILL.md"
    },
    "outputArtifactTypes": [
      "research-report",
      "sequence-alignment",
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "structural pharmacogenomics",
      "structural pharmacogenomics analyze genetic variants target proteins predict",
      "Use structural pharmacogenomics and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/structural_pharmacogenomics/SKILL.md",
      "agentSummary": "Structural Pharmacogenomics - Analyze genetic variants in drug target proteins and predict their impact on drug response using structural information. Use this skill for pharmacogenomics tasks involving variant effect prediction drug response SNP protein structure genotype phenotype. Link genomic variations to drug efficacy and toxicity."
    },
    "packageRoot": "packages/skills/installed/scp/structural_pharmacogenomics",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge",
      "生命科学",
      "药物基因组学",
      "精准医疗"
    ],
    "scpToolId": "118",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/structural_pharmacogenomics"
  },
  {
    "id": "scp.substance-toxicology",
    "packageName": "@bioagent-skill/substance-toxicology",
    "kind": "skill",
    "version": "1.0.0",
    "label": "Substance Toxicology",
    "description": "SCP skill for substance_toxicology.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/substance_toxicology/SKILL.md"
    },
    "outputArtifactTypes": [
      "runtime-artifact"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "substance toxicology",
      "substance_toxicology",
      "Use substance toxicology and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/substance_toxicology/SKILL.md",
      "agentSummary": "SCP skill for substance_toxicology."
    },
    "packageRoot": "packages/skills/installed/scp/substance_toxicology",
    "tags": [
      "package",
      "scp",
      "knowledge"
    ],
    "scpToolId": "substance_toxicology"
  },
  {
    "id": "scp.substructure-activity-search",
    "packageName": "@bioagent-skill/substructure-activity-search",
    "kind": "skill",
    "version": "1.0.0",
    "label": "Substructure Activity Search",
    "description": "Perform substructure-based activity relationship (SAR) analysis to identify molecular substructures associated with biological activity. Supports SMILES/MOL file input, scaffold analysis, and activity cliff detection for drug discovery.",
    "source": "package",
    "skillDomains": [
      "structure",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/substructure_activity_search/SKILL.md"
    },
    "outputArtifactTypes": [
      "structure-summary",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "substructure activity search",
      "perform substructure activity relationship analysis identify molecular substructures",
      "Use substructure activity search and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/substructure_activity_search/SKILL.md",
      "agentSummary": "Perform substructure-based activity relationship (SAR) analysis to identify molecular substructures associated with biological activity. Supports SMILES/MOL file input, scaffold analysis, and activity cliff detection for drug discovery."
    },
    "packageRoot": "packages/skills/installed/scp/substructure_activity_search",
    "tags": [
      "package",
      "scp",
      "structure",
      "knowledge"
    ],
    "scpToolId": "substructure_activity_search"
  },
  {
    "id": "scp.synthetic-biology-design",
    "packageName": "@bioagent-skill/synthetic-biology-design",
    "kind": "skill",
    "version": "1.0.0",
    "label": "Synthetic Biology Design",
    "description": "Design synthetic biology constructs including gene circuits, CRISPR components, and metabolic pathways. Supports pathway optimization and gene expression vector design.",
    "source": "package",
    "skillDomains": [
      "omics",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/synthetic_biology_design/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "omics-differential-expression",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "synthetic biology design",
      "design synthetic biology constructs including circuits crispr components",
      "Use synthetic biology design and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/synthetic_biology_design/SKILL.md",
      "agentSummary": "Design synthetic biology constructs including gene circuits, CRISPR components, and metabolic pathways. Supports pathway optimization and gene expression vector design."
    },
    "packageRoot": "packages/skills/installed/scp/synthetic_biology_design",
    "tags": [
      "package",
      "scp",
      "omics",
      "knowledge"
    ],
    "scpToolId": "synthetic_biology_design"
  },
  {
    "id": "scp.systems-pharmacology",
    "packageName": "@bioagent-skill/systems-pharmacology",
    "kind": "skill",
    "version": "1.0.0",
    "label": "Systems Pharmacology",
    "description": "SCP skill for systems_pharmacology.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/systems_pharmacology/SKILL.md"
    },
    "outputArtifactTypes": [
      "runtime-artifact"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "systems pharmacology",
      "systems_pharmacology",
      "Use systems pharmacology and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/systems_pharmacology/SKILL.md",
      "agentSummary": "SCP skill for systems_pharmacology."
    },
    "packageRoot": "packages/skills/installed/scp/systems_pharmacology",
    "tags": [
      "package",
      "scp",
      "knowledge"
    ],
    "scpToolId": "systems_pharmacology"
  },
  {
    "id": "scp.tcga-gene-expression",
    "packageName": "@bioagent-skill/tcga-gene-expression",
    "kind": "skill",
    "version": "1.0.0",
    "label": "TCGA Gene Expression",
    "description": "Query and analyze tumor gene expression profiles from The Cancer Genome Atlas (TCGA). Supports cohort-level expression lookup, tumor-versus-normal comparison, subtype stratification, and candidate biomarker exploration across cancer types.",
    "source": "package",
    "skillDomains": [
      "omics",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/tcga-gene-expression/SKILL.md"
    },
    "outputArtifactTypes": [
      "research-report",
      "omics-differential-expression",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "tcga gene expression",
      "analyze expression profiles cancer genome supports cohort expression",
      "Use tcga gene expression and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/tcga-gene-expression/SKILL.md",
      "agentSummary": "Query and analyze tumor gene expression profiles from The Cancer Genome Atlas (TCGA). Supports cohort-level expression lookup, tumor-versus-normal comparison, subtype stratification, and candidate biomarker exploration across cancer types."
    },
    "packageRoot": "packages/skills/installed/scp/tcga-gene-expression",
    "tags": [
      "package",
      "scp",
      "omics",
      "knowledge"
    ],
    "scpToolId": "tcga-gene-expression"
  },
  {
    "id": "scp.tissue-specific-analysis",
    "packageName": "@bioagent-skill/tissue-specific-analysis",
    "kind": "skill",
    "version": "1.0.0",
    "label": "Tissue Specific Analysis",
    "description": "Analyze gene expression patterns across different tissue types to identify tissue-specific genes, functional enrichment in specific tissues, and cross-tissue regulatory networks. Integrates with GTEx, human protein atlas, and other expression databases.",
    "source": "package",
    "skillDomains": [
      "omics",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/tissue_specific_analysis/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment",
      "omics-differential-expression",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "tissue specific analysis",
      "analyze expression patterns across different tissue identify tissue",
      "Use tissue specific analysis and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/tissue_specific_analysis/SKILL.md",
      "agentSummary": "Analyze gene expression patterns across different tissue types to identify tissue-specific genes, functional enrichment in specific tissues, and cross-tissue regulatory networks. Integrates with GTEx, human protein atlas, and other expression databases."
    },
    "packageRoot": "packages/skills/installed/scp/tissue_specific_analysis",
    "tags": [
      "package",
      "scp",
      "omics",
      "knowledge"
    ],
    "scpToolId": "tissue_specific_analysis"
  },
  {
    "id": "scp.uniprot-protein-retrieval",
    "packageName": "@bioagent-skill/uniprot-protein-retrieval",
    "kind": "skill",
    "version": "1.0.0",
    "label": "UniProt Protein Retrieval",
    "description": "SCP skill for uniprot-protein-retrieval.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/uniprot-protein-retrieval/SKILL.md"
    },
    "outputArtifactTypes": [
      "sequence-alignment"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "uniprot protein retrieval",
      "Use uniprot protein retrieval and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/uniprot-protein-retrieval/SKILL.md",
      "agentSummary": "SCP skill for uniprot-protein-retrieval."
    },
    "packageRoot": "packages/skills/installed/scp/uniprot-protein-retrieval",
    "tags": [
      "package",
      "scp",
      "knowledge"
    ],
    "scpToolId": "uniprot-protein-retrieval"
  },
  {
    "id": "scp.variant_pathogenicity",
    "packageName": "@bioagent-skill/variant_pathogenicity",
    "kind": "skill",
    "version": "1.0.0",
    "label": "variant_pathogenicity",
    "description": "Variant Pathogenicity Prediction - Predict variant pathogenicity: deleteriousness scoring, conservation analysis, clinical interpretation, and disease association. Use this skill for clinical genetics tasks involving score deleteriousness analyze conservation interpret clinically associate with disease. Combines 4 tools from 2 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/variant_pathogenicity/SKILL.md"
    },
    "outputArtifactTypes": [
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "variant pathogenicity",
      "variant pathogenicity prediction predict variant pathogenicity deleteriousness scoring",
      "Use variant pathogenicity and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/variant_pathogenicity/SKILL.md",
      "agentSummary": "Variant Pathogenicity Prediction - Predict variant pathogenicity: deleteriousness scoring, conservation analysis, clinical interpretation, and disease association. Use this skill for clinical genetics tasks involving score deleteriousness analyze conservation interpret clinically associate with disease. Combines 4 tools from 2 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/variant_pathogenicity",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "生命科学",
      "临床遗传学"
    ],
    "scpToolId": "200",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/200"
  },
  {
    "id": "scp.variant-functional-prediction",
    "packageName": "@bioagent-skill/variant-functional-prediction",
    "kind": "skill",
    "version": "1.0.0",
    "label": "variant-functional-prediction",
    "description": "Predict the functional impact of genetic variants including missense, nonsense, synonymous, and regulatory variants for clinical variant interpretation and pathogenicity assessment.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/variant-functional-prediction/SKILL.md"
    },
    "outputArtifactTypes": [
      "evidence-matrix",
      "research-report",
      "sequence-alignment",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "variant functional prediction",
      "predict functional impact genetic variants including missense nonsense",
      "Use variant functional prediction and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/variant-functional-prediction/SKILL.md",
      "agentSummary": "Predict the functional impact of genetic variants including missense, nonsense, synonymous, and regulatory variants for clinical variant interpretation and pathogenicity assessment."
    },
    "packageRoot": "packages/skills/installed/scp/variant-functional-prediction",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "变异功能预测",
      "临床变异",
      "ACMG分类",
      "致病性"
    ],
    "scpToolId": "201",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/variant-functional-prediction"
  },
  {
    "id": "scp.variant-gwas-associations",
    "packageName": "@bioagent-skill/variant-gwas-associations",
    "kind": "skill",
    "version": "1.0.0",
    "label": "Variant GWAS Associations",
    "description": "Query and analyze genome-wide association study (GWAS) data for genetic variants. Supports SNP-trait associations, LD proxy lookups, and PheWAS analysis.",
    "source": "package",
    "skillDomains": [
      "omics",
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/variant-gwas-associations/SKILL.md"
    },
    "outputArtifactTypes": [
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "variant gwas associations",
      "analyze genome association genetic variants supports associations lookups",
      "Use variant gwas associations and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/variant-gwas-associations/SKILL.md",
      "agentSummary": "Query and analyze genome-wide association study (GWAS) data for genetic variants. Supports SNP-trait associations, LD proxy lookups, and PheWAS analysis."
    },
    "packageRoot": "packages/skills/installed/scp/variant-gwas-associations",
    "tags": [
      "package",
      "scp",
      "omics",
      "knowledge"
    ],
    "scpToolId": "variant-gwas-associations"
  },
  {
    "id": "scp.variant-pharmacogenomics",
    "packageName": "@bioagent-skill/variant-pharmacogenomics",
    "kind": "skill",
    "version": "1.0.0",
    "label": "variant-pharmacogenomics",
    "description": "Variant Pharmacogenomics Analysis - Analyze pharmacogenomic variants: variant effect prediction, drug response association, clinical interpretation, and dosing guidance. Use this skill for pharmacogenomics tasks involving predict variant effects associate with drug response interpret clinically guide dosing. Combines 4 tools from 2 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/variant-pharmacogenomics/SKILL.md"
    },
    "outputArtifactTypes": [
      "evidence-matrix",
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "variant pharmacogenomics",
      "variant pharmacogenomics analysis analyze pharmacogenomic variants variant effect",
      "Use variant pharmacogenomics and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/variant-pharmacogenomics/SKILL.md",
      "agentSummary": "Variant Pharmacogenomics Analysis - Analyze pharmacogenomic variants: variant effect prediction, drug response association, clinical interpretation, and dosing guidance. Use this skill for pharmacogenomics tasks involving predict variant effects associate with drug response interpret clinically guide dosing. Combines 4 tools from 2 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/variant-pharmacogenomics",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "生命科学"
    ],
    "scpToolId": "198",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/198"
  },
  {
    "id": "scp.variant-population-frequency",
    "packageName": "@bioagent-skill/variant-population-frequency",
    "kind": "skill",
    "version": "1.0.0",
    "label": "variant-population-frequency",
    "description": "Retrieve population frequency data for genetic variants from gnoMAD and other population databases.",
    "source": "package",
    "skillDomains": [
      "knowledge"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/variant-population-frequency/SKILL.md"
    },
    "outputArtifactTypes": [
      "knowledge-graph"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "variant population frequency",
      "retrieve population frequency genetic variants gnomad population databases",
      "Use variant population frequency and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/variant-population-frequency/SKILL.md",
      "agentSummary": "Retrieve population frequency data for genetic variants from gnoMAD and other population databases."
    },
    "packageRoot": "packages/skills/installed/scp/variant-population-frequency",
    "tags": [
      "package",
      "scp",
      "knowledge",
      "生命科学"
    ],
    "scpToolId": "199",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/199"
  },
  {
    "id": "scp.virus_genomics",
    "packageName": "@bioagent-skill/virus_genomics",
    "kind": "skill",
    "version": "1.0.0",
    "label": "virus_genomics",
    "description": "Virus Genomics Analysis - Analyze virus genomics: genome annotation,变异分析, host interaction prediction, and therapeutic target identification. Use this skill for virology tasks involving annotate genome analyze variants predict host interactions identify targets. Combines 4 tools from 2 SCP server(s).",
    "source": "package",
    "skillDomains": [
      "literature"
    ],
    "inputContract": {
      "prompt": "Free-text request matched against this SKILL.md.",
      "skillMarkdownRef": "packages/skills/installed/scp/virus_genomics/SKILL.md"
    },
    "outputArtifactTypes": [
      "paper-list",
      "research-report"
    ],
    "entrypointType": "markdown-skill",
    "requiredCapabilities": [
      {
        "capability": "agentserver-generation",
        "level": "self-healing"
      },
      {
        "capability": "artifact-emission",
        "level": "schema-checked"
      }
    ],
    "failureModes": [
      "backend-unavailable",
      "missing-input",
      "schema-mismatch"
    ],
    "examplePrompts": [
      "virus genomics",
      "genomics analysis analyze genomics genome annotation interaction prediction",
      "Use virus genomics and return structured BioAgent artifacts"
    ],
    "docs": {
      "readmePath": "packages/skills/installed/scp/virus_genomics/SKILL.md",
      "agentSummary": "Virus Genomics Analysis - Analyze virus genomics: genome annotation,变异分析, host interaction prediction, and therapeutic target identification. Use this skill for virology tasks involving annotate genome analyze variants predict host interactions identify targets. Combines 4 tools from 2 SCP server(s)."
    },
    "packageRoot": "packages/skills/installed/scp/virus_genomics",
    "tags": [
      "package",
      "scp",
      "literature",
      "生命科学",
      "病毒学"
    ],
    "scpToolId": "202",
    "scpHubUrl": "https://scphub.intern-ai.org.cn/skill/202"
  }
] as const satisfies readonly SkillPackageManifest[];

export type { SkillPackageManifest, SkillPackageSource } from './types';
