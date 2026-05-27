"""Artifact renderers for package-owned target-bound Computer Use probes."""

from __future__ import annotations

import json
import hashlib
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence
from xml.sax.saxutils import escape
import xml.etree.ElementTree as ET


def render_target_artifact(
    path: Path,
    *,
    document_lines: Sequence[str],
    scenario: Mapping[str, Any],
) -> dict[str, Any]:
    """Render a target-window artifact from generic typed document state.

    The renderer is selected by artifact spec or file extension. It is used by
    the package-owned target-bound host when a generic save action is executed;
    callers still need current visual/file evidence before claiming completion.
    """

    path.parent.mkdir(parents=True, exist_ok=True)
    artifact_spec = _artifact_spec(scenario)
    kind = _artifact_kind(path, artifact_spec)
    if kind == "slide-deck":
        title, subtitle, bullets = _slide_content(document_lines, artifact_spec)
        _write_one_slide_pptx(path, title=title, subtitle=subtitle, bullets=bullets)
        validation_ref = path.with_suffix(path.suffix + ".validation.json")
        validation = validate_pptx_artifact(path)
        validation_ref.write_text(f"{json.dumps(validation, indent=2, sort_keys=True)}\n", encoding="utf8")
        return {
            "artifactKind": "slide-deck",
            "artifactFormat": "pptx",
            "slideCount": 1,
            "title": title,
            "bulletCount": len(bullets),
            "artifactValidationRef": str(validation_ref.resolve()),
            "pptxValidationRef": str(validation_ref.resolve()),
            "pptxValidation": {
                "ok": validation["ok"],
                "slideCount": validation["slideCount"],
                "sizeBytes": validation["sizeBytes"],
                "sha256": validation["sha256"],
            },
        }
    text = "\n".join(document_lines).rstrip() + "\n"
    path.write_text(text, encoding="utf8")
    return {
        "artifactKind": "document",
        "artifactFormat": path.suffix.lower().lstrip(".") or "txt",
        "lineCount": len(document_lines),
    }


def validate_pptx_artifact(path: Path) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    required_parts = {
        "[Content_Types].xml",
        "_rels/.rels",
        "docProps/core.xml",
        "docProps/app.xml",
        "ppt/presentation.xml",
        "ppt/_rels/presentation.xml.rels",
        "ppt/slides/slide1.xml",
    }
    names: set[str] = set()
    slide_count = 0
    if not path.is_file():
        errors.append("pptx file does not exist")
        size_bytes = 0
        sha256 = ""
    else:
        size_bytes = path.stat().st_size
        sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
    if path.is_file() and not zipfile.is_zipfile(path):
        errors.append("pptx is not a valid zip package")
    if path.is_file() and zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            names = set(archive.namelist())
            for name in names:
                if name.startswith("/") or ".." in Path(name).parts:
                    errors.append(f"unsafe zip path: {name}")
                if name.lower().endswith((".bin", ".vba", "vbaproject.bin")):
                    errors.append(f"macro payload is forbidden: {name}")
            missing = sorted(required_parts - names)
            if missing:
                errors.append("missing required pptx part(s): " + ", ".join(missing))
            for name in sorted(item for item in names if item.endswith((".xml", ".rels"))):
                try:
                    ET.fromstring(archive.read(name))
                except ET.ParseError as exc:
                    errors.append(f"xml parse failed for {name}: {exc}")
            if "ppt/presentation.xml" in names:
                try:
                    presentation = ET.fromstring(archive.read("ppt/presentation.xml"))
                    slide_count = len(presentation.findall(".//{http://schemas.openxmlformats.org/presentationml/2006/main}sldId"))
                except ET.ParseError:
                    slide_count = 0
            if "ppt/_rels/presentation.xml.rels" in names:
                try:
                    rels = ET.fromstring(archive.read("ppt/_rels/presentation.xml.rels"))
                    slide_targets = [
                        rel.attrib.get("Target")
                        for rel in rels.findall("{http://schemas.openxmlformats.org/package/2006/relationships}Relationship")
                        if rel.attrib.get("Type", "").endswith("/slide")
                    ]
                    for target in slide_targets:
                        if target and f"ppt/{target}" not in names:
                            errors.append(f"slide relationship target missing: {target}")
                except ET.ParseError:
                    pass
    if size_bytes <= 0:
        errors.append("pptx file is empty")
    if slide_count != 1:
        errors.append(f"pptx slideCount must be 1, got {slide_count}")
    return {
        "schemaVersion": "sciforge.computer-use.pptx-validation.v1",
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "path": str(path.resolve()),
        "sizeBytes": size_bytes,
        "sha256": sha256,
        "slideCount": slide_count,
        "requiredParts": sorted(required_parts),
        "packageParts": sorted(names),
        "macrosForbidden": True,
    }


def _artifact_spec(scenario: Mapping[str, Any]) -> Mapping[str, Any]:
    for key in ("artifactSpec", "artifactOutput", "finalArtifact"):
        value = scenario.get(key)
        if isinstance(value, Mapping):
            return value
    return {}


