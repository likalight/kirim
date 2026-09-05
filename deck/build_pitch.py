"""
KIRIM — the short pitch. Six slides, built to be presented in three minutes.

    python deck/build_pitch.py

Retia Labs design system. Icons are drawn from primitives rather than pulled
from a set, so they sit in the same geometric language as the rest of the deck —
hairlines, sharp corners, one accent.
"""

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
import json
import os

# ---------------------------------------------------------------- Retia tokens
PAPER_0 = RGBColor(0xFA, 0xF6, 0xEE)
PAPER_1 = RGBColor(0xF1, 0xEC, 0xE1)
PAPER_2 = RGBColor(0xE8, 0xE2, 0xD4)
PAPER_3 = RGBColor(0xDE, 0xD7, 0xC6)
INK_0 = RGBColor(0x17, 0x13, 0x0D)
INK_2 = RGBColor(0x51, 0x4A, 0x3C)
INK_3 = RGBColor(0x6A, 0x63, 0x56)
INK_4 = RGBColor(0x8C, 0x84, 0x67)
PANEL_0 = RGBColor(0x0F, 0x0D, 0x09)
PANEL_1 = RGBColor(0x1A, 0x17, 0x12)
PANEL_2 = RGBColor(0x26, 0x21, 0x19)
PANEL_INK = RGBColor(0xD9, 0xD3, 0xC5)
PANEL_MUTED = RGBColor(0x9B, 0x94, 0x83)
PANEL_FAINT = RGBColor(0x7D, 0x76, 0x6A)
TRUSTED = RGBColor(0x2C, 0x5A, 0x4E)
CONTESTED = RGBColor(0xB0, 0x7A, 0x22)
QUARANTINED = RGBColor(0xA2, 0x3B, 0x2C)
RESTRICTED = RGBColor(0x7A, 0x2E, 0x2E)
SAGE = RGBColor(0x5E, 0x9B, 0x79)
TRUSTED_TINT = RGBColor(0xDC, 0xE6, 0xE0)
CONTESTED_TINT = RGBColor(0xEF, 0xE4, 0xCB)
QUARANTINED_TINT = RGBColor(0xEF, 0xDA, 0xD2)

DISPLAY = "Georgia"
SANS = "Segoe UI"
MONO = "Consolas"

W = Inches(13.333)
H = Inches(7.5)
M = Inches(0.9)
CW = W - 2 * M
LOGO_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".github", "logos")


# ---------------------------------------------------------------- primitives
def letterspace(run, ems):
    run._r.get_or_add_rPr().set("spc", str(int(ems * 100)))


def textbox(slide, x, y, w, h, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP):
    box = slide.shapes.add_textbox(x, y, w, h)
    tf = box.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    tf.paragraphs[0].alignment = align
    return tf


def write(tf, text, *, font=SANS, size=15, color=INK_0, bold=False, italic=False,
          spacing=0.0, line=1.35, space_after=0, first=False, align=None):
    p = tf.paragraphs[0] if first else tf.add_paragraph()
    if align is not None:
        p.alignment = align
    p.line_spacing = line
    p.space_after = Pt(space_after)
    r = p.add_run()
    r.text = text
    r.font.name = font
    r.font.size = Pt(size)
    r.font.bold = bold
    r.font.italic = italic
    r.font.color.rgb = color
    if spacing:
        letterspace(r, spacing)
    return p


def box(slide, x, y, w, h, fill=None, line_color=None, line_w=Pt(0.75)):
    sh = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, w, h)
    if fill is None:
        sh.fill.background()
    else:
        sh.fill.solid()
        sh.fill.fore_color.rgb = fill
    if line_color is None:
        sh.line.fill.background()
    else:
        sh.line.color.rgb = line_color
        sh.line.width = line_w
    sh.shadow.inherit = False
    return sh


def rule(slide, x, y, w, color=PAPER_3, weight=Pt(0.9)):
    sh = box(slide, x, y, w, Emu(int(weight.emu / 2)), fill=color)
    return sh


def slide_base(prs, bg=PAPER_1):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    bg_shape = box(s, 0, 0, W, H, fill=bg)
    bg_shape._element.getparent().remove(bg_shape._element)
    s.shapes._spTree.insert(2, bg_shape._element)
    return s


