#!/usr/bin/env python3
"""
OMS Wide - gerador da fonte display do oms-music / omelhorsite.

Substitui a DrukWide-Super-Trial.otf, que e uma trial da Commercial Type e nao
pode ser redistribuida (os repos vao a publico e os bundles ja a levavam
dentro). Esta e desenhada de raiz: um grotesco ultra-largo e ultra-preto,
terminais horizontais, contraforma minima.

    python generate-oms-wide.py <destino.ttf>

As PROPORCOES (altura de maiuscula e de x, espessura de haste e barra, avanco
de cada letra, transbordo das redondas, e a geometria dos cantos: uma unica
cubica por quadrante com pegas assimetricas) foram medidas na Druk Wide Super
para que a troca nao mexa em nenhum layout ja feito. Medir metricas nao e
copiar contornos: nenhuma curva daqui saiu de la, todas nascem das formulas
abaixo.

Construcao: cada glifo e uma lista de contornos aplicados POR ORDEM com
operacoes booleanas (skia-pathops) - os pintados unem-se, os "buracos"
subtraem-se. Por isso a ordem importa: uma haste que atravessa uma
contraforma vem DEPOIS dela.
"""
import sys
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from pathops import LineCap, LineJoin, Path, PathOp, op as pathop

# --- METRICA (medida na Druk Wide Super) -----------------------------------
UPM = 1000
CAP = 744           # altura de maiuscula
XH = 538            # altura de x
ASC = 744           # ascendente: igual a maiuscula
DESC = -188         # descendente
OVER = 15           # transbordo das redondas acima/abaixo da linha

VC = 380            # haste vertical, maiuscula de lados rectos (o 'I' mede isto)
VCR = 391           # haste vertical, maiuscula redonda (compensacao optica)
HC = 238            # barra horizontal com DUAS por altura (O, D, C, U)
HS = 193            # barra horizontal com TRES por altura (B, E, S, 3, 8)

VL = 366            # haste vertical, minuscula
VLR = 369           # idem, redonda
HL = 168            # barra horizontal, duas por altura de x
HSL = 139           # barra horizontal, tres por altura de x (e, s, a)

MID = CAP / 2
MIDX = XH / 2
OUT = 80            # quanto um corte de abertura passa para fora da letra


# --- CANTOS ----------------------------------------------------------------
# Um canto e (rx, ry, kx, ky): a curva ocupa rx na horizontal e ry na
# vertical; kx/ky e a fraccao de cada pega ao longo da respectiva aresta. Na
# Druk os cantos exteriores sao quase metade da letra, com a pega horizontal
# longa (topo plano ate muito tarde) e a vertical curta (lado quase recto).
def C(rx, ry, kx=0.86, ky=0.43):
    return (rx, ry, kx, ky)


def OC(w, h):
    """Canto exterior, maiusculas."""
    return C(w * 0.48, h * 0.48, 0.86, 0.43)


def CC(w, h):
    """Contraforma, maiusculas."""
    return C(w * 0.50, h * 0.48, 0.76, 0.46)


def OL(w, h):
    """Canto exterior, minusculas: topo ainda mais plano, canto mais fechado."""
    return C(w * 0.46, h * 0.49, 0.92, 0.36)


def CL(w, h):
    """Contraforma, minusculas."""
    return C(w * 0.50, h * 0.50, 0.84, 0.40)


def SH(w, h):
    """Ombro do n/h/m: mais estreito, entra quase a direito na haste."""
    return C(w * 0.47, h * 0.36, 0.85, 0.28)


def AR(w, h):
    """Arco interior do n/h/m/u."""
    return C(w * 0.50, min(h * 0.5, 105), 0.74, 0.51)


# --- CONTORNOS -------------------------------------------------------------
class Contour:
    def __init__(self, start, filled=True):
        self.start = start
        self.segs = []
        self.filled = filled

    def line(self, p):
        self.segs.append(("l", p))
        return self

    def curve(self, c1, c2, p):
        self.segs.append(("c", c1, c2, p))
        return self

    def shift(self, dx):
        out = Contour((self.start[0] + dx, self.start[1]), self.filled)
        for s in self.segs:
            if s[0] == "l":
                out.line((s[1][0] + dx, s[1][1]))
            else:
                out.curve((s[1][0] + dx, s[1][1]), (s[2][0] + dx, s[2][1]),
                          (s[3][0] + dx, s[3][1]))
        return out

    def draw(self, pen):
        pen.moveTo(self.start)
        for s in self.segs:
            if s[0] == "l":
                pen.lineTo(s[1])
            else:
                pen.curveTo(s[1], s[2], s[3])
        pen.closePath()


def hole(c):
    c.filled = False
    return c


def rect(x0, y0, x1, y1):
    return Contour((x0, y0)).line((x0, y1)).line((x1, y1)).line((x1, y0))


def _norm(v):
    if not v:
        return (0.0, 0.0, 0.0, 0.0)
    if len(v) == 2:
        return (v[0], v[1], 0.55, 0.55)
    return tuple(float(x) for x in v)


def rrect(x0, y0, x1, y1, tl=None, tr=None, br=None, bl=None):
    """Rectangulo de cantos curvos; cada canto e None ou C(rx, ry, kx, ky).
    Dois cantos na mesma aresta nunca somam mais do que a aresta."""
    w, h = x1 - x0, y1 - y0
    tl, tr, br, bl = (list(_norm(v)) for v in (tl, tr, br, bl))
    for a, b, size in ((tl, tr, w), (bl, br, w)):
        if a[0] + b[0] > size:
            f = size / (a[0] + b[0])
            a[0] *= f
            b[0] *= f
    for a, b, size in ((tl, bl, h), (tr, br, h)):
        if a[1] + b[1] > size:
            f = size / (a[1] + b[1])
            a[1] *= f
            b[1] *= f
    c = Contour((x0, y0 + bl[1]))
    c.line((x0, y1 - tl[1]))
    if tl[0] and tl[1]:
        c.curve((x0, y1 - tl[1] + tl[3] * tl[1]), (x0 + tl[0] - tl[2] * tl[0], y1),
                (x0 + tl[0], y1))
    c.line((x1 - tr[0], y1))
    if tr[0] and tr[1]:
        c.curve((x1 - tr[0] + tr[2] * tr[0], y1), (x1, y1 - tr[1] + tr[3] * tr[1]),
                (x1, y1 - tr[1]))
    c.line((x1, y0 + br[1]))
    if br[0] and br[1]:
        c.curve((x1, y0 + br[1] - br[3] * br[1]), (x1 - br[0] + br[2] * br[0], y0),
                (x1 - br[0], y0))
    c.line((x0 + bl[0], y0))
    if bl[0] and bl[1]:
        c.curve((x0 + bl[0] - bl[2] * bl[0], y0), (x0, y0 + bl[1] - bl[3] * bl[1]),
                (x0, y0 + bl[1]))
    return c


def poly(pts):
    c = Contour(pts[0])
    for p in pts[1:]:
        c.line(p)
    return c


def hbar(p0, p1, w):
    """Diagonal de espessura HORIZONTAL: topos cortados a direito."""
    (x0, y0), (x1, y1) = p0, p1
    return poly([(x0 - w / 2, y0), (x0 + w / 2, y0), (x1 + w / 2, y1), (x1 - w / 2, y1)])


def vbar(p0, p1, t):
    """Diagonal de espessura VERTICAL: topos cortados na vertical."""
    (x0, y0), (x1, y1) = p0, p1
    return poly([(x0, y0 - t / 2), (x0, y0 + t / 2), (x1, y1 + t / 2), (x1, y1 - t / 2)])


def ring(x0, y0, x1, y1, v, h, outer=OC, inner=CC):
    w, hh = x1 - x0, y1 - y0
    o = outer(w, hh)
    i = inner(w - 2 * v, hh - 2 * h)
    return [rrect(x0, y0, x1, y1, o, o, o, o),
            hole(rrect(x0 + v, y0 + h, x1 - v, y1 - h, i, i, i, i))]



# --- PENA ELIPTICA -----------------------------------------------------------
# A Druk comporta-se como uma pena eliptica (larga e baixa) arrastada ao longo
# de uma linha central: hastes verticais grossas, barras finas, diagonais no
# meio, e curvas que fluem em vez de cantos. Implementa-se esticando a linha
# central em y (a/b), fazendo stroke com pena REDONDA de raio a no skia, e
# voltando a comprimir: uma circunferencia comprimida e a elipse a x b.
KV, KH = 0.45, 0.82     # pegas das curvas da linha central: vertical / horizontal


class Raw:
    """Contorno ja resolvido pelo skia (um Path), com a mesma interface."""

    def __init__(self, path, filled=True):
        self.path = path
        self.filled = filled

    def shift(self, dx):
        return Raw(self.path.transform(translateX=dx), self.filled)

    def draw(self, pen):
        self.path.draw(pen)


def sweep(cmds, a, b, closed=False):
    """cmds: [('m',p), ('l',p), ('c',c1,c2,p), ...]. Devolve o traco pintado."""
    p = Path()
    pen = p.getPen()
    for c in cmds:
        if c[0] == "m":
            pen.moveTo(c[1])
        elif c[0] == "l":
            pen.lineTo(c[1])
        else:
            pen.curveTo(c[1], c[2], c[3])
    if closed:
        pen.closePath()
    else:
        pen.endPath()
    q = p.transform(scaleY=a / b)
    q.stroke(2 * a, LineCap.BUTT_CAP, LineJoin.ROUND_JOIN, 4)
    q.convertConicsToQuads()
    r = q.transform(scaleY=b / a)
    r.simplify()
    return Raw(r)


def v2h(p0, p3, kv=None, kh=None):
    """Segmento que SAI na vertical de p0 e CHEGA na horizontal a p3."""
    kv = KV if kv is None else kv
    kh = KH if kh is None else kh
    return ("c", (p0[0], p0[1] + kv * (p3[1] - p0[1])),
            (p3[0] - kh * (p3[0] - p0[0]), p3[1]), p3)


def h2v(p0, p3, kv=None, kh=None):
    """Segmento que SAI na horizontal de p0 e CHEGA na vertical a p3."""
    kv = KV if kv is None else kv
    kh = KH if kh is None else kh
    return ("c", (p0[0] + kh * (p3[0] - p0[0]), p0[1]),
            (p3[0], p3[1] - kv * (p3[1] - p0[1])), p3)


