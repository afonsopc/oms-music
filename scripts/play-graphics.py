#!/usr/bin/env python3
"""Gráficos da ficha da Google Play (store/play/, docs/android.md, "Google Play").

    python3 scripts/play-graphics.py

- icon-512.png: o ícone da app (assets/images/icon.png) a 512x512.
- <língua>/feature-graphic.png: 1024x500, o sino e "OMS Music" no roxo da app.
- <língua>/phone/NN-*.png: 1080x1920 (9:16, o que a Play aceita), a partir
  das capturas da App Store (docs/app-store/screenshots/6.9), sem a barra de
  estado do iPhone, com uma frase por cima. Sem moldura de telemóvel.

Precisa do Pillow e do fontTools (para passar a Inter de woff2 a ttf).
"""
import io
from pathlib import Path

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "store" / "play"
SHOTS = ROOT / "docs" / "app-store" / "screenshots" / "6.9"
PURPLE = (102, 0, 144)
INK = (11, 11, 11)

def inter(size: int, weight: int) -> ImageFont.FreeTypeFont:
    font = TTFont(ROOT / "public" / "fonts" / "inter-4-latin.woff2")
    font.flavor = None
    buf = io.BytesIO()
    font.save(buf)
    buf.seek(0)
    f = ImageFont.truetype(buf, size)
    try:
        f.set_variation_by_axes([weight])
    except Exception:
        pass
    return f

def wide(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(ROOT / "assets" / "fonts" / "OMSWide-Regular.ttf"), size)

CAPTIONS = {
    "pt-PT": {
        "tagline": "O leitor da tua própria música",
        "01-player": "A tua música,\no teu leitor",
        "02-home": "Feito para ti,\ncom a tua música",
        "03-album": "Álbuns e capas\norganizados sozinhos",
        "04-library": "Tudo o que carregaste,\nnum só sítio",
        "05-playlist": "Playlists só tuas\nou com amigos",
        "06-queue": "A fila como\na queres",
    },
    "en-US": {
        "tagline": "The player for your own music",
        "01-player": "Your music,\nyour player",
        "02-home": "Made for you,\nfrom your music",
        "03-album": "Albums and artwork,\norganised for you",
        "04-library": "Everything you uploaded,\nin one place",
        "05-playlist": "Playlists for you\nor your friends",
        "06-queue": "The queue,\nyour way",
    },
}

def gradient(w: int, h: int, top: tuple, bottom: tuple) -> Image.Image:
    im = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / (h - 1)
        d.line([(0, y), (w, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    return im

def rounded(im: Image.Image, r: int) -> Image.Image:
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.width - 1, im.height - 1], r, fill=255)
    out = im.convert("RGBA")
    out.putalpha(mask)
    return out

def icon() -> None:
    Image.open(ROOT / "assets" / "images" / "icon.png").convert("RGB").resize((512, 512), Image.LANCZOS).save(OUT / "icon-512.png")

def feature(lang: str) -> None:
    W, H = 1024, 500
    im = gradient(W, H, (122, 10, 170), (70, 0, 104))
    bell = Image.open(ROOT / "assets" / "images" / "android-icon-foreground.png").convert("RGBA")
    bell = bell.crop((180, 180, 844, 844)).resize((380, 380), Image.LANCZOS)
    im.paste(bell, (40, 60), bell)
    d = ImageDraw.Draw(im)
    d.text((440, 165), "OMS", font=wide(104), fill="white")
    d.text((440, 265), "MUSIC", font=wide(104), fill="white")
    d.text((444, 385), CAPTIONS[lang]["tagline"], font=inter(34, 500), fill=(255, 241, 161))
    (OUT / lang).mkdir(parents=True, exist_ok=True)
    im.save(OUT / lang / "feature-graphic.png")

def phone(lang: str, shot: Path) -> None:
    W, H = 1080, 1920
    im = gradient(W, H, (82, 0, 116), INK)
    src = Image.open(shot).convert("RGB")
    src = src.crop((0, 170, src.width, src.height))  # sem a barra de estado do iPhone
    sh = 1500
    sw = round(src.width * sh / src.height)
    src = rounded(src.resize((sw, sh), Image.LANCZOS), 44)
    x, y = (W - sw) // 2, H - sh - 70
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([x, y + 10, x + sw, y + sh + 10], 44, fill=(0, 0, 0, 170))
    im = Image.alpha_composite(im.convert("RGBA"), shadow.filter(ImageFilter.GaussianBlur(24)))
    im.alpha_composite(src, (x, y))
    border = ImageDraw.Draw(im)
    border.rounded_rectangle([x, y, x + sw - 1, y + sh - 1], 44, outline=(255, 255, 255, 40), width=2)
    d = ImageDraw.Draw(im)
    d.multiline_text((W // 2, 205), CAPTIONS[lang][shot.stem], font=inter(64, 700), fill="white",
                     anchor="mm", align="center", spacing=14)
    (OUT / lang / "phone").mkdir(parents=True, exist_ok=True)
    im.convert("RGB").save(OUT / lang / "phone" / f"{shot.stem}.png")

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    icon()
    for lang in CAPTIONS:
        feature(lang)
        for shot in sorted(SHOTS.glob("*.jpg")):
            phone(lang, shot)
    print("feito:", OUT)
