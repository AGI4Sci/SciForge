import json
import zipfile
from pathlib import Path

from sciforge_computer_use.artifact_renderers import (
    render_target_artifact,
    validate_docx_artifact,
    validate_pptx_artifact,
)


def test_validate_pptx_artifact_rejects_missing_slide_part(tmp_path):
    source = write_valid_pptx(tmp_path)
    broken = tmp_path / "missing-slide.pptx"
    rewrite_zip(source, broken, skip={"ppt/slides/slide1.xml"})

    validation = validate_pptx_artifact(broken)

    assert validation["ok"] is False
    assert any("missing required pptx part" in error for error in validation["errors"])
    assert validation["slideCount"] == 1


def test_validate_pptx_artifact_rejects_macro_payload(tmp_path):
    source = write_valid_pptx(tmp_path)
    broken = tmp_path / "macro.pptx"
    rewrite_zip(source, broken, extra={"ppt/vbaProject.bin": b"macro"})

    validation = validate_pptx_artifact(broken)

    assert validation["ok"] is False
    assert any("macro payload is forbidden" in error for error in validation["errors"])


def test_validate_pptx_artifact_rejects_bad_xml(tmp_path):
    source = write_valid_pptx(tmp_path)
    broken = tmp_path / "bad-xml.pptx"
    rewrite_zip(source, broken, replace={"ppt/slides/slide1.xml": b"<broken"})

    validation = validate_pptx_artifact(broken)

    assert validation["ok"] is False
    assert any("xml parse failed for ppt/slides/slide1.xml" in error for error in validation["errors"])


def test_validate_pptx_artifact_rejects_wrong_slide_count(tmp_path):
    source = write_valid_pptx(tmp_path)
    broken = tmp_path / "no-slide-count.pptx"
    rewrite_zip(source, broken, replace={"ppt/presentation.xml": b'<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>'})

    validation = validate_pptx_artifact(broken)

    assert validation["ok"] is False
    assert "pptx slideCount must be 1, got 0" in validation["errors"]


def test_render_slide_deck_artifact_supports_multiple_slides_from_spec(tmp_path):
    path = tmp_path / "multi.pptx"
    metadata = render_target_artifact(
        path,
        document_lines=[],
        scenario={
            "artifactSpec": {
                "kind": "slide-deck",
                "slides": [
                    {"title": "First", "bullets": ["one"]},
                    {"title": "Second", "bullets": ["two"]},
                    {"title": "Third", "bullets": ["three"]},
                ],
            }
        },
    )

    validation = validate_pptx_artifact(path, expected_slide_count=3)
    with zipfile.ZipFile(path) as deck:
        slide3 = deck.read("ppt/slides/slide3.xml").decode("utf8")

    assert metadata["slideCount"] == 3
    assert metadata["titles"] == ["First", "Second", "Third"]
    assert validation["ok"] is True
    assert validation["slideCount"] == 3
    assert "Third" in slide3
    assert validation["textRuns"] == ["First", "one", "Second", "two", "Third", "three"]
    assert validation["textRunCount"] == 6
    assert validation["textCharCount"] > 0
    assert len(validation["normalizedTextSha256"]) == 64


def test_render_word_document_artifact_validates_docx_structure(tmp_path):
    path = tmp_path / "report.docx"
    metadata = render_target_artifact(
        path,
        document_lines=[
            "# Study Report",
            "The visible workflow created a Word-compatible document.",
            "- first finding",
            "- second finding",
            "| Assay | Result |",
            "| A | Pass |",
        ],
        scenario={"artifactSpec": {"kind": "word-document"}},
    )

    validation = validate_docx_artifact(path)
    validation_ref = json.loads(Path(metadata["docxValidationRef"]).read_text(encoding="utf8"))

    assert metadata["artifactKind"] == "word-document"
    assert metadata["artifactFormat"] == "docx"
    assert validation["ok"] is True
    assert validation["titleParagraphCount"] == 1
    assert validation["bulletParagraphCount"] == 2
    assert validation["tableCount"] == 1
    assert validation["tableRowCount"] == 2
    assert validation["tableCellCount"] == 4
    assert "Study Report" in validation["textRuns"]
    assert "first finding" in validation["textRuns"]
    assert validation["textRunCount"] >= 6
    assert validation["textCharCount"] > 0
    assert len(validation["normalizedTextSha256"]) == 64
    assert validation_ref["schemaVersion"] == "sciforge.computer-use.docx-validation.v1"
    assert validation_ref["ok"] is True
    assert validation_ref["textRuns"] == validation["textRuns"]


def test_validate_docx_artifact_rejects_missing_document_part(tmp_path):
    source = write_valid_docx(tmp_path)
    broken = tmp_path / "missing-document.docx"
    rewrite_zip(source, broken, skip={"word/document.xml"})

    validation = validate_docx_artifact(broken)

    assert validation["ok"] is False
    assert any("missing required docx part" in error for error in validation["errors"])


def test_validate_docx_artifact_rejects_macro_payload(tmp_path):
    source = write_valid_docx(tmp_path)
    broken = tmp_path / "macro.docx"
    rewrite_zip(source, broken, extra={"word/vbaProject.bin": b"macro"})

    validation = validate_docx_artifact(broken)

    assert validation["ok"] is False
    assert any("macro payload is forbidden" in error for error in validation["errors"])


def test_validate_docx_artifact_rejects_bad_xml(tmp_path):
    source = write_valid_docx(tmp_path)
    broken = tmp_path / "bad-xml.docx"
    rewrite_zip(source, broken, replace={"word/document.xml": b"<broken"})

    validation = validate_docx_artifact(broken)

    assert validation["ok"] is False
    assert any("xml parse failed for word/document.xml" in error for error in validation["errors"])


def write_valid_pptx(tmp_path: Path) -> Path:
    path = tmp_path / "valid.pptx"
    render_target_artifact(
        path,
        document_lines=["# Deck", "- one", "- two"],
        scenario={"artifactSpec": {"kind": "slide-deck"}},
    )
    return path


def write_valid_docx(tmp_path: Path) -> Path:
    path = tmp_path / "valid.docx"
    render_target_artifact(
        path,
        document_lines=["# Document", "Paragraph", "- bullet", "| A | B |", "| 1 | 2 |"],
        scenario={"artifactSpec": {"kind": "word-document"}},
    )
    return path


def rewrite_zip(source: Path, target: Path, *, skip=None, replace=None, extra=None) -> None:
    skip = set(skip or set())
    replace = dict(replace or {})
    extra = dict(extra or {})
    with zipfile.ZipFile(source) as src, zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as dst:
        for name in src.namelist():
            if name in skip:
                continue
            dst.writestr(name, replace.get(name, src.read(name)))
        for name, payload in extra.items():
            dst.writestr(name, payload)