def trunc(cmds, t):
    """Corta a ULTIMA cubica em t (de Casteljau): o traco acaba a meio do arco,
    e com topo recto a face fica perpendicular a tangente - um terminal
    inclinado, como os da Druk, sem cortes que possam ferir o resto da letra."""
    p0 = cmds[-2][-1]
    _, c1, c2, p3 = cmds[-1]
    L = lambda p, q: (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)
    a, b, c = L(p0, c1), L(c1, c2), L(c2, p3)
    d, e = L(a, b), L(b, c)
    return cmds[:-1] + [("c", a, d, L(d, e))]


def loop(x0, y0, x1, y1, a, b):
    """Anel fechado varrido: caixa EXTERIOR (x0,y0)-(x1,y1)."""
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    L, R, T, Bm = x0 + a, x1 - a, y1 - b, y0 + b
    return sweep([("m", (R, cy)), v2h((R, cy), (cx, T)), h2v((cx, T), (L, cy)),
                  v2h((L, cy), (cx, Bm)), h2v((cx, Bm), (R, cy))], a, b, closed=True)


def wedge(x_in, y_in0, y_in1, x_out, y_out0, y_out1):
    """Corte de abertura: quadrilatero entre a face interior e a exterior."""
    return hole(poly([(x_in, y_in0), (x_out, y_out0), (x_out, y_out1), (x_in, y_in1)]))


def xline(p0, p1, y):
    (x0, y0), (x1, y1) = p0, p1
    return x0 + (x1 - x0) * (y - y0) / (y1 - y0)


# --- REGISTO ---------------------------------------------------------------
# G[nome] = (avanco, espaco lateral, funcao(corpo) -> contornos)
G = {}


def glyph(name, adv, sb=28):
    def deco(fn):
        G[name] = (adv, sb, fn)
        return fn
    return deco


# ---- maiusculas -----------------------------------------------------------
@glyph("A", 1222, 20)
def _A(B):
    s = 62
    il = ((VC, 0), (s + VC, CAP))
    ir = ((B - VC, 0), (B - s - VC, CAP))
    cb0, cb1 = 150, 150 + HS
    ctop = CAP - HS
    return [
        poly([(0, 0), (s, CAP), (B - s, CAP), (B, 0), (B - VC, 0),
              (xline(*ir, cb0), cb0), (xline(*il, cb0), cb0), (VC, 0)]),
        hole(poly([(xline(*il, cb1), cb1), (xline(*ir, cb1), cb1),
                   (xline(*ir, ctop), ctop), (xline(*il, ctop), ctop)])),
    ]


@glyph("B", 1174)
def _B(B):
    bh = MID + HS / 2
    o1, o2 = OC(B - 24, CAP - bh + HS), OC(B, bh)
    return [
        rect(0, 0, VC, CAP),
        rrect(0, MID - HS / 2, B - 24, CAP, None, o1, o1, None),
        rrect(0, 0, B, bh, None, o2, o2, None),
        hole(rrect(VC, MID + HS / 2, B - 24 - VC, CAP - HS,
                   *[CC(B - 24 - 2 * VC, CAP - HS - MID - HS / 2)] * 4)),
        hole(rrect(VC, HS, B - VC, MID - HS / 2,
                   *[CC(B - 2 * VC, MID - HS / 2 - HS)] * 4)),
    ]


@glyph("C", 1192, 12)
def _C(B):
    return ring(0, -OVER, B, CAP + OVER, VCR, HC) + [
        hole(rect(B - VCR - 1, 230, B + OUT, CAP - 230))]


@glyph("D", 1193, 12)
def _D(B):
    o = OC(B, CAP)
    i = C((B - VC - VCR) * 0.5, (CAP - 2 * HC) * 0.48, 0.93, 0.33)
    return [rrect(0, 0, B, CAP, None, o, o, None),
            hole(rrect(VC, HC, B - VCR, CAP - HC, None, i, i, None))]


@glyph("E", 949)
def _E(B):
    return [rect(0, 0, VC, CAP), rect(0, CAP - HS, B, CAP),
            rect(0, MID - HS / 2, B * 0.93, MID + HS / 2), rect(0, 0, B, HS)]


@glyph("F", 928)
def _F(B):
    return [rect(0, 0, VC, CAP), rect(0, CAP - HS, B, CAP),
            rect(0, MID - HS / 2, B * 0.93, MID + HS / 2)]


@glyph("G", 1225, 12)
def _G(B):
    bar = 400
    return ring(0, -OVER, B, CAP + OVER, VCR, HC) + [
        hole(rect(B - VCR - 1, bar, B + OUT, CAP + OVER - HC)),
        rect(B * 0.46, bar - 160, B, bar),
    ]


@glyph("H", 1214)
def _H(B):
    return [rect(0, 0, VC, CAP), rect(B - VC, 0, B, CAP),
            rect(VC, MID - HC / 2, B - VC, MID + HC / 2)]


@glyph("I", 435)
def _I(B):
    return [rect(0, 0, B, CAP)]


@glyph("J", 1041)
def _J(B):
    hk = 430
    o = OC(B, hk + OVER)
    i = CC(B - VC - VC, hk - HC)
    return [rrect(0, -OVER, B, hk, None, None, o, o),
            hole(rrect(VC, -OVER + HC, B + OUT, hk + OUT, None, None, None, i)),
            rect(B - VC, 0, B, CAP)]


@glyph("K", 1190)
def _K(B):
    w = VC * 1.30
    return [rect(0, 0, VC, CAP),
            hbar((VC * 0.35, MID + 25), (B - w * 0.5, CAP), w),
            hbar((VC * 0.35, MID - 25), (B - w * 0.5, 0), w),
            hole(rect(-900, -OUT, 0, CAP + OUT))]


@glyph("L", 942)
def _L(B):
    return [rect(0, 0, VC, CAP), rect(0, 0, B, HC)]


@glyph("M", 1391)
def _M(B):
    return [rect(0, 0, VC, CAP), rect(B - VC, 0, B, CAP),
            hbar((VC / 2, CAP), (B / 2, 150), VC * 1.06),
            hbar((B - VC / 2, CAP), (B / 2, 150), VC * 1.06)]


@glyph("N", 1215)
def _N(B):
    return [rect(0, 0, VC, CAP), rect(B - VC, 0, B, CAP),
            hbar((VC / 2, CAP), (B - VC / 2, 0), VC * 1.24)]


@glyph("O", 1232, 12)
def _O(B):
    return ring(0, -OVER, B, CAP + OVER, VCR, HC)


@glyph("P", 1137)
def _P(B):
    y = 275
    o = OC(B, CAP - y)
    return [rect(0, 0, VC, CAP), rrect(0, y, B, CAP, None, o, o, None),
            hole(rrect(VC, y + HS, B - VC, CAP - HS,
                       *[CC(B - 2 * VC, CAP - y - 2 * HS)] * 4))]


@glyph("Q", 1232, 12)
def _Q(B):
    return ring(0, -OVER, B, CAP + OVER, VCR, HC) + [
        hbar((B * 0.60, 250), (B * 0.88, -100), VCR * 0.92)]


@glyph("R", 1164)
def _R(B):
    y = 285
    bw = B * 0.95
    o = OC(bw, CAP - y)
    return [rect(0, 0, VC, CAP), rrect(0, y, bw, CAP, None, o, o, None),
            hole(rrect(VC, y + HS, bw - VC, CAP - HS,
                       *[CC(bw - 2 * VC, CAP - y - 2 * HS)] * 4)),
            hbar((VC * 0.85, y + HS), (B - VC * 0.55, 0), VC * 1.22)]


@glyph("S", 1136, 2)
def _S(B):
    top, bot = CAP + OVER, -OVER
    o = OC(B, top - bot)
    ch = top - HS - (MID + HS / 2)
    cu = CC(B - 2 * VC, ch)
    cl = CC(B - 2 * VC, MID - HS / 2 - bot - HS)
    return [
        rrect(0, bot, B, top, o, o, o, o),
        hole(rrect(VC, MID + HS / 2, B - VC, top - HS, cu, cu, cu, cu)),
        hole(rect(B - VC - 1, MID + HS / 2, B + OUT, MID + HS / 2 + ch * 0.62)),
        hole(rrect(VC, bot + HS, B - VC, MID - HS / 2, cl, cl, cl, cl)),
        hole(rect(-OUT, MID - HS / 2 - ch * 0.62, VC + 1, MID - HS / 2)),
    ]


@glyph("T", 1056, 12)
def _T(B):
    return [rect(0, CAP - HC, B, CAP), rect((B - VC) / 2, 0, (B + VC) / 2, CAP)]


@glyph("U", 1196, 12)
def _U(B):
    o = OC(B, CAP + OVER)
    i = CC(B - 2 * VCR, CAP - HC + OVER)
    return [rrect(0, -OVER, B, CAP, None, None, o, o),
            hole(rrect(VCR, -OVER + HC, B - VCR, CAP + OUT, None, None, i, i))]


@glyph("V", 1190, 8)
def _V(B):
    cx, ah, w = B / 2, VC * 0.52, VC * 1.14
    return [poly([(0, CAP), (w, CAP), (cx + ah, 170), (B - w, CAP), (B, CAP),
                  (cx + ah, -OVER), (cx - ah, -OVER)])]


@glyph("W", 1744, -16)
def _W(B):
    half = B * 0.565
    out = []
    for off in (0, B - half):
        cx, ah, w = off + half / 2, VC * 0.48, VC * 1.02
        out.append(poly([(off, CAP), (off + w, CAP), (cx + ah, 60),
                         (off + half - w, CAP), (off + half, CAP),
                         (cx + ah, -OVER), (cx - ah, -OVER)]))
    return out


@glyph("X", 1209, 12)
def _X(B):
    w = VC * 1.22
    return [hbar((w / 2, 0), (B - w / 2, CAP), w),
            hbar((B - w / 2, 0), (w / 2, CAP), w)]


@glyph("Y", 1186, 8)
def _Y(B):
    w = VC * 1.16
    return [hbar((w / 2, CAP), (B / 2, 320), w),
            hbar((B - w / 2, CAP), (B / 2, 320), w),
            rect((B - VC) / 2, 0, (B + VC) / 2, 400)]