def _artifact_kind(path: Path, artifact_spec: Mapping[str, Any]) -> str:
    kind = str(artifact_spec.get("kind") or artifact_spec.get("type") or "").strip().lower()
    if kind in {"slide-deck", "deck", "presentation", "pptx"}:
        return "slide-deck"
    if path.suffix.lower() == ".pptx":
        return "slide-deck"
    return "document"


def _slide_content(document_lines: Sequence[str], artifact_spec: Mapping[str, Any]) -> tuple[str, str, list[str]]:
    title = _string_or_none(artifact_spec.get("title"))
    subtitle = _string_or_none(artifact_spec.get("subtitle"))
    bullets = _string_list(artifact_spec.get("bullets"))
    lines = [line.strip() for line in document_lines if str(line).strip()]
    if title is None:
        for line in lines:
            if line.startswith("#"):
                title = line.lstrip("#").strip()
                break
        if title is None and lines:
            title = lines[0]
    if subtitle is None:
        for line in lines:
            if line and not line.startswith("#") and not line.startswith(("-", "*")):
                subtitle = line
                break
    if not bullets:
        for line in lines:
            stripped = line.lstrip("-* ").strip()
            if stripped and stripped not in {title, subtitle}:
                bullets.append(stripped)
    return title or "Untitled Slide", subtitle or "", bullets[:8]


def _write_one_slide_pptx(path: Path, *, title: str, subtitle: str, bullets: Sequence[str]) -> None:
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    entries = {
        "[Content_Types].xml": _content_types_xml(),
        "_rels/.rels": _root_rels_xml(),
        "docProps/core.xml": _core_xml(now),
        "docProps/app.xml": _app_xml(),
        "ppt/presentation.xml": _presentation_xml(),
        "ppt/_rels/presentation.xml.rels": _presentation_rels_xml(),
        "ppt/slides/slide1.xml": _slide_xml(title, subtitle, bullets),
        "ppt/slides/_rels/slide1.xml.rels": _slide_rels_xml(),
        "ppt/slideLayouts/slideLayout1.xml": _slide_layout_xml(),
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels": _slide_layout_rels_xml(),
        "ppt/slideMasters/slideMaster1.xml": _slide_master_xml(),
        "ppt/slideMasters/_rels/slideMaster1.xml.rels": _slide_master_rels_xml(),
        "ppt/theme/theme1.xml": _theme_xml(),
    }
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, payload in entries.items():
            archive.writestr(name, payload)


def _content_types_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
</Types>
"""


def _root_rels_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
"""


def _core_xml(timestamp: str) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>SciForge Computer Use</dc:creator>
  <cp:lastModifiedBy>SciForge Computer Use</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">{timestamp}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{timestamp}</dcterms:modified>
</cp:coreProperties>
"""


def _app_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>SciForge Computer Use</Application>
  <PresentationFormat>On-screen Show (16:9)</PresentationFormat>
  <Slides>1</Slides>
</Properties>
"""


def _presentation_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId2"/></p:sldMasterIdLst>
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000" type="wide"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>
"""


def _presentation_rels_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
</Relationships>
"""


def _slide_xml(title: str, subtitle: str, bullets: Sequence[str]) -> str:
    bullet_runs = "\n".join(
        f"""        <a:p><a:pPr marL="342900" indent="-171450"><a:buChar char="•"/></a:pPr><a:r><a:rPr lang="en-US" sz="2600"/><a:t>{escape(item)}</a:t></a:r></a:p>"""
        for item in bullets
    )
    subtitle_block = (
        f"""        <a:p><a:r><a:rPr lang="en-US" sz="2400"/><a:t>{escape(subtitle)}</a:t></a:r></a:p>"""
        if subtitle
        else ""
    )
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="685800" y="457200"/><a:ext cx="10820400" cy="914400"/></a:xfrm></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="4200" b="1"/><a:t>{escape(title)}</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="914400" y="1600200"/><a:ext cx="10363200" cy="4343400"/></a:xfrm></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/>
{subtitle_block}
{bullet_runs}
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>
"""


def _slide_rels_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>
"""


def _slide_layout_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" type="titleAndObj" preserve="1">
  <p:cSld name="Title and Content"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>
"""


def _slide_layout_rels_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>
"""


def _slide_master_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>
"""


def _slide_master_rels_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>
"""


def _theme_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="SciForge">
  <a:themeElements>
    <a:clrScheme name="SciForge"><a:dk1><a:srgbClr val="111111"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F8FAFC"/></a:lt2><a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="059669"/></a:accent2><a:accent3><a:srgbClr val="D97706"/></a:accent3><a:accent4><a:srgbClr val="DC2626"/></a:accent4><a:accent5><a:srgbClr val="7C3AED"/></a:accent5><a:accent6><a:srgbClr val="0891B2"/></a:accent6><a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme>
    <a:fontScheme name="SciForge"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme>
    <a:fmtScheme name="SciForge"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle/></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
  </a:themeElements>
</a:theme>
"""


def _string_or_none(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _string_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return [value.strip()]
        if isinstance(parsed, list):
            return [str(item).strip() for item in parsed if str(item).strip()]
    return []
