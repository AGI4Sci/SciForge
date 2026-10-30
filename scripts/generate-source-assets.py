#!/usr/bin/env python3
"""Reproduce minimal project-authored source assets; Python stdlib only.

Copyright 2026 SciForge contributors. SPDX-License-Identifier: Apache-2.0
No original image, font file, screenshot or third-party artwork is an input.
The owner authorized these new geometric icons and plain-text templates for
this source release. Historical filenames preserve consumer compatibility.
"""
from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]


def png(size, tray=False):
    """A transparent square containing two nested square outlines."""
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)

    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            edge = min(x, y, size - 1 - x, size - 1 - y)
            visible = size // 8 <= edge < size // 4 or 3 * size // 8 <= edge < 7 * size // 16
            color = (0, 0, 0) if tray else (40, 90, 140)
            rows.extend((*color, 255 if visible else 0))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(rows), 9)) + chunk(b'IEND', b'')


def text(token, x, y, width=1100, size=18, footer=False):
    role = ' data-role="footer"' if footer else ''
    return f'  <text x="{x}" y="{y}" font-family="sans-serif" font-size="{size}" fill="#17212B" data-max-width="{width}"{role}>{{{{{token}}}}}</text>'


def layout(name, title, subtitle, columns, footer, extra=()):
    lines = ['<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">',
             '  <!-- New project-authored plain-text layout; Apache-2.0. No inherited artwork. -->',
             '  <rect x="0" y="0" width="1280" height="720" fill="#FFFFFF"/>',
             text(title, 80, 96, size=32), text(subtitle, 80, 140)]
    for x, y, width, tokens in columns:
        lines.extend(text(token, x, y + i * 34, width) for i, token in enumerate(tokens))
    lines.extend(extra)
    lines.append(text(footer, 80, 650, size=14, footer=True))
    lines.append('</svg>')
    target = ROOT / 'packages/workers/ppt-master/ui-kit/sciforge_research/layouts' / name
    target.write_text('\n'.join(lines) + '\n')


def main():
    images = ROOT / 'src/asset/img'
    (images / 'sciforge.png').write_bytes(png(512))
    (images / 'sciforge_tray.png').write_bytes(png(32, tray=True))
    layout('01_cover.svg', 'TITLE_LINE_1', 'TITLE_LINE_2', [
        (80, 210, 1100, ['PROJECT_LABEL', 'SUBTITLE_LINE_1', 'SUBTITLE_LINE_2', 'AUDIENCE', 'DATE_OR_CONTEXT', 'BOUNDARY_NOTE', 'VISUAL_TITLE', 'ASSET_TAG', 'EVIDENCE_TAG', 'VISUAL_CAPTION'])
    ], 'TRACEABILITY_NOTE')
    layout('02_research_question.svg', 'PAGE_TITLE', 'PAGE_SUBTITLE', [
        (80, 220, 520, ['QUESTION_LABEL', 'QUESTION_LINE_1', 'QUESTION_LINE_2', 'WHY_IT_MATTERS_LINE_1', 'WHY_IT_MATTERS_LINE_2', 'BOUNDARY_LINE', 'GUARDRAIL']),
        (660, 220, 520, ['EVIDENCE_LABEL', 'EVIDENCE_1_TITLE', 'EVIDENCE_1_TEXT', 'EVIDENCE_2_TITLE', 'EVIDENCE_2_TEXT', 'EVIDENCE_3_TITLE', 'EVIDENCE_3_TEXT'])
    ], 'SOURCE_TRACE')
    layout('03_method_pipeline.svg', 'PAGE_TITLE', 'PAGE_SUBTITLE', [
        (80, 220, 1100, [f'STEP_{i}_{suffix}' for i in range(1, 5) for suffix in ('TITLE', 'LINE_1', 'LINE_2')])
    ], 'SOURCE_TRACE', [text('GUARDRAIL', 80, 618)])
    # The blank main figure slot and three leader lines remain usable with a
    # caller-supplied figure. No plot data or evidence is fabricated here.
    layout('04_figure_evidence_callout.svg', 'PAGE_TITLE', 'FIGURE_CAPTION', [
        (104, 560, 680, ['FIGURE_SOURCE']),
        (880, 220, 280, ['CALLOUT_1_TITLE', 'CALLOUT_1_LINE_1']),
        (880, 350, 280, ['CALLOUT_2_TITLE', 'CALLOUT_2_LINE_1', 'CALLOUT_2_LINE_2']),
        (880, 480, 280, ['CALLOUT_3_TITLE', 'CALLOUT_3_LINE_1', 'CALLOUT_3_LINE_2'])
    ], 'EVIDENCE_TRACE', [
        '  <rect x="88" y="190" width="704" height="340" fill="none" stroke="#17212B"/>',
        text('FIGURE_ASSET', 104, 360, 672),
        *[f'  <line x1="760" y1="{y}" x2="856" y2="{y}" stroke="#17212B"/>' for y in (230, 360, 490)]
    ])
    layout('05_results_validation.svg', 'PAGE_TITLE', 'PAGE_SUBTITLE', [
        (80, 220, 1100, ['VALIDATION_STATEMENT_LINE_1', 'VALIDATION_STATEMENT_LINE_2']),
        (80, 340, 330, ['RESULT_1', 'RESULT_1_LINE_1', 'RESULT_1_LINE_2']),
        (460, 340, 330, ['RESULT_2', 'RESULT_2_LINE_1', 'RESULT_2_LINE_2']),
        (840, 340, 330, ['RESULT_3', 'RESULT_3_LINE_1', 'RESULT_3_LINE_2']),
        (80, 540, 1100, ['NEXT_STEP_LABEL', 'NEXT_STEP'])
    ], 'SOURCE_TRACE')


if __name__ == '__main__':
    main()