@glyph("Z", 1027, 24)
def _Z(B):
    return [rect(0, CAP - HS, B, CAP), rect(0, 0, B, HS),
            poly([(B - VC * 0.10, CAP - HS), (B - VC * 1.30, CAP - HS),
                  (VC * 0.10, HS), (VC * 1.30, HS)])]


# ---- minusculas -----------------------------------------------------------
@glyph("a", 927, 10)
def _a(B):
    bw = 323                        # topo do bojo
    ot = OL(B, HSL + OVER)
    ob = C(B * 0.40, (bw + OVER) * 0.46, 0.92, 0.36)
    ib = CL(B - 2 * VLR, bw - HSL - HSL + OVER)
    return [
        rrect(0, XH - HSL, B, XH + OVER, ot, ot, None, None),
        rrect(0, -OVER, B, bw, ob, None, None, ob),
        hole(rrect(VLR, -OVER + HSL, B - VLR, bw - HSL, ib, ib, ib, ib)),
        rect(B - VLR, 0, B, XH),
    ]


@glyph("b", 972, 24)
def _b(B):
    o = OL(B, XH + 2 * OVER)
    i = CL(B - VL - VLR, XH + 2 * OVER - 2 * HL)
    return [rect(0, 0, VL, ASC), rrect(0, -OVER, B, XH + OVER, None, o, o, None),
            hole(rrect(VL, -OVER + HL, B - VLR, XH + OVER - HL, i, i, i, i))]


@glyph("c", 953, 10)
def _c(B):
    return ring(0, -OVER, B, XH + OVER, VLR, HL, OL, CL) + [
        hole(rect(B - VLR - 1, 168, B + OUT, XH - 168))]


@glyph("d", 971, 24)
def _d(B):
    o = OL(B, XH + 2 * OVER)
    i = CL(B - VL - VLR, XH + 2 * OVER - 2 * HL)
    return [rect(B - VL, 0, B, ASC), rrect(0, -OVER, B, XH + OVER, o, None, None, o),
            hole(rrect(VLR, -OVER + HL, B - VL, XH + OVER - HL, i, i, i, i))]


@glyph("e", 954, 10)
def _e(B):
    top, bot = XH + OVER, -OVER
    o = OL(B, top - bot)
    cu = CL(B - 2 * VLR, top - HSL - (MIDX + HSL / 2))
    cl = CL(B - 2 * VLR, MIDX - HSL / 2 - bot - HSL)
    return [
        rrect(0, bot, B, top, o, o, o, o),
        hole(rrect(VLR, MIDX + HSL / 2, B - VLR, top - HSL, cu, cu, cu, cu)),
        hole(rrect(VLR, bot + HSL, B - VLR, MIDX - HSL / 2, cl, cl, cl, cl)),
        hole(rect(B - VLR - 1, bot + HSL, B + OUT, MIDX - HSL / 2)),
    ]


@glyph("f", 604, 24)
def _f(B):
    sx, th = 95, 270
    o = C((B - sx) * 0.5, th * 0.48, 0.86, 0.43)
    return [rect(sx, 0, sx + VL, ASC),
            rrect(sx, ASC - th, B, ASC, o, None, None, None),
            hole(rect(sx + VL, ASC - th - OUT, B + OUT, ASC - HL)),
            rect(0, XH - HL, B, XH)]


@glyph("g", 985, 10)
def _g(B):
    hk = C(B * 0.36, HL * 0.48, 0.9, 0.4)
    return ring(0, -OVER, B, XH + OVER, VLR, HL, OL, CL) + [
        rrect(0, DESC, B, DESC + HL, None, None, None, hk),
        rect(0, DESC, VLR * 0.95, -OVER - 45),
        rect(B - VLR, DESC, B, 0),
    ]


def _arch(B, v, top):
    """Ombro + arco do n/h/m: canto superior esquerdo QUADRADO (e a haste)."""
    return [rrect(0, 0, B, top, None, SH(B - v, top), None, None),
            hole(rrect(v, -OUT, B - v, top - HL, AR(B - 2 * v, top - HL), AR(B - 2 * v, top - HL),
                       None, None))]


@glyph("h", 982, 24)
def _h(B):
    return [rect(0, 0, VL, ASC)] + _arch(B, VL, XH)


@glyph("i", 412, 24)
def _i(B):
    return [rect(0, 0, B, XH), rect(0, ASC - 150, B, ASC)]


@glyph("j", 412, 24)
def _j(B):
    hk = C(B * 0.9, HL * 0.48, 0.9, 0.4)
    return [rect(0, DESC + HL, B, XH), rect(0, ASC - 150, B, ASC),
            rrect(-B * 0.62, DESC, B, DESC + HL, None, None, None, hk)]


@glyph("k", 909, 24)
def _k(B):
    w = VL * 1.26
    return [rect(0, 0, VL, ASC),
            hbar((VL * 0.35, MIDX + 20), (B - w * 0.5, XH), w),
            hbar((VL * 0.35, MIDX - 20), (B - w * 0.5, 0), w),
            hole(rect(-900, -OUT, 0, ASC + OUT))]


@glyph("l", 412, 24)
def _l(B):
    return [rect(0, 0, B, ASC)]


@glyph("m", 1499, 24)
def _m(B):
    w = (B + VL) / 2
    left = _arch(w, VL, XH)
    right = [c.shift(w - VL) for c in _arch(B - (w - VL), VL, XH)]
    return left + right


@glyph("n", 982, 24)
def _n(B):
    return _arch(B, VL, XH)


@glyph("o", 999, 10)
def _o(B):
    return ring(0, -OVER, B, XH + OVER, VLR, HL, OL, CL)


@glyph("p", 976, 24)
def _p(B):
    o = OL(B, XH + 2 * OVER)
    i = CL(B - VL - VLR, XH + 2 * OVER - 2 * HL)
    return [rect(0, DESC, VL, XH), rrect(0, -OVER, B, XH + OVER, None, o, o, None),
            hole(rrect(VL, -OVER + HL, B - VLR, XH + OVER - HL, i, i, i, i))]


@glyph("q", 970, 24)
def _q(B):
    o = OL(B, XH + 2 * OVER)
    i = CL(B - VL - VLR, XH + 2 * OVER - 2 * HL)
    return [rect(B - VL, DESC, B, XH), rrect(0, -OVER, B, XH + OVER, o, None, None, o),
            hole(rrect(VLR, -OVER + HL, B - VL, XH + OVER - HL, i, i, i, i))]


@glyph("r", 890, 24)
def _r(B):
    top = XH - HL * 2.0
    stub = VL * 0.85
    return [rect(0, 0, VL, XH),
            rrect(0, top, B, XH, None, SH(B - VL, XH - top), None, None),
            hole(rrect(VL, top - OUT, B - stub, XH - HL,
                       AR(B - stub - VL, XH - HL - top), AR(B - stub - VL, XH - HL - top),
                       None, None))]


@glyph("s", 875, 2)
def _s(B):
    top, bot = XH + OVER, -OVER
    o = OL(B, top - bot)
    ch = top - HSL - (MIDX + HSL / 2)
    cu = CL(B - 2 * VL, ch)
    cl = CL(B - 2 * VL, MIDX - HSL / 2 - bot - HSL)
    return [
        rrect(0, bot, B, top, o, o, o, o),
        hole(rrect(VL, MIDX + HSL / 2, B - VL, top - HSL, cu, cu, cu, cu)),
        hole(rect(B - VL - 1, MIDX + HSL / 2, B + OUT, MIDX + HSL / 2 + ch * 0.62)),
        hole(rrect(VL, bot + HSL, B - VL, MIDX - HSL / 2, cl, cl, cl, cl)),
        hole(rect(-OUT, MIDX - HSL / 2 - ch * 0.62, VL + 1, MIDX - HSL / 2)),
    ]


@glyph("t", 584, 24)
def _t(B):
    sx, fh = 80, 230
    o = C((B - sx) * 0.5, (fh + OVER) * 0.48, 0.86, 0.43)
    return [rect(sx, 0, sx + VL, 655), rect(0, XH - HL, B, XH),
            rrect(sx, -OVER, B, fh, None, None, None, o),
            hole(rect(sx + VL, -OVER + HL, B + OUT, fh + OUT))]


@glyph("u", 975, 24)
def _u(B):
    o = OL(B, XH + OVER)
    i = CL(B - VLR - VL, XH + OVER - HL)
    return [rrect(0, -OVER, B, XH, None, None, o, o),
            hole(rrect(VLR, -OVER + HL, B - VL, XH + OUT, None, None, i, i)),
            rect(B - VL, 0, B, XH)]


@glyph("v", 933, 8)
def _v(B):
    cx, ah, w = B / 2, VL * 0.52, VL * 1.14
    return [poly([(0, XH), (w, XH), (cx + ah, 120), (B - w, XH), (B, XH),
                  (cx + ah, -OVER), (cx - ah, -OVER)])]


@glyph("w", 1360, -13)
def _w(B):
    half = B * 0.565
    out = []
    for off in (0, B - half):
        cx, ah, w = off + half / 2, VL * 0.48, VL * 1.02
        out.append(poly([(off, XH), (off + w, XH), (cx + ah, 45),
                         (off + half - w, XH), (off + half, XH),
                         (cx + ah, -OVER), (cx - ah, -OVER)]))
    return out


@glyph("x", 951, 12)
def _x(B):
    w = VL * 1.20
    return [hbar((w / 2, 0), (B - w / 2, XH), w),
            hbar((B - w / 2, 0), (w / 2, XH), w)]


@glyph("y", 905, 8)
def _y(B):
    w = VL * 1.14
    return [hbar((w / 2, XH), (B * 0.62, 0), w),
            hbar((B - w / 2, XH), (VL * 0.30, DESC), w)]


@glyph("z", 800, 24)
def _z(B):
    return [rect(0, XH - HSL, B, XH), rect(0, 0, B, HSL),
            poly([(B - VL * 0.10, XH - HSL), (B - VL * 1.28, XH - HSL),
                  (VL * 0.10, HSL), (VL * 1.28, HSL)])]


# ---- algarismos -----------------------------------------------------------
@glyph("zero", 1194, 12)
def _n0(B):
    return ring(0, -OVER, B, CAP + OVER, VCR, HC)


