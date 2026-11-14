"""Measure a color look and suggest starting Photoshop adjustment values. Read-only: it never writes image files.

usage: python3 look_stats.py REFERENCE PHOTO [GRADED] [--ref-mask REF_MASK --photo-mask PHOTO_MASK]

Prints JSON with each image's look statistics (CIELAB: black/white point, contrast, brightness, saturation, overall
cast, shadow tint, highlight tint) and `suggested`: values for image_apply_adjustments that move PHOTO toward the
reference's look. With GRADED (a test grade of PHOTO), `remaining` says what is still off and `correction_regions` gives
the tints for one correction pass. Pass the subject masks (downloaded from image_select_subject on the reference and on the
photo) so the correction compares subject with subject and background with background. Needs numpy and Pillow (preinstalled in most code sandboxes); if they are missing, skip the
measurement and judge by eye."""
import io, json, sys

# The calibration files cited below (calibration/..., unit_effects_direct.json) are in the research repo
# github.com/Research-Adobe/expand-adobe-3p-skills under datasets/qa2skill/match-photo-look/.

import numpy as np
from PIL import Image, ImageOps

# Effect of one unit of each image_apply_adjustments field on the statistics below, averaged over 6 photos and both signs
# from 186 direct tool calls (datasets/qa2skill/match-photo-look/calibration/unit_effects_direct.json). Rows: field -> {stat: change per unit}.
UNIT = {"tempA": {"white": -0.0015, "saturation": 0.0055, "cast_a": 0.0396, "cast_b": -0.0014}, "tempB": {"cast_a": -0.004, "cast_b": 0.0377}, "contrast": {"black": -0.055, "white": 0.0372, "contrast": 0.0384, "brightness": -0.0143, "saturation": 0.0181, "cast_a": 0.0129, "cast_b": 0.0214}, "saturation": {"black": 0.004, "white": -0.0155, "contrast": -0.0041, "saturation": 0.176, "cast_a": 0.0503, "cast_b": 0.1141}, "darks": {"black": 0.1336, "white": 0.0516, "contrast": -0.0337, "brightness": 0.128, "saturation": 0.0045, "cast_a": -0.0029, "cast_b": -0.0173}, "highlights": {"white": 0.0726, "contrast": 0.0307, "brightness": 0.0283, "saturation": 0.016, "cast_a": 0.0053, "cast_b": 0.0081}, "lights": {"black": 0.0254, "white": 0.1461, "contrast": 0.0528, "brightness": 0.1043, "saturation": 0.0558, "cast_a": 0.0302, "cast_b": 0.0298}, "gamma": {"black": 24.1125, "white": 13.3056, "contrast": -3.775, "brightness": 24.7611, "saturation": 1.8292, "cast_a": -0.5597, "cast_b": -1.9167}}
# Any use of the temperature group darkens the image by about this much, even tempA = tempB = 0; tempLuminance 50-65
# barely changes it (calibration_runs_temp.json).
TEMP_OFFSET = {"black": -1.65, "white": -5.76, "contrast": -1.38, "brightness": -3.61, "saturation": -1.49, "cast_a": -0.57, "cast_b": -0.61}
LIMITS = {"tempA": (-40, 40), "tempB": (-100, 100), "contrast": (-40, 40), "saturation": (-50, 40), "darks": (-35, 35),
          "highlights": (-60, 30), "lights": (-40, 40), "gamma": (0.75, 1.35)}
# How much of the reference/photo difference to transfer (v0.1.6: chosen end to end on real tool outputs, synthetic set +
# a real camera control; calibration/e2e_variants.jsonl). Tone and saturation carry the grade; overall colour and
# brightness also carry the scene's content (a green hedge stays green), so only part of that difference is moved.
SHARE = {"black": 0.7, "white": 0.9, "contrast": 0.7, "brightness": 0.5, "saturation": 0.7, "cast_a": 0.5, "cast_b": 0.5}
SCALE = {"black": 5.0, "white": 5.0, "contrast": 4.0, "brightness": 6.0, "saturation": 4.0, "cast_a": 3.0, "cast_b": 3.0}


