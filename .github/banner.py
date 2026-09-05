"""
Repository banner, in the Retia Labs system.

    python .github/banner.py

Cream-on-ink is inverted here: the banner is the console panel, because that is
what the product is. Hairline rules, sharp corners, a single sage accent, and
monospaced identifiers. No gradients, no glow, no logo soup.
"""

from PIL import Image, ImageDraw, ImageFont
import os

W, H = 2400, 760
SCALE = 2  # authored at 2x, delivered at 1x for crisp text on GitHub

PANEL_0 = (0x0F, 0x0D, 0x09)
PANEL_1 = (0x1A, 0x17, 0x12)
PANEL_2 = (0x26, 0x21, 0x19)
PANEL_INK = (0xD9, 0xD3, 0xC5)
PANEL_MUTED = (0x9B, 0x94, 0x83)
PANEL_FAINT = (0x7D, 0x76, 0x6A)
SAGE = (0x5E, 0x9B, 0x79)
TRUSTED = (0x2C, 0x5A, 0x4E)
CONTESTED = (0xB0, 0x7A, 0x22)

FONTS = r"C:\Windows\Fonts"


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


DISPLAY = "georgia.ttf"
DISPLAY_I = "georgiai.ttf"
SANS = "segoeui.ttf"
MONO = "consola.ttf"


def tracked(draw, xy, text, f, fill, spacing):
    """Letter-spaced label. PIL has no tracking, so step glyph by glyph."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=f, fill=fill)
        x += draw.textlength(ch, font=f) + spacing
    return x


def build():
    img = Image.new("RGB", (W, H), PANEL_0)
    d = ImageDraw.Draw(img)

    m = 120

    # eyebrow
    tracked(d, (m, 96), "SINGHACKS 2026  ·  RIPPLE  ·  AI-NATIVE BUSINESS ON XRPL",
            font(MONO, 26), PANEL_FAINT, 5)
    d.rectangle([m, 156, W - m, 158], fill=PANEL_2)

    # wordmark
    d.text((m, 210), "KIRIM", font=font(DISPLAY, 168), fill=PANEL_INK)

    # tagline
    d.text((m, 420), "Trust before you build.", font=font(DISPLAY_I, 62), fill=SAGE)

    # one-line description
    d.text((m, 520),
           "Milestone payments for construction, released by an agent that examines",
           font=font(SANS, 34), fill=PANEL_MUTED)
    d.text((m, 568), "the evidence, settled on the XRP Ledger.",
           font=font(SANS, 34), fill=PANEL_MUTED)

    # event attribution — the marks of the challenge this was built for,
    # both keyed to single-colour lockups so they sit on the dark ground
    # without fighting the palette. Ripple keeps its own blue.
    def paste_logo(path, height, right_edge, baseline):
        logo = Image.open(os.path.join(os.path.dirname(__file__), "logos", path))
        w = int(logo.width * height / logo.height)
        logo = logo.resize((w, height), Image.LANCZOS)
        x = right_edge - w
        img.paste(logo, (x, baseline - height), logo)
        return x

    lg_baseline = 700
    x_ripple = paste_logo("ripple.png", 46, W - m, lg_baseline)
    d.rectangle([x_ripple - 46, lg_baseline - 46, x_ripple - 45, lg_baseline], fill=PANEL_2)
    x_sing = paste_logo("singhacks.png", 54, x_ripple - 92, lg_baseline + 4)
    f = font(MONO, 22)
    label = "BUILT FOR"
    lw = d.textlength(label, font=f) + len(label) * 5
    tracked(d, (x_sing - lw - 46, lg_baseline - 30), label, f, PANEL_FAINT, 5)

    # state strip — the four escrow states the product actually has
    states = [("FUNDED", TRUSTED), ("HELD", CONTESTED), ("RELEASED", SAGE),
              ("RETURNED", PANEL_FAINT)]
    x = m
    y = 650
    for label, colour in states:
        f = font(MONO, 24)
        w = d.textlength(label, font=f) + len(label) * 4
        d.rectangle([x, y, x + 4, y + 34], fill=colour)
        tracked(d, (x + 20, y + 4), label, f, colour, 4)
        x += w + 90

    # right-hand ledger motif: a milestone credential, as it really appears
    rx = W - m - 780
    d.rectangle([rx, 210, W - m, 600], outline=PANEL_2, width=2)
    d.rectangle([rx, 210, rx + 4, 600], fill=SAGE)
    tracked(d, (rx + 40, 248), "ON-LEDGER CREDENTIAL", font(MONO, 22), SAGE, 5)

    rows = [("type", "KIRIM:PRJ-2026-014:M1"),
            ("subject", "rhayr2jygcxFKDMN4ahdxkVHD4rwZXLvv3"),
            ("uri", "kirim:milestone/PRJ-2026-014/M1"),
            ("accepted", "true")]
    ry = 320
    fk = font(MONO, 24)
    for k, v in rows:
        d.text((rx + 40, ry), k, font=fk, fill=PANEL_FAINT)
        d.text((rx + 230, ry), v, font=fk, fill=PANEL_INK)
        ry += 62

    out = os.path.join(os.path.dirname(__file__), "banner.png")
    img.resize((W // SCALE, H // SCALE), Image.LANCZOS).save(out, optimize=True)
    return out


if __name__ == "__main__":
    print("wrote", build())