@glyph("one", 614)
def _n1(B):
    return [rect(B - VC, 0, B, CAP),
            hbar((B - VC - 175, CAP - 230), (B - VC * 0.45, CAP), VC * 0.92)]


@glyph("two", 1081, 12)
def _n2(B):
    top = 395
    o = OC(B, CAP + OVER - top)
    i = CC(B - 2 * VCR, CAP + OVER - top - HC)
    return [
        rrect(0, top, B, CAP + OVER, o, o, None, None),
        hole(rrect(VCR, top - OUT, B - VCR, CAP + OVER - HC, i, i, None, None)),
        hole(rect(-OUT, top - 1, VCR + 1, top + (CAP - top) * 0.42)),
        rect(0, 0, B, HS),
        poly([(B - VCR * 0.05, top), (B - VCR * 1.20, top),
              (VCR * 0.10, HS), (VCR * 1.25, HS)]),
    ]


@glyph("three", 1130, 12)
def _n3(B):
    top, bot = CAP + OVER, -OVER
    o = OC(B, top - bot)
    cu = CC(B - 2 * VCR, top - HS - (MID + HS / 2))
    cl = CC(B - 2 * VCR, MID - HS / 2 - bot - HS)
    return [
        rrect(0, bot, B, top, o, o, o, o),
        hole(rrect(VCR, MID + HS / 2, B - VCR, top - HS, cu, cu, cu, cu)),
        hole(rect(-OUT, MID + HS / 2, VCR + 1, top - HS)),
        hole(rrect(VCR, bot + HS, B - VCR, MID - HS / 2, cl, cl, cl, cl)),
        hole(rect(-OUT, bot + HS, VCR + 1, MID - HS / 2)),
    ]


@glyph("four", 1122)
def _n4(B):
    sx = B * 0.50
    return [hbar((sx + VC * 0.42, CAP), (VC * 0.12, HS * 1.25), VC * 1.06),
            rect(sx, 0, sx + VC, CAP),
            rect(0, HS * 1.25, B, HS * 1.25 + HS)]


@glyph("five", 1063, 12)
def _n5(B):
    bh = MID + HS / 2
    o = OC(B, bh + OVER)
    i = CC(B - 2 * VCR, bh - HS - HS + OVER)
    return [
        rect(0, CAP - HS, B, CAP), rect(0, MID - HS / 2, VCR, CAP),
        rrect(0, -OVER, B, bh, None, o, o, o),
        hole(rrect(VCR, -OVER + HS, B - VCR, MID - HS / 2, i, i, i, i)),
        hole(rect(-OUT, -OVER + HS, VCR + 1, MID - HS / 2)),
    ]


@glyph("six", 1130, 12)
def _n6(B):
    top, bot = CAP + OVER, -OVER
    o = OC(B, top - bot)
    i = CC(B - 2 * VCR, MID - HS / 2 - bot - HS)
    return [
        rrect(0, bot, B, top, o, o, o, o),
        hole(rrect(VCR, bot + HS, B - VCR, MID - HS / 2, i, i, i, i)),
        hole(rect(VCR, MID + HS / 2, B + OUT, top - HS)),
        hole(rect(B * 0.78, top - HS - 1, B + OUT, top + OUT)),
    ]


@glyph("seven", 1043, 24)
def _n7(B):
    return [rect(0, CAP - HS, B, CAP),
            poly([(B - VC * 0.10, CAP - HS), (B - VC * 1.30, CAP - HS),
                  (VC * 0.55, 0), (VC * 1.75, 0)])]


@glyph("eight", 1111, 12)
def _n8(B):
    top, bot = CAP + OVER, -OVER
    o = OC(B, top - bot)
    cu = CC(B - 2 * VCR, top - HS - (MID + HS / 2))
    cl = CC(B - 2 * VCR, MID - HS / 2 - bot - HS)
    return [
        rrect(0, bot, B, top, o, o, o, o),
        hole(rrect(VCR + 12, MID + HS / 2, B - VCR - 12, top - HS, cu, cu, cu, cu)),
        hole(rrect(VCR, bot + HS, B - VCR, MID - HS / 2, cl, cl, cl, cl)),
    ]


@glyph("nine", 1131, 12)
def _n9(B):
    top, bot = CAP + OVER, -OVER
    o = OC(B, top - bot)
    i = CC(B - 2 * VCR, top - HS - (MID + HS / 2))
    return [
        rrect(0, bot, B, top, o, o, o, o),
        hole(rrect(VCR, MID + HS / 2, B - VCR, top - HS, i, i, i, i)),
        hole(rect(-OUT, bot + HS, B - VCR, MID - HS / 2)),
        hole(rect(-OUT, bot - OUT, B * 0.22, bot + HS + 1)),
    ]


# ---- pontuacao e sinais ---------------------------------------------------
DOT = 345
DR = C(60, 60, 0.6, 0.6)


@glyph("space", 296)
def _space(B):
    return []


@glyph("period", DOT + 56, 28)
def _period(B):
    return [rrect(0, 0, B, DOT, DR, DR, DR, DR)]


@glyph("comma", DOT + 56, 28)
def _comma(B):
    return [rrect(0, 0, B, DOT, DR, DR, DR, DR),
            poly([(0, 0), (B, 0), (B * 0.28, -195)])]


@glyph("colon", DOT + 56, 28)
def _colon(B):
    return [rrect(0, 0, B, DOT, DR, DR, DR, DR),
            rrect(0, XH - DOT, B, XH, DR, DR, DR, DR)]


@glyph("semicolon", DOT + 56, 28)
def _semicolon(B):
    return [rrect(0, 0, B, DOT, DR, DR, DR, DR),
            poly([(0, 0), (B, 0), (B * 0.28, -195)]),
            rrect(0, XH - DOT, B, XH, DR, DR, DR, DR)]


@glyph("exclam", 491, 28)
def _exclam(B):
    return [rect((B - VC) / 2, DOT * 1.35, (B + VC) / 2, CAP),
            rrect((B - DOT) / 2, 0, (B + DOT) / 2, DOT, DR, DR, DR, DR)]


@glyph("question", 900, 20)
def _question(B):
    y = 335
    o = OC(B, CAP + OVER - y)
    i = CC(B - 2 * VC, CAP + OVER - y - HS)
    return [
        rrect(0, y, B, CAP + OVER, o, o, None, None),
        hole(rrect(VC, y - OUT, B - VC, CAP + OVER - HS, i, i, None, None)),
        hole(rect(-OUT, y - 1, VC + 1, y + (CAP - y) * 0.45)),
        rect((B - VC) / 2, DOT * 1.35, (B + VC) / 2, y + HS),
        rrect((B - VC) / 2, 0, (B + VC) / 2, DOT, DR, DR, DR, DR),
    ]


@glyph("quotesingle", VC + 56, 28)
def _quotesingle(B):
    return [rect(0, CAP - 290, B, CAP)]


@glyph("quotedbl", VC * 2 + 170, 28)
def _quotedbl(B):
    return [rect(0, CAP - 290, VC, CAP), rect(B - VC, CAP - 290, B, CAP)]


@glyph("quoteright", VC + 56, 28)
def _quoteright(B):
    return [rect(0, CAP - 290, B, CAP),
            poly([(0, CAP - 290), (B, CAP - 290), (B * 0.28, CAP - 485)])]


@glyph("quoteleft", VC + 56, 28)
def _quoteleft(B):
    return [rect(0, CAP - 290, B, CAP),
            poly([(0, CAP), (B * 0.72, CAP + 195), (B, CAP)])]


@glyph("quotedblright", VC * 2 + 170, 28)
def _quotedblright(B):
    o = []
    for x in (0, B - VC):
        o += [rect(x, CAP - 290, x + VC, CAP),
              poly([(x, CAP - 290), (x + VC, CAP - 290), (x + VC * 0.28, CAP - 485)])]
    return o


@glyph("quotedblleft", VC * 2 + 170, 28)
def _quotedblleft(B):
    o = []
    for x in (0, B - VC):
        o += [rect(x, CAP - 290, x + VC, CAP),
              poly([(x, CAP), (x + VC * 0.72, CAP + 195), (x + VC, CAP)])]
    return o


@glyph("hyphen", 389, 24)
def _hyphen(B):
    return [rect(0, 300, B, 300 + HS)]


@glyph("endash", 760, 24)
def _endash(B):
    return [rect(0, 300, B, 300 + HS)]


@glyph("emdash", 1060, 24)
def _emdash(B):
    return [rect(0, 300, B, 300 + HS)]


@glyph("underscore", 800, 12)
def _underscore(B):
    return [rect(0, -170, B, -170 + HS)]


@glyph("slash", 760, 12)
def _slash(B):
    return [hbar((VC * 0.58, -120), (B - VC * 0.58, CAP + 120), VC * 1.06)]


@glyph("backslash", 760, 12)
def _backslash(B):
    return [hbar((B - VC * 0.58, -120), (VC * 0.58, CAP + 120), VC * 1.06)]


@glyph("bar", VC + 56, 28)
def _bar(B):
    return [rect(0, -150, B, CAP + 150)]


@glyph("parenleft", 560, 24)
def _parenleft(B):
    o = C(B * 0.9, 300, 0.75, 0.5)
    i = C((B - VC * 0.9) * 0.9, 200, 0.75, 0.5)
    return [rrect(0, -150, B, CAP + 150, o, o, o, o),
            hole(rrect(VC * 0.90, -150 + 245, B + OUT, CAP + 150 - 245, i, None, None, i))]


@glyph("parenright", 560, 24)
def _parenright(B):
    o = C(B * 0.9, 300, 0.75, 0.5)
    i = C((B - VC * 0.9) * 0.9, 200, 0.75, 0.5)
    return [rrect(0, -150, B, CAP + 150, o, o, o, o),
            hole(rrect(-OUT, -150 + 245, B - VC * 0.90, CAP + 150 - 245, None, i, i, None))]


@glyph("bracketleft", 540, 24)
def _bracketleft(B):
    return [rect(0, -150, VC, CAP + 150), rect(0, CAP + 150 - HS, B, CAP + 150),
            rect(0, -150, B, -150 + HS)]