def encoded_max(im):
    """Largest positive sample value the image's encoding allows, or None when only the values can tell.
    TIFF: BitsPerSample (tag 258) with SampleFormat (tag 339; 2 = signed, so 2**(bits-1) - 1). Otherwise the mode:
    'I;16*' is unsigned 16-bit, 'I;16*S' signed. Read it from the image as opened: copies such as an EXIF-transposed
    one lose the TIFF tags, so callers that transpose pass this value on to to_srgb()."""
    tags = getattr(im, "tag_v2", None)
    bits = tags.get(258) if tags is not None else None
    if isinstance(bits, tuple):
        bits = bits[0]
    if bits:
        fmt = tags.get(339, 1)
        fmt = fmt[0] if isinstance(fmt, tuple) else fmt
        return float(2 ** (bits - 1) - 1) if fmt == 2 else float(2 ** bits - 1)
    if im.mode.startswith("I;16"):
        return 32767.0 if im.mode.endswith("S") else 65535.0
    return None


def _to_8bit(im, top=None):
    """16- and 32-bit grayscale ('I;16*', 'I') scaled from its full range to 8-bit 'L'. A plain convert() clips every
    value above 255, so a mid-grey 16- or 32-bit pixel would read as white. The range is `top` (the encoded maximum,
    see encoded_max), else the image's own encoding, else the values decide: up to 255 is 8-bit data, up to 65535 is
    16-bit data stored as 'I', anything larger is signed 32-bit. Negative values clip to black. The image's info (ICC
    profile, transparency) is kept."""
    a = np.asarray(im, dtype=np.float64)
    top = top or encoded_max(im)
    if not top:
        peak = float(a.max()) if a.size else 0.0
        top = 255.0 if peak <= 255 else 65535.0 if peak <= 65535 else float(2 ** 31 - 1)
    out = Image.fromarray(np.clip(np.round(a / top * 255.0), 0, 255).astype(np.uint8), "L")
    out.info = dict(im.info)
    return out


def to_srgb(im, depth=None):
    """An RGB copy of `im` in sRGB. An embedded ICC profile (Adobe RGB, Display P3, CMYK, grayscale, ...) is converted;
    untagged images are taken as sRGB. A grayscale profile is applied to the grayscale image itself (an RGB copy
    wouldn't match the profile). If the profile can't be read or LittleCMS isn't available, the channels are used as is.
    Anything that uploads a photo for grading must send these same values, so the tools see what was measured."""
    if im.mode.startswith("I;16") or im.mode == "I":
        im = _to_8bit(im, depth)                   # `depth`: encoded_max() of the image as opened (see there)
    icc = im.info.get("icc_profile")
    base = im if im.mode in ("RGB", "CMYK") else im.convert("RGB")
    if not icc:
        return base.convert("RGB")
    try:
        from PIL import ImageCms
    except ImportError:                            # Pillow built without LittleCMS: no colour management available
        return base.convert("RGB")
    try:
        profile = ImageCms.ImageCmsProfile(io.BytesIO(icc))
    except (OSError, ImageCms.PyCMSError):         # unreadable or malformed embedded profile: take the image as sRGB
        return base.convert("RGB")
    if profile.profile.xcolor_space.strip() == "GRAY" and im.mode in ("L", "LA"):
        base = im.convert("L")
    try:
        return ImageCms.profileToProfile(base, profile, ImageCms.createProfile("sRGB"), outputMode="RGB")
    except (ImageCms.PyCMSError, ValueError):      # profile doesn't fit the image's channels: take the image as sRGB
        return base.convert("RGB")


def _load(path, side=320, upright=False):
    """Pixels as sRGB in [0, 1] (H x W x 3) and a mask of the pixels that count.

    Colour profiles are handled by to_srgb(), so a reference and a photo in different colour spaces aren't read as
    different looks. Transparency, whether an alpha band or a PNG colour key, is honoured: the image is downscaled with
    colour weighted by opacity (premultiplied), so colours hidden under transparent pixels don't bleed into visible
    ones, and pixels under 50% opacity are left out of every statistic. `upright` applies the EXIF orientation (needed
    when a mask is laid on the image)."""
    im = Image.open(path)
    depth = encoded_max(im)                        # before transposing: the transposed copy has no TIFF tags
    if upright:
        im = ImageOps.exif_transpose(im)
    has_alpha = im.mode in ("RGBA", "LA", "PA", "La", "RGBa") or "transparency" in im.info
    rgb = to_srgb(im, depth)
    if not has_alpha:
        rgb.thumbnail((side, side))
        arr = np.asarray(rgb, dtype=np.float64) / 255.0
        return arr, np.ones(arr.shape[:2], dtype=bool)
    rgba = Image.merge("RGBA", (*rgb.split(), im.convert("RGBA").getchannel("A"))).convert("RGBa")
    rgba.thumbnail((side, side))
    rgba = rgba.convert("RGBA")
    arr = np.asarray(rgba.convert("RGB"), dtype=np.float64) / 255.0
    keep = np.asarray(rgba.getchannel("A"), dtype=np.float64) >= 128
    if not keep.any():
        keep[:] = True                             # fully transparent: measure everything rather than nothing
    return arr, keep


