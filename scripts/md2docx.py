#!/usr/bin/env python3
"""기획서 Markdown → Word(docx). python-docx 사용.

    python3 scripts/md2docx.py docs/01_프로젝트_기획서.md docs/01_프로젝트_기획서.docx

다루는 것: 제목(#~###), 표(|…|), 글머리(-·1.), 굵게(**…**), 인용(>), 구분선(---),
코드 블록(```mermaid 는 「흐름도」 글 상자로 그대로 옮김 — Word 에서는 그림이 아님).
"""
import re
import sys
from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor, Cm

FONT = '맑은 고딕'


def set_font(run, size=None, bold=None, mono=False, color=None):
    name = 'Consolas' if mono else FONT
    run.font.name = name
    rpr = run._element.get_or_add_rPr()
    fonts = rpr.find(qn('w:rFonts'))
    if fonts is None:
        fonts = OxmlElement('w:rFonts')
        rpr.append(fonts)
    fonts.set(qn('w:eastAsia'), FONT)
    if size:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if color:
        run.font.color.rgb = RGBColor.from_string(color)


def add_inline(par, text, size=10.5, mono=False):
    # **굵게** 와 `코드` 만 처리
    for part in re.split(r'(\*\*[^*]+\*\*|`[^`]+`)', text):
        if not part:
            continue
        if part.startswith('**') and part.endswith('**'):
            set_font(par.add_run(part[2:-2]), size, True)
        elif part.startswith('`') and part.endswith('`'):
            set_font(par.add_run(part[1:-1]), size - 0.5, mono=True)
        else:
            set_font(par.add_run(part), size)


def shade(cell, hex_color):
    tcpr = cell._element.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), hex_color)
    tcpr.append(shd)


def add_table(doc, rows):
    cells = [[c.strip() for c in r.strip().strip('|').split('|')] for r in rows]
    cells = [r for r in cells if not all(re.fullmatch(r':?-{2,}:?', c) for c in r)]
    width = max(len(r) for r in cells)
    t = doc.add_table(rows=len(cells), cols=width)
    t.style = 'Table Grid'
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, r in enumerate(cells):
        for j in range(width):
            c = t.cell(i, j)
            c.text = ''
            p = c.paragraphs[0]
            add_inline(p, r[j] if j < len(r) else '', 9.5)
            if i == 0:
                for run in p.runs:
                    run.bold = True
                shade(c, 'EEF2F7')
    doc.add_paragraph()


def convert(src, dst):
    lines = open(src, encoding='utf-8').read().splitlines()
    doc = Document()
    for s in doc.sections:
        s.left_margin = s.right_margin = Cm(2)
        s.top_margin = s.bottom_margin = Cm(2)
    st = doc.styles['Normal']
    st.font.name = FONT
    st.element.rPr.rFonts.set(qn('w:eastAsia'), FONT)
    st.font.size = Pt(10.5)
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith('```'):
            lang = line[3:].strip()
            block = []
            i += 1
            while i < len(lines) and not lines[i].startswith('```'):
                block.append(lines[i])
                i += 1
            i += 1
            if lang == 'mermaid':
                cap = doc.add_paragraph()
                set_font(cap.add_run('흐름도 (Markdown 판에서는 그림으로 보입니다)'), 9.5, True, color='56616F')
            p = doc.add_paragraph()
            for k, b in enumerate(block):
                r = p.add_run(b.replace('<br/>', ' '))
                set_font(r, 8.5, mono=True)
                if k < len(block) - 1:
                    r.add_break()
            continue
        if line.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].startswith('|'):
                rows.append(lines[i])
                i += 1
            add_table(doc, rows)
            continue
        m = re.match(r'^(#{1,4})\s+(.*)$', line)
        if m:
            level = len(m.group(1))
            hd = doc.add_heading(level=min(level, 3))
            set_font(hd.add_run(m.group(2)), {1: 18, 2: 14, 3: 12, 4: 11}[level], True, color='16202C')
            i += 1
            continue
        if re.match(r'^-{3,}$', line.strip()):
            i += 1
            continue
        m = re.match(r'^(\s*)[-*]\s+(.*)$', line)
        if m:
            p = doc.add_paragraph(style='List Bullet')
            add_inline(p, m.group(2))
            i += 1
            continue
        m = re.match(r'^(\s*)(\d+)\.\s+(.*)$', line)
        if m:
            # Word 의 자동 번호는 문서 전체로 이어져 10장 질문 번호가 밀리므로, 원문 번호를 글자로 둡니다
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.9)
            p.paragraph_format.first_line_indent = Cm(-0.5)
            add_inline(p, m.group(2) + '. ' + m.group(3))
            i += 1
            continue
        if line.startswith('>'):
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.8)
            add_inline(p, line.lstrip('> '))
            i += 1
            continue
        if line.strip():
            add_inline(doc.add_paragraph(), line)
        i += 1
    doc.save(dst)


if __name__ == '__main__':
    convert(sys.argv[1], sys.argv[2])
    print('saved', sys.argv[2])