@glyph("bracketright", 540, 24)
def _bracketright(B):
    return [rect(B - VC, -150, B, CAP + 150), rect(0, CAP + 150 - HS, B, CAP + 150),
            rect(0, -150, B, -150 + HS)]


@glyph("braceleft", 600, 24)
def _braceleft(B):
    return [rect(B * 0.40, -150, B * 0.40 + VC * 0.85, CAP + 150),
            rect(0, MID - HS * 0.45, B * 0.40, MID + HS * 0.45)]


@glyph("braceright", 600, 24)
def _braceright(B):
    return [rect(B * 0.40, -150, B * 0.40 + VC * 0.85, CAP + 150),
            rect(B * 0.40, MID - HS * 0.45, B, MID + HS * 0.45)]


@glyph("plus", 900, 24)
def _plus(B):
    m = 360
    return [rect(0, m - HS / 2, B, m + HS / 2),
            rect((B - VC) / 2, m - 300, (B + VC) / 2, m + 300)]


@glyph("equal", 900, 24)
def _equal(B):
    return [rect(0, 195, B, 195 + HS), rect(0, 455, B, 455 + HS)]


@glyph("less", 880, 24)
def _less(B):
    return [vbar((B, CAP * 0.90), (VC * 0.5, 360), HS * 1.12),
            vbar((B, -20), (VC * 0.5, 360), HS * 1.12)]


@glyph("greater", 880, 24)
def _greater(B):
    return [vbar((0, CAP * 0.90), (B - VC * 0.5, 360), HS * 1.12),
            vbar((0, -20), (B - VC * 0.5, 360), HS * 1.12)]


@glyph("asciicircum", 900, 24)
def _asciicircum(B):
    return [hbar((VC * 0.5, CAP * 0.55), (B / 2, CAP), VC * 0.95),
            hbar((B - VC * 0.5, CAP * 0.55), (B / 2, CAP), VC * 0.95)]


@glyph("asciitilde", 900, 24)
def _asciitilde(B):
    return _tilde_shape(0, B, 320, 165)


@glyph("asterisk", 820, 24)
def _asterisk(B):
    cx, cy, L = B / 2, CAP * 0.74, 235
    return [rect(cx - VC / 2, cy - L, cx + VC / 2, cy + L),
            hbar((cx - L * 0.88, cy - L * 0.5), (cx + L * 0.88, cy + L * 0.5), VC * 1.15),
            hbar((cx - L * 0.88, cy + L * 0.5), (cx + L * 0.88, cy - L * 0.5), VC * 1.15)]


@glyph("numbersign", 1120, 24)
def _numbersign(B):
    v, h = VC * 0.78, HS * 0.82
    return [rect(B * 0.16, 0, B * 0.16 + v, CAP), rect(B * 0.60, 0, B * 0.60 + v, CAP),
            rect(0, CAP * 0.27, B, CAP * 0.27 + h), rect(0, CAP * 0.62, B, CAP * 0.62 + h)]


@glyph("percent", 1340, 12)
def _percent(B):
    d, v, h = 420, 155, 125
    return (ring(0, CAP - d, d, CAP, v, h)
            + ring(B - d, 0, B, d, v, h)
            + [hbar((VC * 0.5, -50), (B - VC * 0.5, CAP + 50), VC * 0.95)])


@glyph("ampersand", 1220, 20)
def _ampersand(B):
    up, lo, uw, lw = CAP * 0.55, CAP * 0.60, B * 0.62, B * 0.74
    ou, ol = OC(uw, CAP + OVER - up), OC(lw, lo + OVER)
    iu = CC(uw - 2 * VC * 0.85, CAP + OVER - up - 2 * 115)
    il = CC(lw - 2 * VC, lo + OVER - 2 * HS)
    return [
        rrect(0, up, uw, CAP + OVER, ou, ou, ou, ou),
        hole(rrect(VC * 0.85, up + 115, uw - VC * 0.85, CAP + OVER - 115, iu, iu, iu, iu)),
        rrect(0, -OVER, lw, lo, ol, ol, ol, ol),
        hole(rrect(VC, -OVER + HS, lw - VC, lo - HS, il, il, il, il)),
        hbar((B * 0.42, CAP * 0.40), (B - VC * 0.60, 0), VC * 1.02),
    ]


@glyph("at", 1400, 12)
def _at(B):
    inner_v, inner_h = 108, 96
    return (ring(0, -100, B, CAP, VC * 0.80, HC * 0.80)
            + [rect(B * 0.62, -100, B, CAP * 0.32)]
            + ring(B * 0.27, CAP * 0.23, B * 0.73, CAP * 0.70, inner_v, inner_h))


@glyph("dollar", 1136, 2)
def _dollar(B):
    return _S(B) + [rect((B - VC * 0.5) / 2, -140, (B + VC * 0.5) / 2, CAP + 140)]


@glyph("sterling", 1100, 20)
def _sterling(B):
    sx, y = B * 0.24, CAP * 0.44
    o = OC(B - sx, CAP + OVER - y)
    i = CC(B - sx - 2 * VC, CAP + OVER - y - HS)
    return [
        rrect(sx, y, B, CAP + OVER, o, o, None, None),
        hole(rrect(sx + VC, y - OUT, B - VC, CAP + OVER - HS, i, i, None, None)),
        rect(sx, 0, sx + VC, CAP * 0.55),
        rect(0, 0, B, HS),
        rect(0, CAP * 0.33, B * 0.78, CAP * 0.33 + HS * 0.82),
    ]


@glyph("euro", 1180, 12)
def _euro(B):
    return (ring(B * 0.10, -OVER, B, CAP + OVER, VCR, HC)
            + [hole(rect(B - VCR - 1, 230, B + OUT, CAP - 230)),
               rect(0, CAP * 0.28, B * 0.70, CAP * 0.28 + HS * 0.80),
               rect(0, CAP * 0.54, B * 0.70, CAP * 0.54 + HS * 0.80)])


@glyph("degree", 540, 24)
def _degree(B):
    return ring(0, CAP - B, B, CAP, 150, 150)


@glyph("multiply", 880, 24)
def _multiply(B):
    w, y0, y1 = VC * 1.05, 120, 600
    return [hbar((w / 2, y0), (B - w / 2, y1), w), hbar((B - w / 2, y0), (w / 2, y1), w)]


@glyph("periodcentered", DOT + 56, 28)
def _periodcentered(B):
    return [rrect(0, 310, B, 310 + DOT, DR, DR, DR, DR)]


@glyph("bullet", 520, 24)
def _bullet(B):
    r = C(B * 0.45, B * 0.45, 0.6, 0.6)
    return [rrect(0, 260, B, 260 + B, r, r, r, r)]


@glyph("ellipsis", DOT * 3 + 340, 28)
def _ellipsis(B):
    return [rrect(i * (DOT + 170), 0, i * (DOT + 170) + DOT, DOT, DR, DR, DR, DR)
            for i in range(3)]



# ---- v4: glifos curvos, varridos com a pena eliptica -----------------------
AC, BC2 = VCR / 2, HC / 2        # pena das maiusculas redondas (2 barras)
AL, BL2 = VLR / 2, HL / 2        # pena das minusculas


def _cee(B, a, b, top, bot, t_up, t_lo):
    """C: anel aberto a direita; os terminais sao quadrantes truncados."""
    L, R, cx, cy = a, B - a, B / 2, (top + bot) / 2
    T, Bm = top - b, bot + b
    up = trunc([("m", (L, cy)), v2h((L, cy), (cx, T)), h2v((cx, T), (R, cy))], t_up)
    lo = trunc([("m", (L, cy)), v2h((L, cy), (cx, Bm)), h2v((cx, Bm), (R, cy))], t_lo)
    return [sweep(up, a, b), sweep(lo, a, b)]


@glyph("C", 1192, 12)
def _C(B):
    return _cee(B, AC, BC2, CAP + OVER, -OVER, 0.74, 0.74)


@glyph("c", 953, 10)
def _c(B):
    return _cee(B, AL, BL2, XH + OVER, -OVER, 0.74, 0.74)


@glyph("G", 1225, 12)
def _G(B):
    a, b = AC, BC2
    L, R, cx, cy = a, B - a, B / 2, MID
    T, Bm = CAP + OVER - b, -OVER + b
    up = trunc([("m", (L, cy)), v2h((L, cy), (cx, T)), h2v((cx, T), (R, cy))], 0.80)
    lo = [("m", (L, cy)), v2h((L, cy), (cx, Bm)), h2v((cx, Bm), (R, cy)), ("l", (R, 400))]
    return [sweep(up, a, b), sweep(lo, a, b), rect(B * 0.46, 235, B, 400)]


def _ess(B, a, b, top, bot, up_r, up_l, lo_r, lo_l, spine, t_up=0.55, t_lo=0.55):
    cx = B / 2
    L, R = a, B - a
    T, Bm = top - b, bot + b
    LU, RL = (L, up_l), (R, lo_r)
    # bojo de cima, do terminal (truncado) ate LU; espinha; bojo de baixo ate ao terminal
    upper = trunc([("m", (cx, T)), h2v((cx, T), (R, up_r))], t_up)
    upper = [("m", upper[-1][-1]), ("c", upper[-1][2], upper[-1][1], (cx, T)),
             h2v((cx, T), LU)]
    lower = trunc([("m", (cx, Bm)), h2v((cx, Bm), (L, lo_l))], t_lo)
    lower = [("m", RL), v2h(RL, (cx, Bm)), ("c", lower[-1][1], lower[-1][2], lower[-1][3])]
    spine_seg = [("m", LU), ("c", (L, up_l - spine), (R, lo_r + spine), RL)]
    return [sweep(upper, a, b), sweep(spine_seg, a, b * 1.18), sweep(lower, a, b)]


@glyph("S", 1136, 2)
def _S(B):
    return _ess(B, VC / 2, HS / 2, CAP + OVER, -OVER,
                up_r=372, up_l=535, lo_r=240, lo_l=372, spine=235)


@glyph("s", 875, 2)
def _s(B):
    return _ess(B, VL / 2, HSL / 2, XH + OVER, -OVER,
                up_r=269, up_l=387, lo_r=173, lo_l=269, spine=170)