def _lab(rgb):
    """CIELAB L, a, b of sRGB pixels (any shape ... x 3), each flattened."""
    c = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    xyz = c @ np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750],
                        [0.0193339, 0.1191920, 0.9503041]]).T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return (116 * f[..., 1] - 16).ravel(), (500 * (f[..., 0] - f[..., 1])).ravel(), (200 * (f[..., 1] - f[..., 2])).ravel()


def stats(path, side=320):
    rgb, keep = _load(path, side)
    L, a, b = _lab(rgb[keep])
    lo, hi = L <= np.percentile(L, 30), L >= np.percentile(L, 70)
    r = lambda v: round(float(v), 1)
    # Colour not explained by lightness: near 0 for black and white or a single-tone print (sepia), 2+ for a colour photo.
    # A flat image (one lightness everywhere, e.g. all black) can't be fit by a curve; its colour spread is the residual.
    # A graphic with only a few lightness levels gets a lower-degree fit (a cubic through 2-3 points is ill-posed).
    deg = min(3, int(np.unique(np.round(L, 2)).size) - 1)
    if deg < 1:
        resid = max(float(np.std(a)), float(np.std(b)))
    else:
        resid = max(float(np.std(ch - np.polyval(np.polyfit(L, ch, deg), L))) for ch in (a, b))
    # How much the coloured pixels share one hue: 1 = a single tone (sepia, cyanotype), near 0 = several hues. A
    # graphic with a few flat colours can have a tiny residual above (few lightness levels), so mono also needs this.
    chroma = np.hypot(a, b); col = chroma > 4
    coherence = float(np.hypot((a[col]).sum(), (b[col]).sum()) / chroma[col].sum()) if col.sum() >= max(10, 0.01 * len(L)) else 1.0
    return {"color_beyond_tone": r(resid), "hue_coherence": round(coherence, 2), "black": r(np.percentile(L, 5)), "white": r(np.percentile(L, 95)),
            "contrast": r(L.std()), "brightness": r(L.mean()),
            "saturation": r(np.hypot(a, b).mean()), "cast_a": r(a.mean()), "cast_b": r(b.mean()),
            "shadow_tint": [r(a[lo].mean()), r(b[lo].mean())], "highlight_tint": [r(a[hi].mean()), r(b[hi].mean())]}


def is_mono(ref):
    """Black and white, or a single-tone print: almost no colour, or colour that follows lightness in one hue."""
    return ref["saturation"] < 3 or (ref["color_beyond_tone"] < 1.2 and ref.get("hue_coherence", 1.0) >= 0.9)


RIDGE = 1.0   # preference for small moves when the statistics can't tell fields apart
PEAK = 0.7    # largest share of any field's span a suggestion may use before all fields are scaled down together
# Usable span of each field, so the solver treats "a lot of contrast" and "a lot of gamma" as equally costly.
SPAN = {"tempA": 40, "tempB": 100, "contrast": 40, "saturation": 50, "darks": 35, "highlights": 60, "lights": 40, "gamma": 0.35}


def _solve(target, fields, fixed=None):
    fixed = fixed or {}
    J = np.array([[UNIT[p].get(k, 0.0) * SPAN[p] / SCALE[k] for p in fields] for k in SHARE])
    y = np.array([(target[k] - sum(UNIT[p].get(k, 0.0) * v for p, v in fixed.items())) / SCALE[k] for k in SHARE])
    ridge = RIDGE * np.eye(len(fields))
    x = np.linalg.solve(J.T @ J + ridge, J.T @ y) * np.array([SPAN[p] for p in fields])
    return {p: float(np.clip(v, *LIMITS[p])) if p != "gamma" else float(np.clip(1 + v, *LIMITS[p])) - 1 for p, v in zip(fields, x)}


# Share used when the reference's black point is HIGHER than the photo's. A light, low-contrast reference often just
# contains no dark objects (content), while the photo does (sunglasses, a black jacket); copying its black point then
# greys out real blacks. A deliberate faded/matte look still comes through, at a smaller share.
BLACK_LIFT_SHARE = 0.3