def eyebrow(slide, text, y=Inches(0.6), color=INK_4, x=M):
    tf = textbox(slide, x, y, CW, Inches(0.25))
    write(tf, text.upper(), font=MONO, size=10.5, color=color, spacing=0.18, first=True)


def footer(slide, left, right, color=INK_4, line=PAPER_3):
    rule(slide, M, H - Inches(0.7), CW, color=line)
    tf = textbox(slide, M, H - Inches(0.55), CW / 2, Inches(0.3))
    write(tf, left, font=MONO, size=9.5, color=color, spacing=0.12, first=True)
    tf2 = textbox(slide, M + CW / 2, H - Inches(0.55), CW / 2, Inches(0.3), align=PP_ALIGN.RIGHT)
    write(tf2, right, font=MONO, size=9.5, color=color, spacing=0.12, first=True, align=PP_ALIGN.RIGHT)


def logos(slide, top, right=None, dark=False):
    right = right or (W - M)
    pic = slide.shapes.add_picture(os.path.join(LOGO_DIR, "ripple.png"), Emu(0), top, height=Inches(0.28))
    pic.left = Emu(int(right - pic.width))
    div = box(slide, Emu(int(pic.left - Inches(0.26))), top - Inches(0.02),
              Emu(9525), Inches(0.32), fill=PANEL_2 if dark else PAPER_3)
    pic2 = slide.shapes.add_picture(os.path.join(LOGO_DIR, "singhacks.png"), Emu(0),
                                    top - Inches(0.02), height=Inches(0.32))
    pic2.left = Emu(int(pic.left - Inches(0.52) - pic2.width))
    tf = textbox(slide, Emu(int(pic2.left - Inches(1.3))), top + Inches(0.02),
                 Inches(1.1), Inches(0.3), align=PP_ALIGN.RIGHT)
    write(tf, "BUILT FOR", font=MONO, size=9, color=PANEL_FAINT if dark else INK_4,
          spacing=0.16, first=True, align=PP_ALIGN.RIGHT)


# ---------------------------------------------------------------- icons
# Drawn from primitives so they share the deck's geometry: hairline strokes,
# sharp corners, one accent colour. No icon set, no emoji.
def _stroke(slide, x, y, w, h, colour, weight=Inches(0.035)):
    return box(slide, x, y, w, h, fill=colour)


def icon_building(slide, x, y, size, colour):
    """Tower under construction: a stack of floors and a crane arm."""
    u = size / 10
    box(slide, x + u * 2, y + u * 3, u * 5, u * 7, fill=None, line_color=colour, line_w=Pt(1.6))
    for i in range(3):
        _stroke(slide, x + u * 2, y + u * (4.6 + i * 1.6), u * 5, Emu(int(u * 0.09)), colour)
    # crane mast and jib
    _stroke(slide, x + u * 8, y + u * 0.6, Emu(int(u * 0.12)), u * 9.4, colour)
    _stroke(slide, x + u * 3.4, y + u * 0.6, u * 5.4, Emu(int(u * 0.12)), colour)
    _stroke(slide, x + u * 4.2, y + u * 0.6, Emu(int(u * 0.1)), u * 1.5, colour)


def icon_lock(slide, x, y, size, colour):
    """Escrow: a closed lock."""
    u = size / 10
    box(slide, x + u * 1.6, y + u * 4.4, u * 6.8, u * 5, fill=None, line_color=colour, line_w=Pt(1.6))
    shackle = slide.shapes.add_shape(MSO_SHAPE.BLOCK_ARC, x + u * 2.6, y + u * 1.2, u * 4.8, u * 5.2)
    shackle.fill.background()
    shackle.line.color.rgb = colour
    shackle.line.width = Pt(1.6)
    shackle.shadow.inherit = False
    _stroke(slide, x + u * 4.85, y + u * 6.1, Emu(int(u * 0.3)), u * 1.6, colour)