@glyph("e", 954, 10)
def _e(B):
    a, b = AL, 73
    L, R, cx = a, B - a, B / 2
    T, Bm = XH + OVER - b, -OVER + b
    bar0, bar1 = 215, 354
    path = [("m", (R, 300)), v2h((R, 300), (cx, T)), h2v((cx, T), (L, MIDX)),
            v2h((L, MIDX), (cx, Bm)), h2v((cx, Bm), (R, 230))]
    return [sweep(trunc(path, 0.72), a, b), rect(L, bar0, B, bar1)]


@glyph("a", 927, 10)
def _a(B):
    a = AL
    L, R, cx = a, B - a, B / 2
    top = trunc([("m", (R, 330)), v2h((R, 330), (cx, XH + OVER - 65)),
                 h2v((cx, XH + OVER - 65), (L, 280))], 0.50)
    return [rect(B - VLR, 0, B, XH), sweep(top, a, 65),
            loop(0, -OVER, B - VLR + 150, 320, a, 125)]


@glyph("r", 890, 24)
def _r(B):
    a, b = AL, BL2
    path = [("m", (a, 200)), v2h((a, 200), (B * 0.58, XH - b), 0.55, 0.72),
            ("l", (B - a * 0.35, XH - b))]
    return [rect(0, 0, VL, XH), sweep(path, a, b)]


@glyph("t", 584, 24)
def _t(B):
    a, b = AL, BL2
    sx = 80
    cx = sx + a
    path = [("m", (cx, 300)), v2h((cx, 300), (B - 50, b - OVER), 0.5, 0.75)]
    return [rect(sx, 0, sx + VL, 655), rect(0, XH - HL, B, XH), sweep(path, a, b)]


@glyph("g", 985, 10)
def _g(B):
    a, b = 178, 70
    R = B - AL
    hook = trunc([("m", (R, 30)), v2h((R, 30), (B * 0.52, DESC + b)),
                  h2v((B * 0.52, DESC + b), (a + 10, -95))], 0.88)
    return [loop(0, -OVER, B, XH + OVER, AL, BL2), sweep(hook, a, b)]


def _arch(B, v, top):
    """Ombro + arco + perna direita, varridos; a haste esquerda e do glifo."""
    a, b = v / 2, BL2
    L, R = a, B - a
    cx = (L + R) / 2
    path = [("m", (L, 200)), v2h((L, 200), (cx, top - b), 0.5, 0.80),
            h2v((cx, top - b), (R, 230), 0.5, 0.80), ("l", (R, 0))]
    return [sweep(path, a, b)]


@glyph("n", 982, 24)
def _n(B):
    return [rect(0, 0, VL, XH)] + _arch(B, VL, XH)


@glyph("h", 982, 24)
def _h(B):
    return [rect(0, 0, VL, ASC)] + _arch(B, VL, XH)


@glyph("m", 1499, 24)
def _m(B):
    w = (B + VL) / 2
    right = [c.shift(w - VL) for c in _arch(B - (w - VL), VL, XH)]
    return [rect(0, 0, VL, XH)] + _arch(w, VL, XH) + right


@glyph("u", 975, 24)
def _u(B):
    a, b = VL / 2, BL2
    L, R = a, B - a
    cx = (L + R) / 2
    path = [("m", (L, XH)), ("l", (L, 300)), v2h((L, 300), (cx, b - OVER), 0.5, 0.80),
            h2v((cx, b - OVER), (R, 300), 0.5, 0.80), ("l", (R, XH))]
    return [sweep(path, a, b)]


@glyph("J", 1041)
def _J(B):
    a, b = VC / 2, BC2
    R = B - a
    path = trunc([("m", (R, CAP)), ("l", (R, 330)), v2h((R, 330), (B / 2, b - OVER)),
                  h2v((B / 2, b - OVER), (a, 372))], 0.92)
    return [sweep(path, a, b)]


@glyph("U", 1196, 12)
def _U(B):
    a, b = AC, BC2
    L, R = a, B - a
    path = [("m", (L, CAP)), ("l", (L, 300)), v2h((L, 300), (B / 2, b - OVER)),
            h2v((B / 2, b - OVER), (R, 300)), ("l", (R, CAP))]
    return [sweep(path, a, b)]


@glyph("M", 1391)
def _M(B):
    w, vy = VC * 1.45, 290
    return [rect(0, 0, VC, CAP), rect(B - VC, 0, B, CAP),
            hbar((VC * 0.55, CAP), (B / 2, vy), w),
            hbar((B - VC * 0.55, CAP), (B / 2, vy), w),
            hole(rect(-900, -OUT, 0, CAP + OUT)), hole(rect(B, -OUT, B + 900, CAP + OUT)),
            hole(rect(-OUT, CAP, B + OUT, CAP + 400))]


# ---- v6: A, M, S, a, g com a estrutura medida; bojos b/d/p/q varridos ------
def _cub(c, c1, c2, p):
    return c.curve(c1, c2, p)


@glyph("A", 1222, -18)
def _A(B):
    # topo plano largo, pernas a ~0.47, travessa BAIXA, contraforma triangular pequena
    tl, tr = 351, B - 373
    il0, ir0 = 384, B - 424
    sl, sr = 0.432, 0.44
    apex = (ir0 - il0) / (sl + sr)
    cb0, cb1 = 89, 309
    xl = lambda y: il0 + sl * y
    xr = lambda y: ir0 - sr * y
    return [poly([(0, 0), (tl, CAP), (tr, CAP), (B, 0), (ir0, 0),
                  (xr(cb0), cb0), (xl(cb0), cb0), (il0, 0)]),
            hole(poly([(xl(cb1), cb1), (xr(cb1), cb1), (xl(apex), apex)]))]


@glyph("M", 1391)
def _M(B):
    # o V desce ate a linha de base e acaba num pe plano; entalhe de cima a 413
    sh, notch, expo, f0, f1 = 500, 413, 368, B / 2 - 88, B / 2 + 88
    return [poly([(0, 0), (VC, 0), (VC, expo), (f0, 0), (f1, 0), (B - VC, expo),
                  (B - VC, 0), (B, 0), (B, CAP), (B - sh, CAP), (B / 2, notch),
                  (sh, CAP), (0, CAP)])]


def _ess_holes(B, top, bot, k):
    """Os dois buracos do S (contraforma + abertura, ligados), como fraccoes
    da largura e alturas escaladas por k = altura/744."""
    x = lambda f: f * B
    y = lambda v: bot + (v + 15) * k          # v em coordenadas da caixa 744
    up = Contour((x(0.59), y(518)))
    up.line((B + OUT, y(518))).line((B + OUT, y(259))).line((B, y(259)))
    _cub(up, (B, y(410)), (x(0.91), y(480)), (x(0.654), y(488)))
    up.line((x(0.52), y(492)))
    _cub(up, (x(0.42), y(495)), (x(0.394), y(509)), (x(0.394), y(537)))
    up.line((x(0.394), y(539)))
    _cub(up, (x(0.394), y(564)), (x(0.41), y(578)), (x(0.489), y(578)))
    _cub(up, (x(0.576), y(578)), (x(0.588), y(542)), (x(0.59), y(518)))
    lo = Contour((x(0.394), y(253)))
    lo.line((-OUT, y(253))).line((-OUT, y(522))).line((x(0.011), y(522)))
    _cub(lo, (x(0.011), y(405)), (x(0.068), y(296)), (x(0.338), y(286)))
    lo.line((x(0.477), y(281)))
    _cub(lo, (x(0.59), y(277)), (x(0.599), y(252)), (x(0.599), y(228)))
    lo.line((x(0.599), y(225)))
    _cub(lo, (x(0.599), y(198)), (x(0.577), y(173)), (x(0.498), y(173)))
    _cub(lo, (x(0.405), y(173)), (x(0.395), y(221)), (x(0.394), y(253)))
    return [hole(up), hole(lo)]


def _ess_outer(B, top, bot):
    h = top - bot
    return rrect(0, bot, B, top,
                 C(0.42 * B, 0.29 * h, 0.76, 0.62), C(0.44 * B, 0.30 * h, 0.81, 0.55),
                 C(0.45 * B, 0.34 * h, 0.83, 0.51), C(0.43 * B, 0.34 * h, 0.92, 0.37))


@glyph("S", 1136, 2)
def _S(B):
    top, bot = CAP + OVER, -OVER
    return [_ess_outer(B, top, bot)] + _ess_holes(B, top, bot, 1.0)


@glyph("s", 875, 2)
def _s(B):
    top, bot = XH + OVER, -OVER
    return [_ess_outer(B, top, bot)] + _ess_holes(B, top, bot, (top - bot) / 772)


@glyph("a", 927, 8)
def _a(B):
    x = lambda f: f * B
    arc = sweep([("m", (x(0.765), 300)),
                 v2h((x(0.765), 300), (x(0.49), XH + OVER - 73), 0.45, 0.85),
                 h2v((x(0.49), XH + OVER - 73), (x(0.02) + 181, 361), 0.45, 0.85)], 181, 73)
    return [rect(x(0.567), 0, x(0.964), 380), rect(x(0.567), 0, B, 177), arc,
            rrect(0, -10, x(0.567) + 40, 330,
                  C(x(0.20), 150, 0.9, 0.5), None, None, C(x(0.27), 170, 0.9, 0.4)),
            hole(rrect(x(0.375), 128, x(0.567), 262,
                       C(60, 40, 0.7, 0.7), None, None, C(100, 60, 0.8, 0.6)))]


@glyph("g", 985, 10)
def _g(B):
    x = lambda f: f * B
    return [rrect(0, 20, x(0.62) + 40, XH + 3,
                  C(x(0.31), 255, 0.85, 0.5), C(x(0.27), 65, 0.7, 0.4),
                  C(x(0.27), 80, 0.7, 0.5), C(x(0.32), 256, 0.9, 0.45)),
            hole(rrect(x(0.39), 184, x(0.62), 367,
                       C(105, 85, 0.75, 0.5), C(113, 86, 0.75, 0.5),
                       C(113, 94, 0.75, 0.5), C(105, 94, 0.75, 0.5))),
            rect(x(0.62), -34, B, XH),
            rrect(x(0.045), DESC - 8, B, 0, None, None,
                  C(x(0.45), 270, 0.8, 0.5), C(x(0.41), 190, 0.85, 0.42)),
            hole(rrect(x(0.42), -34, x(0.62) - 1, 20, C(60, 34, 0.7, 0.6), None, None,
                       C(80, 34, 0.7, 0.6)))]