def look_target(ref, photo):
    """The share of each statistic's difference that the global adjustments aim to move (see SHARE, BLACK_LIFT_SHARE)."""
    target = {k: SHARE[k] * (ref[k] - photo[k]) for k in SHARE}
    if ref["black"] > photo["black"]:
        target["black"] = BLACK_LIFT_SHARE * (ref["black"] - photo["black"])
    return target


def suggest(ref, photo):
    target = look_target(ref, photo)
    x = _solve(target, list(UNIT))
    if abs(x["tempA"]) >= 3 or abs(x["tempB"]) >= 3:
        # A temperature change darkens the photo; solve the tone fields again so they make up for it.
        temp = {p: x[p] for p in ("tempA", "tempB")}
        x.update(_solve({k: target[k] - TEMP_OFFSET[k] for k in SHARE}, [p for p in UNIT if p not in temp], fixed=temp))
    # Moderate: if any field would pass 70% of its span, scale every field down together. The direction of the look
    # is kept. This also scales the part that makes up for the temperature darkening, although the darkening itself
    # is fixed. Keeping that part whole was tried (review of PR #15) and measured end to end with direct tool calls:
    # synthetic agreement fell from 0.900 to 0.807 (lost the black point and shadow tint of a dark look and the
    # highlight warmth of a bright one; calibration/verify_v0.1.10-alpha_full-temp-comp.jsonl). The shares (v0.1.6)
    # were tuned with this behaviour, so it stays.
    peak = max(abs(v) / SPAN[p] for p, v in x.items())
    if peak > PEAK:
        x = {p: v * PEAK / peak for p, v in x.items()}
    out = {}
    for p, v in x.items():
        if p == "gamma":
            if abs(v) >= 0.04: out[p] = round(1.0 + v, 2)
        elif abs(v) >= 3:
            out[p] = int(round(v))
    if "tempA" in out or "tempB" in out:
        out.setdefault("tempA", 0); out.setdefault("tempB", 0); out["tempLuminance"] = 50
    return out


def _lab_to_rgb(L, a, b):
    fy = (L + 16) / 116; fx, fz = fy + a / 500, fy - b / 200
    f = lambda t: t ** 3 if t ** 3 > 216 / 24389 else (116 * t - 16) / (24389 / 27)
    x, y, z = 0.95047 * f(fx), f(fy), 1.08883 * f(fz)
    rgb = (3.2404542 * x - 1.5371385 * y - 0.4985314 * z, -0.9692660 * x + 1.8760108 * y + 0.0415560 * z,
           0.0556434 * x - 0.2040259 * y + 1.0572252 * z)
    g = lambda c: 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
    return {k: int(round(255 * min(1.0, max(0.0, g(v))))) for k, v in zip(("red", "green", "blue"), rgb)}


def suggest_regions(split):
    """Subject/background softLight fills in the direction the highlights/shadows should move.

    Measured on real tool outputs (calibration/regions_runs.jsonl): tints lift the colour dimensions that global
    adjustments can't reach. Tint both regions when the larger of the two moves is at least 12 (a/b units), at opacity 30,
    or 15 when it is over 40 (a move that large is mostly the photo's own content, e.g. a red table, not the grade).
    A region whose own move is tiny (under 2) has no direction and is left out."""
    moves = {region: split[key] for region, key in (("subject", "highlights_should_move_ab"), ("background", "shadows_should_move_ab"))}
    big = max(float(np.hypot(*m)) for m in moves.values())
    if big < 12:
        return []
    out = []
    for region, (da, db) in moves.items():
        n = float(np.hypot(da, db))
        if n < 2:
            continue
        out.append({"select": region, "fill": {"color": _lab_to_rgb(62, da / n * 55, db / n * 55), "blendMode": "softLight",
                                                "opacity": 15 if big > 40 else 30}})
    return out


