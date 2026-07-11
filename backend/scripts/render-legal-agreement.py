from pathlib import Path
from html import escape
from io import BytesIO
import hashlib
from docx import Document
from docx.oxml.ns import qn
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, PageBreak
from PIL import Image as PILImage

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "legal" / "2026 Tax Assessment Plan Legal Service Agreement - For Direct Sign v1.4.docx"
OUTPUT = ROOT / "legal" / "rendered" / "2026 Tax Assessment Plan Legal Service Agreement - For Direct Sign v1.4.pdf"
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

docx = Document(SOURCE)
styles = getSampleStyleSheet()
body = ParagraphStyle("LegalBody", parent=styles["BodyText"], fontName="Times-Roman", fontSize=10.2, leading=13.2, spaceAfter=6, alignment=TA_JUSTIFY)
center = ParagraphStyle("LegalCenter", parent=body, alignment=TA_CENTER)
right = ParagraphStyle("LegalRight", parent=body, alignment=TA_RIGHT)
title = ParagraphStyle("LegalTitle", parent=body, fontName="Times-Bold", fontSize=14, leading=17, spaceAfter=10, alignment=TA_CENTER)
heading = ParagraphStyle("LegalHeading", parent=body, fontName="Times-Bold", fontSize=10.5, leading=13.5, spaceBefore=5, spaceAfter=4)

story = []
paragraph_count = 0
image_count = 0
for paragraph in docx.paragraphs:
    paragraph_count += 1
    blips = paragraph._p.xpath('.//a:blip')
    for blip in blips:
        rel_id = blip.get(qn('r:embed'))
        if not rel_id:
            continue
        part = docx.part.related_parts[rel_id]
        blob = part.blob
        with PILImage.open(BytesIO(blob)) as raster:
            width, height = raster.size
        max_width, max_height = 3.0 * inch, 0.9 * inch
        scale = min(max_width / width, max_height / height, 1.0)
        story.append(Image(BytesIO(blob), width=width * scale, height=height * scale, hAlign="CENTER" if image_count == 0 else "LEFT"))
        story.append(Spacer(1, 5))
        image_count += 1

    fragments = []
    for run in paragraph.runs:
        text = escape(run.text).replace("\n", "<br/>")
        if not text:
            continue
        if run.bold:
            text = f"<b>{text}</b>"
        if run.italic:
            text = f"<i>{text}</i>"
        if run.underline:
            text = f"<u>{text}</u>"
        fragments.append(text)
    text = "".join(fragments).strip()
    if not text:
        story.append(Spacer(1, 4))
        continue
    alignment = paragraph.alignment
    style = body
    plain = paragraph.text.strip()
    if paragraph_count <= 6 or (plain.isupper() and len(plain) < 140):
        style = title if paragraph_count <= 6 else heading
    elif alignment == 1:
        style = center
    elif alignment == 2:
        style = right
    elif alignment == 0:
        style = ParagraphStyle(f"left-{paragraph_count}", parent=body, alignment=TA_LEFT)
    story.append(Paragraph(text, style))

class NumberedCanvasMixin:
    pass

def page(canvas, document):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColorRGB(0.35, 0.35, 0.35)
    canvas.drawCentredString(letter[0] / 2, 0.42 * inch, f"Tax Assessment Plan Legal Service Agreement | Page {document.page}")
    canvas.restoreState()

pdf = SimpleDocTemplate(str(OUTPUT), pagesize=letter, leftMargin=0.75*inch, rightMargin=0.75*inch, topMargin=0.65*inch, bottomMargin=0.65*inch, title="Tax Assessment Plan Legal Service Agreement", author="Savians")
pdf.build(story, onFirstPage=page, onLaterPages=page)
print(f"paragraphs={paragraph_count}")
print(f"images={image_count}")
print(f"output={OUTPUT}")
print(f"sha256={hashlib.sha256(OUTPUT.read_bytes()).hexdigest()}")