@glyph("b", 972, 24)
def _b(B):
    return [rect(0, 0, VL, ASC), loop(0, -OVER, B, XH + OVER, AL, BL2)]


@glyph("d", 971, 24)
def _d(B):
    return [rect(B - VL, 0, B, ASC), loop(0, -OVER, B, XH + OVER, AL, BL2)]


@glyph("p", 976, 24)
def _p(B):
    return [rect(0, DESC, VL, XH), loop(0, -OVER, B, XH + OVER, AL, BL2)]


@glyph("q", 970, 24)
def _q(B):
    return [rect(B - VL, DESC, B, XH), loop(0, -OVER, B, XH + OVER, AL, BL2)]


# ---- v7: bojos em D (lado esquerdo recto) para B/P/R/D, K/k, 6/8/9, ? -----
def bowl(x0, y0, x1, y1, a, b, kv=None, kh=None):
    """Bojo em D varrido: comeca e acaba dentro da haste (topos rectos escondidos),
    lado direito em superelipse. Caixa EXTERIOR (x0,y0)-(x1,y1)."""
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    L, R, T, Bm = x0 + a, x1 - a, y1 - b, y0 + b
    return sweep([("m", (L, Bm)), ("l", (cx, Bm)), h2v((cx, Bm), (R, cy), kv, kh),
                  v2h((R, cy), (cx, T), kv, kh), ("l", (L, T))], a, b)


@glyph("B", 1174)
def _B(B):
    a, b = VC / 2, HS / 2
    return [rect(0, 0, VC, CAP),
            bowl(0, MID - HS / 2, B - 28, CAP, a, b),
            bowl(0, 0, B, MID + HS / 2, a, b)]


@glyph("D", 1193, 12)
def _D(B):
    return [rect(0, 0, VC, CAP), bowl(0, 0, B, CAP, VCR / 2, HC / 2)]


@glyph("P", 1137)
def _P(B):
    return [rect(0, 0, VC, CAP), bowl(0, 268, B, CAP, VC / 2, HS / 2)]


@glyph("R", 1164)
def _R(B):
    y = 280
    return [rect(0, 0, VC, CAP), bowl(0, y, B * 0.95, CAP, VC / 2, HS / 2),
            poly([(VC * 0.9, y + HS), (VC * 0.9 + VC * 1.05, y + HS),
                  (B, 0), (B - VC * 1.05, 0)])]


def _kay(B, stem_h, top, v):
    """K/k: dois bracos que nascem DENTRO da haste; o de baixo sai do de cima."""
    w = v * 1.25
    mid = top * 0.47
    return [rect(0, 0, v, stem_h),
            poly([(v * 0.35, mid - 30), (v * 0.35 + w, mid - 30), (B, top), (B - w, top)]),
            poly([(v * 0.35, mid + 30), (v * 0.35 + w, mid + 30), (B, 0), (B - w, 0)]),
            hole(rect(-900, -OUT, 0, stem_h + OUT))]


@glyph("K", 1190)
def _K(B):
    return _kay(B, CAP, CAP, VC)


@glyph("k", 909, 24)
def _k(B):
    return _kay(B, ASC, XH, VL)


def _six(B, flip):
    """6 (flip=False) e 9 (rodado 180)."""
    a, b = VCR / 2, HS / 2
    top, bot = CAP + OVER, -OVER
    lo_top = MID + HS / 2 + 20
    parts = [loop(0, bot, B, lo_top, a, b)]
    L, cx = a, B / 2
    arm = trunc([("m", (L, lo_top - b - 40)), ("l", (L, MID + 40)),
                 v2h((L, MID + 40), (cx, top - b)), h2v((cx, top - b), (B - a, MID + 60))], 0.62)
    parts.append(sweep(arm, a, b))
    if flip:
        c = (B / 2, (top + bot) / 2)
        parts = [Raw(pt.path.transform(-1, 0, 0, -1, 2 * c[0], 2 * c[1]), pt.filled) for pt in parts]
    return parts


@glyph("six", 1130, 12)
def _n6(B):
    return _six(B, False)


@glyph("nine", 1131, 12)
def _n9(B):
    return _six(B, True)


@glyph("eight", 1111, 12)
def _n8(B):
    a, b = VCR / 2, HS / 2
    return [loop(B * 0.04, MID - HS / 2, B * 0.96, CAP + OVER, a, b),
            loop(0, -OVER, B, MID + HS / 2, a, b)]


@glyph("question", 900, 20)
def _question(B):
    a, b = VC / 2, HS / 2
    y0 = 300
    hook = [("m", (a, CAP * 0.56)), v2h((a, CAP * 0.56), (B / 2, CAP + OVER - b)),
            h2v((B / 2, CAP + OVER - b), (B - a, CAP * 0.56)),
            ("c", (B - a, CAP * 0.42), (B / 2 + 30, CAP * 0.48), (B / 2 + 20, y0))]
    return [sweep(hook, a, b), rrect((B - DOT) / 2, 0, (B + DOT) / 2, DOT, DR, DR, DR, DR)]


# --- ACENTOS ---------------------------------------------------------------
AW = 520    # largura nominal do acento
AT = 175    # espessura


def _tilde_shape(x0, x1, y0, t=None):
    """Til: tres tramos (sobe, desce, sobe) com espessura vertical constante."""
    w = x1 - x0
    t = AT * 0.95 if t is None else t
    lo, hi = y0 + t * 0.5, y0 + t * 1.15
    return [vbar((x0 + w * 0.02, lo), (x0 + w * 0.36, hi), t),
            vbar((x0 + w * 0.30, hi), (x0 + w * 0.70, lo), t),
            vbar((x0 + w * 0.64, lo), (x0 + w * 0.98, hi), t)]


RING_O = C(90, 110, 0.6, 0.6)
RING_I = C(30, 40, 0.6, 0.6)
ACCENTS = {
    "_acute": lambda: [hbar((AW * 0.30, 0), (AW * 0.80, AT * 1.5), AT * 1.05)],
    "_grave": lambda: [hbar((AW * 0.70, 0), (AW * 0.20, AT * 1.5), AT * 1.05)],
    "_circumflex": lambda: [hbar((AW * 0.08, 0), (AW * 0.50, AT * 1.55), AT),
                            hbar((AW * 0.92, 0), (AW * 0.50, AT * 1.55), AT)],
    "_caron": lambda: [hbar((AW * 0.08, AT * 1.55), (AW * 0.50, 0), AT),
                       hbar((AW * 0.92, AT * 1.55), (AW * 0.50, 0), AT)],
    "_tilde": lambda: _tilde_shape(0, AW, 0),
    "_macron": lambda: [rect(0, AT * 0.25, AW, AT * 1.30)],
    "_dieresis": lambda: [rrect(0, 0, AT * 1.20, AT * 1.20, DR, DR, DR, DR),
                          rrect(AW - AT * 1.20, 0, AW, AT * 1.20, DR, DR, DR, DR)],
    "_ring": lambda: [rrect(AW * 0.27, 0, AW * 0.73, AT * 1.7, RING_O, RING_O, RING_O, RING_O),
                      hole(rrect(AW * 0.27 + 85, 62, AW * 0.73 - 85, AT * 1.7 - 62,
                                 RING_I, RING_I, RING_I, RING_I))],
    "_cedilla": lambda: [rect(AW * 0.36, -100, AW * 0.36 + AT, 5),
                         rect(AW * 0.10, -235, AW * 0.36 + AT, -235 + AT)],
    "_commaaccent": lambda: [rect(AW * 0.39, -195, AW * 0.39 + AT, -25),
                             poly([(AW * 0.39, -195), (AW * 0.39 + AT, -195),
                                   (AW * 0.39 + AT * 0.25, -355)])],
}

COMPOSITES = {
    "Aacute": ("A", "_acute", "cap"), "Agrave": ("A", "_grave", "cap"),
    "Acircumflex": ("A", "_circumflex", "cap"), "Atilde": ("A", "_tilde", "cap"),
    "Adieresis": ("A", "_dieresis", "cap"), "Aring": ("A", "_ring", "cap"),
    "Amacron": ("A", "_macron", "cap"),
    "Ccedilla": ("C", "_cedilla", "below"), "Ccaron": ("C", "_caron", "cap"),
    "Eacute": ("E", "_acute", "cap"), "Egrave": ("E", "_grave", "cap"),
    "Ecircumflex": ("E", "_circumflex", "cap"), "Edieresis": ("E", "_dieresis", "cap"),
    "Emacron": ("E", "_macron", "cap"),
    "Gcommaaccent": ("G", "_commaaccent", "below"),
    "Iacute": ("I", "_acute", "cap"), "Igrave": ("I", "_grave", "cap"),
    "Icircumflex": ("I", "_circumflex", "cap"), "Idieresis": ("I", "_dieresis", "cap"),
    "Imacron": ("I", "_macron", "cap"),
    "Kcommaaccent": ("K", "_commaaccent", "below"),
    "Lcommaaccent": ("L", "_commaaccent", "below"),
    "Ncommaaccent": ("N", "_commaaccent", "below"), "Ntilde": ("N", "_tilde", "cap"),
    "Oacute": ("O", "_acute", "cap"), "Ograve": ("O", "_grave", "cap"),
    "Ocircumflex": ("O", "_circumflex", "cap"), "Otilde": ("O", "_tilde", "cap"),
    "Odieresis": ("O", "_dieresis", "cap"),
    "Scaron": ("S", "_caron", "cap"),
    "Uacute": ("U", "_acute", "cap"), "Ugrave": ("U", "_grave", "cap"),
    "Ucircumflex": ("U", "_circumflex", "cap"), "Udieresis": ("U", "_dieresis", "cap"),
    "Umacron": ("U", "_macron", "cap"),
    "Zcaron": ("Z", "_caron", "cap"),
    "aacute": ("a", "_acute", "lc"), "agrave": ("a", "_grave", "lc"),
    "acircumflex": ("a", "_circumflex", "lc"), "atilde": ("a", "_tilde", "lc"),
    "adieresis": ("a", "_dieresis", "lc"), "aring": ("a", "_ring", "lc"),
    "amacron": ("a", "_macron", "lc"),
    "ccedilla": ("c", "_cedilla", "below"), "ccaron": ("c", "_caron", "lc"),
    "eacute": ("e", "_acute", "lc"), "egrave": ("e", "_grave", "lc"),
    "ecircumflex": ("e", "_circumflex", "lc"), "edieresis": ("e", "_dieresis", "lc"),
    "emacron": ("e", "_macron", "lc"),
    "gcommaaccent": ("g", "_commaaccent", "below"),
    "iacute": ("dotlessi", "_acute", "lc"), "igrave": ("dotlessi", "_grave", "lc"),
    "icircumflex": ("dotlessi", "_circumflex", "lc"),
    "idieresis": ("dotlessi", "_dieresis", "lc"),
    "imacron": ("dotlessi", "_macron", "lc"),
    "kcommaaccent": ("k", "_commaaccent", "below"),
    "lcommaaccent": ("l", "_commaaccent", "below"),
    "ncommaaccent": ("n", "_commaaccent", "below"), "ntilde": ("n", "_tilde", "lc"),
    "oacute": ("o", "_acute", "lc"), "ograve": ("o", "_grave", "lc"),
    "ocircumflex": ("o", "_circumflex", "lc"), "otilde": ("o", "_tilde", "lc"),
    "odieresis": ("o", "_dieresis", "lc"),
    "scaron": ("s", "_caron", "lc"),
    "uacute": ("u", "_acute", "lc"), "ugrave": ("u", "_grave", "lc"),
    "ucircumflex": ("u", "_circumflex", "lc"), "udieresis": ("u", "_dieresis", "lc"),
    "umacron": ("u", "_macron", "lc"),
    "zcaron": ("z", "_caron", "lc"),
    "acute": ("space", "_acute", "cap"), "grave_sp": ("space", "_grave", "cap"),
    "circumflex": ("space", "_circumflex", "cap"), "caron": ("space", "_caron", "cap"),
    "tilde": ("space", "_tilde", "cap"), "macron": ("space", "_macron", "cap"),
    "dieresis": ("space", "_dieresis", "cap"), "cedilla": ("space", "_cedilla", "below"),
}