def suggest_mono(ref):
    """Black-and-white or single-tone reference: tint hue from its cast, a moderate strength (calibration: hue 30-40,
    saturation 20-35 all matched a sepia reference on the measured dimensions)."""
    if not is_mono(ref):
        return None
    if np.hypot(ref["cast_a"], ref["cast_b"]) < 1.5:
        # Neutral black and white: a zero-saturation tint. Only tool options are returned (the tool rejects extra
        # keys); advice for the agent goes in `hints`.
        return {"hue": 0, "saturation": 0, "lightness": 0}
    # image_apply_monochromatic_tint takes an HSL hue (yellow 50, red 0, blue 226), not a Lab angle: go through RGB.
    n = float(np.hypot(ref["cast_a"], ref["cast_b"]))
    c = _lab_to_rgb(60, ref["cast_a"] / n * 40, ref["cast_b"] / n * 40)
    r, g, b = c["red"] / 255, c["green"] / 255, c["blue"] / 255
    mx, mn = max(r, g, b), min(r, g, b)
    if mx == mn:
        h = 0.0
    elif mx == r:
        h = (60 * (g - b) / (mx - mn)) % 360
    elif mx == g:
        h = 60 * (b - r) / (mx - mn) + 120
    else:
        h = 60 * (r - g) / (mx - mn) + 240
    return {"hue": int(round(h)), "saturation": 30, "lightness": 0}


# Soft-light fills move b (yellow-blue) more than a (pink-green): on two real photos with controls, an amber fill moved b
# 1.25-3x more than a. The correction tint gives the a part extra weight so a pinkish residual isn't delivered as yellow.
A_BOOST = 1.8


CORRECTION_GATE = 0.4   # correct a region only if at least this share of its original move is still missing


def region_ab(path, mask_path, side=320):
    """Mean CIELAB (a, b) of an image inside (subject) and outside (background) a selection mask (white = subject).
    Adobe returns masks upright, so the image is turned upright (EXIF orientation) before the mask is laid on it.
    Colour profiles and transparency are handled as in stats()."""
    rgb, keep = _load(path, side, upright=True)
    m = Image.open(mask_path).convert("L").resize((rgb.shape[1], rgb.shape[0]))
    w = np.asarray(m, dtype=np.float64).ravel() / 255.0
    _, a, b = _lab(rgb)
    keep = keep.ravel()
    sub, bg = (w > 0.5) & keep, (w <= 0.5) & keep
    mean = lambda v, k: float(v[k].mean()) if k.any() else 0.0
    return {"subject": (mean(a, sub), mean(b, sub)), "background": (mean(a, bg), mean(b, bg))}


def same_scene(ref_regions, photo_regions):
    """True when the reference looks like the same kind of scene as the photo (e.g. two shots from one session with a
    different white balance): subject and background shift in the same colour direction by a moderate, similar amount.
    A film still or an unrelated scene gives large or non-parallel shifts, and copying subject colour across different
    subjects is wrong. Heuristic fit on 2 real same-scene pairs and 7 different-content pairs (calibration/)."""
    s = np.subtract(ref_regions["subject"], photo_regions["subject"]); b = np.subtract(ref_regions["background"], photo_regions["background"])
    ns, nb = float(np.hypot(*s)), float(np.hypot(*b))
    if ns < 1e-6 or nb < 1e-6:
        return False
    cos = float(np.dot(s, b) / (ns * nb))
    return cos >= 0.9 and ns <= 15 and nb <= 15 and 0.4 <= ns / nb <= 2.5


# The measured correction below (GRADED + --ref-mask/--photo-mask) is not used by SKILL.md (since v0.1.9): on claude.ai the
# sandbox can't download Adobe tool outputs (they redirect to a host outside its network allowlist). It is kept for when
# output links are reachable; on direct calls it closed a further ~12% of the gap on a same-scene pair.
def suggest_correction_masked(ref_regions, photo_regions, graded_regions):
    """Mask-based correction for same-scene references: move the graded subject toward the reference's subject colour
    and the graded background toward the reference's background, where at least CORRECTION_GATE of that region's
    original move is missing. Returns [] for a different-content reference (see same_scene)."""
    out = []
    if not same_scene(ref_regions, photo_regions):
        return out
    for region in ("subject", "background"):
        ra, rb = ref_regions[region]; pa, pb = photo_regions[region]; ga, gb = graded_regions[region]
        n0 = float(np.hypot(ra - pa, rb - pb)); da, db = ra - ga, rb - gb; left = float(np.hypot(da, db))
        if left < 3 or n0 < 1e-6 or left / n0 < CORRECTION_GATE:
            continue
        da *= A_BOOST; n = float(np.hypot(da, db))
        out.append({"select": region, "fill": {"color": _lab_to_rgb(62, da / n * 55, db / n * 55), "blendMode": "softLight",
                                                "opacity": int(min(30, max(8, round(3 * left))))}})
    return out