def icon_shield(slide, x, y, size, colour):
    """Trust: a shield with a check."""
    u = size / 10
    sh = slide.shapes.add_shape(MSO_SHAPE.PENTAGON, x + u * 1.5, y + u * 1.2, u * 7, u * 7.6)
    sh.rotation = 90
    sh.fill.background()
    sh.line.color.rgb = colour
    sh.line.width = Pt(1.6)
    sh.shadow.inherit = False
    tick1 = _stroke(slide, x + u * 3.6, y + u * 5.4, u * 1.9, Emu(int(u * 0.32)), colour)
    tick1.rotation = 45
    tick2 = _stroke(slide, x + u * 4.6, y + u * 4.4, u * 3.2, Emu(int(u * 0.32)), colour)
    tick2.rotation = -45


def icon_camera(slide, x, y, size, colour):
    """Evidence: a photograph with a location pin."""
    u = size / 10
    box(slide, x + u * 1.2, y + u * 2.8, u * 7.6, u * 5.4, fill=None, line_color=colour, line_w=Pt(1.6))
    _stroke(slide, x + u * 3.4, y + u * 1.9, u * 3.2, Emu(int(u * 0.12)), colour)
    lens = slide.shapes.add_shape(MSO_SHAPE.OVAL, x + u * 3.7, y + u * 4.1, u * 2.6, u * 2.6)
    lens.fill.background()
    lens.line.color.rgb = colour
    lens.line.width = Pt(1.4)
    lens.shadow.inherit = False


def icon_coins(slide, x, y, size, colour):
    """Payment: stacked value moving."""
    u = size / 10
    for i, wdt in enumerate([6.4, 5.2, 4.0]):
        e = slide.shapes.add_shape(MSO_SHAPE.OVAL, x + u * (1.6 + (6.4 - wdt) / 2),
                                   y + u * (6.6 - i * 2.0), u * wdt, u * 1.5)
        e.fill.background()
        e.line.color.rgb = colour
        e.line.width = Pt(1.4)
        e.shadow.inherit = False


def icon_clock(slide, x, y, size, colour):
    """Time: what everyone is waiting for."""
    u = size / 10
    c = slide.shapes.add_shape(MSO_SHAPE.OVAL, x + u * 1.2, y + u * 1.2, u * 7.6, u * 7.6)
    c.fill.background()
    c.line.color.rgb = colour
    c.line.width = Pt(1.6)
    c.shadow.inherit = False
    _stroke(slide, x + u * 4.9, y + u * 2.6, Emu(int(u * 0.26)), u * 2.6, colour)
    _stroke(slide, x + u * 5.0, y + u * 4.9, u * 2.2, Emu(int(u * 0.26)), colour)