CMAP_EXTRA = {
    "Aacute": 0xC1, "Agrave": 0xC0, "Acircumflex": 0xC2, "Atilde": 0xC3,
    "Adieresis": 0xC4, "Aring": 0xC5, "Amacron": 0x100, "Ccedilla": 0xC7,
    "Ccaron": 0x10C, "Eacute": 0xC9, "Egrave": 0xC8, "Ecircumflex": 0xCA,
    "Edieresis": 0xCB, "Emacron": 0x112, "Gcommaaccent": 0x122, "Iacute": 0xCD,
    "Igrave": 0xCC, "Icircumflex": 0xCE, "Idieresis": 0xCF, "Imacron": 0x12A,
    "Kcommaaccent": 0x136, "Lcommaaccent": 0x13B, "Ncommaaccent": 0x145,
    "Ntilde": 0xD1, "Oacute": 0xD3, "Ograve": 0xD2, "Ocircumflex": 0xD4,
    "Otilde": 0xD5, "Odieresis": 0xD6, "Scaron": 0x160, "Uacute": 0xDA,
    "Ugrave": 0xD9, "Ucircumflex": 0xDB, "Udieresis": 0xDC, "Umacron": 0x16A,
    "Zcaron": 0x17D,
    "aacute": 0xE1, "agrave": 0xE0, "acircumflex": 0xE2, "atilde": 0xE3,
    "adieresis": 0xE4, "aring": 0xE5, "amacron": 0x101, "ccedilla": 0xE7,
    "ccaron": 0x10D, "eacute": 0xE9, "egrave": 0xE8, "ecircumflex": 0xEA,
    "edieresis": 0xEB, "emacron": 0x113, "gcommaaccent": 0x123, "iacute": 0xED,
    "igrave": 0xEC, "icircumflex": 0xEE, "idieresis": 0xEF, "imacron": 0x12B,
    "kcommaaccent": 0x137, "lcommaaccent": 0x13C, "ncommaaccent": 0x146,
    "ntilde": 0xF1, "oacute": 0xF3, "ograve": 0xF2, "ocircumflex": 0xF4,
    "otilde": 0xF5, "odieresis": 0xF6, "scaron": 0x161, "uacute": 0xFA,
    "ugrave": 0xF9, "ucircumflex": 0xFB, "udieresis": 0xFC, "umacron": 0x16B,
    "zcaron": 0x17E,
    "acute": 0xB4, "grave_sp": 0x60, "circumflex": 0x2C6, "caron": 0x2C7,
    "tilde": 0x2DC, "macron": 0xAF, "dieresis": 0xA8, "cedilla": 0xB8,
}

ASCII_NAMES = {
    "space": 0x20, "exclam": 0x21, "quotedbl": 0x22, "numbersign": 0x23,
    "dollar": 0x24, "percent": 0x25, "ampersand": 0x26, "quotesingle": 0x27,
    "parenleft": 0x28, "parenright": 0x29, "asterisk": 0x2A, "plus": 0x2B,
    "comma": 0x2C, "hyphen": 0x2D, "period": 0x2E, "slash": 0x2F,
    "colon": 0x3A, "semicolon": 0x3B, "less": 0x3C, "equal": 0x3D,
    "greater": 0x3E, "question": 0x3F, "at": 0x40, "bracketleft": 0x5B,
    "backslash": 0x5C, "bracketright": 0x5D, "asciicircum": 0x5E,
    "underscore": 0x5F, "braceleft": 0x7B, "bar": 0x7C, "braceright": 0x7D,
    "asciitilde": 0x7E, "degree": 0xB0, "multiply": 0xD7, "sterling": 0xA3,
    "periodcentered": 0xB7, "endash": 0x2013, "emdash": 0x2014,
    "quoteleft": 0x2018, "quoteright": 0x2019, "quotedblleft": 0x201C,
    "quotedblright": 0x201D, "bullet": 0x2022, "ellipsis": 0x2026, "euro": 0x20AC,
}


# --- CONSTRUCAO ------------------------------------------------------------
def compile_outline(contours):
    """Aplica os contornos por ordem: pintado = uniao, buraco = diferenca."""
    result = None
    for c in contours:
        p = Path()
        c.draw(p.getPen())
        if result is None:
            result = p if c.filled else Path()
        else:
            result = pathop(result, p, PathOp.UNION if c.filled else PathOp.DIFFERENCE)
    return result if result is not None else Path()


def build(dest):
    order = [".notdef"]
    widths, outlines, cmap = {}, {}, {}

    def emit(name, contours, adv, sb):
        outlines[name] = compile_outline([c.shift(sb) for c in contours])
        widths[name] = int(round(adv))
        order.append(name)

    outlines[".notdef"] = compile_outline(
        [rect(60, 0, 560, CAP), hole(rect(160, 100, 460, CAP - 100))])
    widths[".notdef"] = 620

    for name, (adv, sb, fn) in G.items():
        emit(name, fn(adv - 2 * sb), adv, sb)

    emit("dotlessi", [rect(0, 0, 364, XH)], 412, 24)

    for name, fn in ACCENTS.items():
        emit(name, fn(), 0, 0)

    for ch in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz":
        cmap[ord(ch)] = ch
    for i, n in enumerate(["zero", "one", "two", "three", "four", "five", "six",
                           "seven", "eight", "nine"]):
        cmap[ord("0") + i] = n
    for n, cp in ASCII_NAMES.items():
        cmap[cp] = n
    cmap[0x131] = "dotlessi"

    comps = {}
    for name, (base, acc, kind) in COMPOSITES.items():
        dy = {"cap": CAP + 55, "lc": XH + 55, "below": 0}[kind]
        dx = (widths[base] - AW) / 2
        comps[name] = [(base, (1, 0, 0, 1, 0, 0)),
                       (acc, (1, 0, 0, 1, int(round(dx)), int(round(dy))))]
        widths[name] = widths[base]
        order.append(name)
        cmap[CMAP_EXTRA[name]] = name

    glyphs = {}
    glyph_set = {n: None for n in order}
    for name, path in outlines.items():
        pen = TTGlyphPen(glyph_set)
        path.draw(Cu2QuPen(pen, max_err=0.8))
        glyphs[name] = pen.glyph()
    for name, parts in comps.items():
        pen = TTGlyphPen(glyph_set)
        for base, tr in parts:
            pen.addComponent(base, tr)
        glyphs[name] = pen.glyph()

    metrics = {}
    for name in order:
        g = glyphs[name]
        metrics[name] = (widths[name], getattr(g, "xMin", 0) if g.numberOfContours else 0)

    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=812, descent=-188, lineGap=0)
    fb.setupNameTable({
        "familyName": "OMS Wide",
        "styleName": "Regular",
        "uniqueFontIdentifier": "OMSWide-Regular;1.000;oms",
        "fullName": "OMS Wide",
        "psName": "OMSWide-Regular",
        "version": "Version 1.000",
        "copyright": "Copyright (c) 2026 Afonso Coutinho. "
                     "Licensed under the SIL Open Font License, Version 1.1.",
        "designer": "Afonso Coutinho",
        "description": "Ultra-wide black display face. "
                       "Generated by scripts/generate-oms-wide.py.",
        "licenseDescription": "This Font Software is licensed under the SIL Open "
                              "Font License, Version 1.1.",
        "licenseInfoURL": "https://scripts.sil.org/OFL",
    })
    fb.setupOS2(
        sTypoAscender=812, sTypoDescender=DESC, sTypoLineGap=0,
        usWinAscent=830, usWinDescent=210, sxHeight=XH, sCapHeight=CAP,
        usWeightClass=900, usWidthClass=7, achVendID="OMS ",
        panose=dict(bFamilyType=2, bSerifStyle=11, bWeight=10, bProportion=6,
                    bContrast=2, bStrokeVariation=2, bArmStyle=2, bLetterForm=2,
                    bMidline=2, bXHeight=7),
    )
    fb.setupPost(isFixedPitch=0, underlinePosition=-170, underlineThickness=140)
    fb.save(dest)
    if dest.endswith(".ttf"):
        fb.font.flavor = "woff2"
        fb.font.save(dest[:-4] + ".woff2")
    print(f"OK {dest}  {len(order)} glifos")


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else "OMSWide-Regular.ttf")