def suggest_correction(ref, photo, graded):
    """One measured correction after the test grade (Step 3): tints aimed at what is STILL off in the shadows and
    highlights compared with the reference, only where a large share of the move is missing (a reference's colours also
    carry its content, so chasing a small remainder overshoots). Opacity scales with the remaining move (8-30)."""
    out = []
    before, split = tint_gap(ref, photo), tint_gap(ref, graded)
    for region, key in (("subject", "highlights_should_move_ab"), ("background", "shadows_should_move_ab")):
        n0 = float(np.hypot(*before[key]))
        da, db = split[key]; left = float(np.hypot(da, db))
        if left < 3 or n0 < 1e-6 or left / n0 < CORRECTION_GATE:
            continue
        da *= A_BOOST; n = float(np.hypot(da, db))
        out.append({"select": region, "fill": {"color": _lab_to_rgb(62, da / n * 55, db / n * 55), "blendMode": "softLight",
                                                "opacity": int(min(30, max(8, round(3 * n))))}})
    return out


def tint_gap(ref, photo):
    """Difference in the shadow-vs-highlight colour split (a teal/orange or warm/cool split shows up here)."""
    ds = [ref["shadow_tint"][i] - photo["shadow_tint"][i] for i in (0, 1)]
    dh = [ref["highlight_tint"][i] - photo["highlight_tint"][i] for i in (0, 1)]
    return {"shadows_should_move_ab": [round(v, 1) for v in ds], "highlights_should_move_ab": [round(v, 1) for v in dh]}


def main(argv):
    masks = {}
    for flag in ("--ref-mask", "--photo-mask"):
        if flag in argv:
            i = argv.index(flag); masks[flag] = argv[i + 1]; argv = argv[:i] + argv[i + 2:]
    if len(argv) < 2:
        sys.exit(__doc__)
    ref, photo = stats(argv[0]), stats(argv[1])
    split = tint_gap(ref, photo)
    out = {"reference": ref, "photo": photo, "suggested": suggest(ref, photo), "split": split,
           # A monochrome reference gets a single tint (suggested_mono) instead of region tints.
           "suggested_regions": [] if suggest_mono(ref) else suggest_regions(split),
           "suggested_mono": suggest_mono(ref),
           "how_to_read": "black/white = 5th/95th percentile lightness (0-100); contrast = spread of lightness; "
                          "color_beyond_tone near 0 = black and white or single-tone (sepia); "
                          "saturation = mean chroma; cast_a: + magenta / - green; cast_b: + yellow / - blue; "
                          "tints are [a, b] in the darkest 30% and brightest 30% of pixels."}
    hints = []
    if is_mono(ref):
        hints.append("The reference is nearly black and white: set `mono` (image_apply_monochromatic_tint) instead of lowering saturation; "
                     "its cast_a/cast_b give the tone (warm brown = sepia).")
        if out["suggested_mono"] and out["suggested_mono"]["saturation"] == 0:
            hints.append("The reference is neutral black and white (no tone): apply `suggested_mono` as printed (a "
                         "zero-saturation tint). Don't add a preset: the other values are measured on the unedited photo.")
    if ref["cast_b"] - photo["cast_b"] >= 6:
        hints.append("The reference is much warmer: tempB alone warms only slightly on this tool. Add a warm `wash` "
                     "(image_apply_color_overlay, an amber colour, blendMode softLight) or warm `regions` fills.")
    if abs(ref["black"] - photo["black"]) >= 8 and ref["black"] > photo["black"]:
        hints.append("The reference has lifted (faded) blacks: lift them with `darks` only, not darks + shadows + exposureOffset.")
    out["hints"] = hints
    if len(argv) > 2:
        g = stats(argv[2])
        out["graded"] = g
        target = look_target(ref, photo)       # the same shares `suggested` aims for (incl. BLACK_LIFT_SHARE)
        out["remaining"] = {k: round(target[k] - (g[k] - photo[k]), 1) for k in SHARE}
        if len(masks) == 2:   # selection masks downloaded from image_select_subject on the reference and on the photo
            rr = region_ab(argv[0], masks["--ref-mask"]); pr = region_ab(argv[1], masks["--photo-mask"]); gr = region_ab(argv[2], masks["--photo-mask"])
            out["correction_regions"] = suggest_correction_masked(rr, pr, gr)
        else:
            out["correction_regions"] = suggest_correction(ref, photo, g)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