# ---------------------------------------------------------------- the pitch
def build(hashes):
    prs = Presentation()
    prs.slide_width, prs.slide_height = W, H

    # ============================================================ 1 — the hook
    s = slide_base(prs, PANEL_0)
    eyebrow(s, "SingHacks 2026 · Ripple · AI-native business on XRPL", color=PANEL_FAINT)
    rule(s, M, Inches(1.05), CW, color=PANEL_2)

    tf = textbox(s, M, Inches(1.7), Inches(9.4), Inches(2.6))
    write(tf, "A trillion dollars was spent", font=DISPLAY, size=46, color=PANEL_INK,
          line=1.12, first=True)
    write(tf, "finishing homes people had", font=DISPLAY, size=46, color=PANEL_INK, line=1.12)
    write(tf, "already paid for.", font=DISPLAY, size=46, color=CONTESTED, line=1.12)

    tf = textbox(s, M, Inches(4.6), Inches(8.4), Inches(1.0))
    write(tf, "The money was never missing. It sat in escrow the whole time. "
              "Somebody just had to decide it could be released — and that decision "
              "is still made by hand.",
          font=SANS, size=16, color=PANEL_MUTED, line=1.5, first=True)

    rule(s, M, Inches(5.75), CW, color=PANEL_2)
    tf = textbox(s, M, Inches(6.0), Inches(7.0), Inches(1.0))
    write(tf, "KIRIM", font=DISPLAY, size=44, color=PANEL_INK, line=1.0, first=True)
    tf2 = textbox(s, M + Inches(2.5), Inches(6.28), Inches(6.4), Inches(0.8))
    write(tf2, "Construction escrow, released by an agent that examines the evidence. "
               "Settled on the XRP Ledger.",
          font=SANS, size=13.5, color=PANEL_MUTED, line=1.45, first=True)
    logos(s, Inches(6.45), dark=True)

    icon_building(s, W - M - Inches(2.9), Inches(1.8), Inches(2.6), PANEL_2)

    # ============================================================ 2 — problem
    s = slide_base(prs)
    eyebrow(s, "The problem")
    tf = textbox(s, M, Inches(0.95), Inches(10.9), Inches(1.6))
    write(tf, "Somebody pays before it exists.",
          font=DISPLAY, size=34, color=INK_0, line=1.1, first=True)
    write(tf, "Somebody decides when that money is released.",
          font=DISPLAY, size=34, color=TRUSTED, line=1.1)

    icon_lock(s, W - M - Inches(1.9), Inches(0.95), Inches(1.7), PAPER_3)

    stats = [
        ("85%", "of new homes in China are\nsold before they are built"),
        ("50–70%", "of pre-sale money sits in escrow\ncontrolled by local government"),
        ("US$300bn", "of Evergrande liabilities — buyers\nwho paid in full got nothing"),
        ("¥7tn", "of state financing to finish\n7.5m homes already paid for"),
    ]
    y = Inches(3.0)
    colw = (CW - Inches(0.9)) / 2
    for i, (big, label) in enumerate(stats):
        x = M + (i % 2) * (colw + Inches(0.9))
        yy = y + (i // 2) * Inches(1.55)
        tf = textbox(s, x, yy, Inches(2.5), Inches(0.7))
        write(tf, big, font=DISPLAY, size=34, color=RESTRICTED if i in (2,) else INK_0,
              line=1.0, first=True)
        tf2 = textbox(s, x + Inches(2.6), yy + Inches(0.05), colw - Inches(2.7), Inches(1.0))
        for j, ln in enumerate(label.split("\n")):
            write(tf2, ln, font=SANS, size=13, color=INK_2, line=1.35, first=(j == 0))
        rule(s, x, yy + Inches(1.15), colw, color=PAPER_3)

    tf = textbox(s, M, Inches(5.95), CW, Inches(0.7))
    write(tf, "The escrow already exists, at national scale. What fails is the release.",
          font=DISPLAY, size=19, color=INK_2, italic=True, line=1.35, first=True)
    footer(s, "KIRIM", "01 / PROBLEM")

    # ============================================================ 3 — current
    s = slide_base(prs, PANEL_0)
    eyebrow(s, "How it works today", color=PANEL_FAINT)
    tf = textbox(s, M, Inches(0.95), Inches(10.5), Inches(1.0))
    write(tf, "A person decides, city by city. It fails in both directions.",
          font=DISPLAY, size=34, color=PANEL_INK, line=1.1, first=True)

    left = [("TOO TIGHT", CONTESTED,
             "2021 — cities froze withdrawals from escrow. Developers ran out of cash "
             "mid-build and construction stopped. A February 2022 framework was issued "
             "explicitly to “correct over-tightening”."),
            ("TOO LOOSE", QUARANTINED,
             "Evergrande collapsed owing around US$300bn. Buyers who had paid in full "
             "were left with unfinished flats, and some stopped paying mortgages on "
             "homes that did not exist.")]
    y = Inches(2.3)
    colw2 = (CW - Inches(0.6)) / 2
    for i, (title, colour, body) in enumerate(left):
        x = M + i * (colw2 + Inches(0.6))
        box(s, x, y, colw2, Inches(2.15), fill=PANEL_1, line_color=PANEL_2)
        box(s, x, y, Inches(0.05), Inches(2.15), fill=colour)
        tf = textbox(s, x + Inches(0.3), y + Inches(0.26), colw2 - Inches(0.6), Inches(1.7))
        write(tf, title, font=MONO, size=11, color=colour, spacing=0.14, bold=True,
              first=True, space_after=10)
        write(tf, body, font=SANS, size=13.5, color=PANEL_MUTED, line=1.45)

    icon_clock(s, M, Inches(4.85), Inches(1.1), PANEL_2)
    tf = textbox(s, M + Inches(1.4), Inches(4.95), Inches(10.2), Inches(1.4))
    write(tf, "Release is a manual, discretionary decision, taken by officials who cannot "
              "possibly inspect every project, under rules that differ in every city.",
          font=SANS, size=15.5, color=PANEL_MUTED, line=1.5, first=True, space_after=8)
    write(tf, "Too slow and honest builders starve. Too loose and buyers lose homes "
              "they have already paid for.",
          font=DISPLAY, size=17, color=CONTESTED, italic=True, line=1.4)

    footer(s, "KIRIM · CURRENT STATE", "02 / TODAY", color=PANEL_FAINT, line=PANEL_2)

    # ============================================================ 4 — solution
    s = slide_base(prs)
    eyebrow(s, "Our solution")
    tf = textbox(s, M, Inches(0.95), Inches(10.0), Inches(1.0))
    write(tf, "Release on evidence, not on somebody's judgement.",
          font=DISPLAY, size=36, color=INK_0, line=1.1, first=True)

    steps = [
        (icon_lock, "MONEY LOCKED", "Escrowed on XRPL under a crypto-condition. "
                                    "Nobody can spend it — including us."),
        (icon_camera, "EVIDENCE SUBMITTED", "Photographs with a time and a place, delivery "
                                           "notes, permits. Checkable, not just viewable."),
        (icon_shield, "AGENT EXAMINES", "It buys the checks it needs and reconciles them "
                                        "against the agreed scope."),
        (icon_coins, "RELEASED IN ~4s", "Or held, with the reason named. Each release writes "
                                        "a credential to the builder's account."),
    ]
    cw4 = (CW - Inches(0.75)) / 4
    y = Inches(2.35)
    for i, (icon, title, body) in enumerate(steps):
        x = M + i * (cw4 + Inches(0.25))
        box(s, x, y, cw4, Inches(2.55), fill=PAPER_0, line_color=PAPER_3)
        box(s, x, y, cw4, Inches(0.05), fill=TRUSTED if i == 3 else PAPER_3)
        icon(s, x + Inches(0.24), y + Inches(0.3), Inches(0.85), TRUSTED if i == 3 else INK_3)
        tf = textbox(s, x + Inches(0.24), y + Inches(1.28), cw4 - Inches(0.48), Inches(1.2))
        write(tf, title, font=MONO, size=10, color=INK_4, spacing=0.14, first=True, space_after=8)
        write(tf, body, font=SANS, size=12.5, color=INK_2, line=1.38)

    tf = textbox(s, M, Inches(5.35), CW, Inches(0.9))
    write(tf, "Remove the agent and you need a site visit for every payment. Remove "
              "autonomous payment and the escrow is just an invoice again.",
          font=DISPLAY, size=18, color=INK_2, italic=True, line=1.35, first=True)
    footer(s, "KIRIM", "03 / SOLUTION")

    # ============================================================ 5 — benefits
    s = slide_base(prs)
    eyebrow(s, "What it is measurably better at")
    tf = textbox(s, M, Inches(0.95), Inches(10.0), Inches(1.0))
    write(tf, "Every number here came off the ledger, not a projection.",
          font=DISPLAY, size=34, color=INK_0, line=1.1, first=True)

    rows = [
        ("Time to release a milestone", "weeks, city by city", "~4 seconds", TRUSTED),
        ("Cost of holding the money", "3–5% to an escrow agent", "0.8%", TRUSTED),
        ("Cost of checking the work", "a site visit, a day of someone's time", "US$0.48", TRUSTED),
        ("Builder paid after evidence", "30–60 day terms", "on presentation", TRUSTED),
        ("Nothing delivered", "dispute, or write-off", "escrow returns it", TRUSTED),
        ("Builder's reputation", "a folder of photos", "credential on their ledger account", TRUSTED),
    ]
    y = Inches(2.15)
    rule(s, M, y - Inches(0.14), CW, color=PAPER_3)
    for label, before, after, colour in rows:
        tf = textbox(s, M, y, Inches(3.5), Inches(0.4))
        write(tf, label, font=SANS, size=13.5, color=INK_0, bold=True, first=True)
        tf = textbox(s, M + Inches(3.6), y + Inches(0.02), Inches(3.7), Inches(0.4))
        write(tf, before, font=SANS, size=13, color=INK_4, first=True)
        tf = textbox(s, M + Inches(7.6), y + Inches(0.02), Inches(3.9), Inches(0.4),
                     align=PP_ALIGN.RIGHT)
        write(tf, after, font=SANS, size=13.5, color=colour, bold=True, first=True,
              align=PP_ALIGN.RIGHT)
        y += Inches(0.52)
        rule(s, M, y - Inches(0.12), CW, color=PAPER_2)

    box(s, M, Inches(5.5), CW, Inches(1.05), fill=TRUSTED_TINT)
    tf = textbox(s, M + Inches(0.3), Inches(5.72), CW - Inches(0.6), Inches(0.8))
    write(tf, "Three of six milestones in our demo end with no payment at all — held, "
              "flagged, or returned.", font=DISPLAY, size=17, color=TRUSTED, italic=True,
          line=1.35, first=True, space_after=4)
    write(tf, "A payment that correctly does not happen is what makes an autonomous "
              "payment system worth trusting.", font=SANS, size=13, color=INK_2, line=1.35)
    footer(s, "KIRIM", "04 / BENEFITS")

    # ============================================================ 6 — demo
    s = slide_base(prs, PANEL_0)
    eyebrow(s, "The demo", color=PANEL_FAINT)
    tf = textbox(s, M, Inches(0.95), Inches(10.4), Inches(1.0))
    write(tf, "Watch a milestone pay itself. Then watch one refuse to.",
          font=DISPLAY, size=34, color=PANEL_INK, line=1.1, first=True)

    beats = [
        ("M1", "Evidence conforms", "released in 58s · fee charged · credential written", SAGE),
        ("M2", "A photo taken 2.3km off site", "flagged — the money stays put", CONTESTED),
        ("M3", "One photo of three", "more information needed — no mark on the builder", CONTESTED),
        ("M5", "Above the client's ceiling", "she signs from her own wallet, then it releases", SAGE),
        ("M6", "Nothing ever submitted", "escrow times out, the money goes home", QUARANTINED),
    ]
    y = Inches(2.2)
    for mid, what, outcome, colour in beats:
        box(s, M, y, Inches(0.05), Inches(0.44), fill=colour)
        tf = textbox(s, M + Inches(0.25), y + Inches(0.03), Inches(0.6), Inches(0.4))
        write(tf, mid, font=MONO, size=12, color=PANEL_FAINT, first=True)
        tf = textbox(s, M + Inches(0.95), y + Inches(0.02), Inches(4.3), Inches(0.4))
        write(tf, what, font=SANS, size=13.5, color=PANEL_INK, bold=True, first=True)
        tf = textbox(s, M + Inches(5.4), y + Inches(0.03), Inches(6.1), Inches(0.4))
        write(tf, outcome, font=SANS, size=13, color=PANEL_MUTED, first=True)
        y += Inches(0.62)

    rule(s, M, Inches(5.5), CW, color=PANEL_2)
    tf = textbox(s, M, Inches(5.72), Inches(6.6), Inches(1.0))
    write(tf, "Every payment is real on XRPL testnet. Evidence is bought over the "
              "Machine Payments Protocol and settles in RLUSD.",
          font=SANS, size=13, color=PANEL_MUTED, line=1.45, first=True)

    tf = textbox(s, M + Inches(7.0), Inches(5.72), Inches(4.5), Inches(1.0))
    for i, (label, h) in enumerate(hashes[:3]):
        write(tf, h[:38] + "…", font=MONO, size=9.5, color=SAGE, line=1.5, first=(i == 0))
    write(tf, "testnet.xrpl.org", font=MONO, size=9.5, color=PANEL_FAINT, line=1.5)

    footer(s, "KIRIM · LESS BLIND TRUST. MORE VISIBLE PROOF.", "05 / DEMO",
           color=PANEL_FAINT, line=PANEL_2)

    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "KIRIM-pitch.pptx")
    prs.save(out)
    return out


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "hashes.json"), encoding="utf-8") as f:
        hashes = [(h["label"], h["hash"]) for h in json.load(f)]
    print("wrote", build(hashes))
