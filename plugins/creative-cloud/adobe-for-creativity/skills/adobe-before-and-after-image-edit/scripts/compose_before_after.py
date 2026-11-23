#!/usr/bin/env python3
"""Compose a labeled side-by-side "before and after" comparison image.

Bundled with the adobe-before-and-after-image-edit skill. Reads two local image files and
writes one image with the Before image on the left (or top) and the After image on the right
(or bottom), each under a text label. Both images are scaled to a shared edge without
cropping, so any reframing done by the edit stays visible, and neither image is upscaled.
Embedded color profiles are converted to sRGB so a wide-gamut original isn't shown duller than
it is, and integer grayscale is mapped to 8 bits using one sample range for both images. The
range starts at 0-65535 and extends to include wider or signed samples from either image, so
the panels aren't normalized independently. Labels use the first
installed font that can draw every character in them; long labels shrink and then wrap. The
input files are never modified, and no metadata (EXIF, GPS) is copied to the output.

Requirements: Python 3.8+ and Pillow 9.2+ (verified with Python 3.8 + Pillow 9.2.0 and Python 3.12
+ Pillow 12.3.0). This script never installs anything: when Pillow is missing it exits with
code 3 so the caller can present the two images as labeled links instead.

Exit codes:
    0  success; a one-line JSON summary is printed to stdout
    1  an input image could not be read, or the output could not be written
    2  invalid arguments (unknown option, unsupported output type or color, identical inputs,
       or a write that would overwrite an existing file)
    3  Pillow is not installed
    4  the labels can't be drawn here: no installed font has all of their characters, or they
       need right-to-left or combining-mark layout this Pillow build lacks (no libraqm).
       Run again with --no-labels and name the sides in your reply instead.

Examples:
    python3 compose_before_after.py original.jpg edited.jpg before-after/original-before-after.png
    python3 compose_before_after.py raw.png final.png out.png --layout vertical \\
        --before-label Original --after-label Retouched
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import unicodedata
from pathlib import Path
from types import SimpleNamespace

EXIT_OK = 0
EXIT_IMAGE_ERROR = 1
EXIT_USAGE = 2
EXIT_PILLOW_MISSING = 3
EXIT_LABEL_FONT = 4

# The panels share one edge: their height side by side, their width when stacked. It is the
# smaller of the two images' edges (so neither image is upscaled), capped at DEFAULT_MAX_EDGE
# to keep the file quick to share; social platforms downscale larger uploads anyway.
DEFAULT_MAX_EDGE = 2048
MIN_MAX_EDGE = 64
# Space between and around the panels, as a fraction of the shared edge.
GAP_RATIO = 0.02
MIN_GAP_PX = 8
# Label strip above each panel, as a fraction of the shared edge; the text fills 60% of it.
LABEL_BAND_RATIO = 0.07
MIN_LABEL_BAND_PX = 28
LABEL_TEXT_RATIO = 0.6
# Long labels shrink to fit within this share of the panel width (e.g. narrow portraits), down to
# MIN_LABEL_TEXT_PX; past that they wrap onto more lines and the label strip grows to hold them.
LABEL_MAX_WIDTH_RATIO = 0.9
MIN_LABEL_TEXT_PX = 10
# Space between wrapped label lines, as a fraction of the text size.
LABEL_LINE_SPACING_RATIO = 0.2
# Transparent areas (e.g. a removed background) are shown over a light checkerboard.
CHECKER_PX = 16
CHECKER_LIGHT = (255, 255, 255)
CHECKER_DARK = (222, 222, 222)
# Labels are drawn dark on backgrounds brighter than this luminance (0-255), white otherwise.
LIGHT_BACKGROUND_LUMINANCE = 140
DARK_TEXT = (26, 26, 26)
LIGHT_TEXT = (255, 255, 255)
# JPEG/WebP quality: visually lossless for photos while keeping the file shareable.
LOSSY_QUALITY = 92
OUTPUT_FORMATS = {".png": "PNG", ".jpg": "JPEG", ".jpeg": "JPEG", ".webp": "WEBP"}
# Integer grayscale modes Pillow uses for 16-bit PNG and TIFF files, and the 16-bit full scale.
INTEGER_GRAY_MODES = ("I", "I;16", "I;16L", "I;16B", "I;16N")
SIXTEEN_BIT_MAX = 65535
# Bold sans-serif faces that ship with common Linux, macOS, and Windows installs, Latin-script
# faces first. Pillow searches each platform's font folders for these file names. Labels use the
# first face that has every character in them; Pillow's built-in font is the last resort.
FONT_CANDIDATES = (
    # Latin, Greek, and Cyrillic (Arial and DejaVu also cover Arabic and Hebrew)
    "DejaVuSans-Bold.ttf",
    "LiberationSans-Bold.ttf",
    "Arial Bold.ttf",
    "arialbd.ttf",
    # Chinese, Japanese, and Korean: Linux, then macOS, then Windows
    "NotoSansCJK-Bold.ttc",
    "NotoSansCJK-Regular.ttc",
    "wqy-zenhei.ttc",
    "ヒラギノ角ゴシック W6.ttc",
    "AppleSDGothicNeo.ttc",
    "Arial Unicode.ttf",
    "YuGothB.ttc",
    "msyhbd.ttc",
    "malgunbd.ttf",
    # Broad coverage of other scripts on Linux
    "NotoSans-Bold.ttf",
)
# A Supplementary Private Use Area code point that fonts leave unmapped. Drawing it shows the
# font's missing-glyph (.notdef) shape, which each label character is compared against.
UNMAPPED_CHARACTER = "\U0010fffd"
# Combining marks and invisible format characters have no stand-alone shape to check.
SHAPELESS_CATEGORIES = ("Mn", "Mc", "Me", "Cf")
# Right-to-left letters and combining marks need libraqm text layout to render correctly.
RIGHT_TO_LEFT_CLASSES = ("R", "AL")
COMBINING_CATEGORIES = ("Mn", "Mc", "Me")


class CompositionError(Exception):
    """A problem to report to the caller with a specific exit code."""

    def __init__(self, message: str, exit_code: int) -> None:
        super().__init__(message)
        self.exit_code = exit_code


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compose a labeled side-by-side before-and-after comparison image."
    )
    parser.add_argument("before", type=Path, help="original (Before) image")
    parser.add_argument("after", type=Path, help="edited (After) image")
    parser.add_argument(
        "output", type=Path, help="comparison image to write (.png, .jpg, .jpeg, or .webp)"
    )
    parser.add_argument(
        "--layout",
        choices=("horizontal", "vertical"),
        default="horizontal",
        help="horizontal: side by side (default); vertical: Before stacked above After",
    )
    parser.add_argument(
        "--before-label", default="Before", help='label for the original (default: "Before")'
    )
    parser.add_argument(
        "--after-label", default="After", help='label for the edit (default: "After")'
    )
    parser.add_argument("--no-labels", action="store_true", help="omit the label strips")
    parser.add_argument(
        "--max-edge",
        type=int,
        default=DEFAULT_MAX_EDGE,
        help=f"cap in pixels for the shared panel edge (default: {DEFAULT_MAX_EDGE})",
    )
    parser.add_argument(
        "--background",
        default="#FFFFFF",
        help="canvas color as a CSS color name or hex value (default: #FFFFFF)",
    )
    parser.add_argument(
        "--overwrite", action="store_true", help="replace OUTPUT if it already exists"
    )
    args = parser.parse_args(argv)
    if args.max_edge < MIN_MAX_EDGE:
        parser.error(f"--max-edge must be at least {MIN_MAX_EDGE}")
    return args


def import_pillow() -> SimpleNamespace | None:
    """Return the Pillow modules this script uses, or None when Pillow isn't installed."""
    try:
        from PIL import (
            Image,
            ImageChops,
            ImageColor,
            ImageDraw,
            ImageFont,
            ImageOps,
            features,
        )
    except ImportError:
        return None
    try:
        from PIL import ImageCms
    except ImportError:
        # Pillow built without LittleCMS: images are used without color-profile conversion.
        ImageCms = None
    return SimpleNamespace(
        Image=Image,
        ImageChops=ImageChops,
        ImageCms=ImageCms,
        ImageColor=ImageColor,
        ImageDraw=ImageDraw,
        ImageFont=ImageFont,
        ImageOps=ImageOps,
        has_raqm=features.check("raqm"),
        # Pillow 9.1 moved the resampling filters into Image.Resampling.
        resampling=getattr(Image, "Resampling", Image),
    )


def check_paths(args: argparse.Namespace) -> tuple[Path, Path, Path]:
    before = args.before.expanduser()
    after = args.after.expanduser()
    output = args.output.expanduser()
    for role, path in (("Before", before), ("After", after)):
        if not path.is_file():
            raise CompositionError(f"{role} image not found: {path}", EXIT_IMAGE_ERROR)
    if before.resolve() == after.resolve():
        raise CompositionError(
            "Before and After are the same file; provide the edited version as After.",
            EXIT_USAGE,
        )
    if output.suffix.lower() not in OUTPUT_FORMATS:
        raise CompositionError(
            f"Unsupported output type '{output.suffix or '(none)'}'; "
            "use .png, .jpg, .jpeg, or .webp.",
            EXIT_USAGE,
        )
    if output.resolve() in (before.resolve(), after.resolve()):
        raise CompositionError(
            "Refusing to overwrite an input image; choose another output path.", EXIT_USAGE
        )
    if output.exists() and not args.overwrite:
        raise CompositionError(
            f"Output already exists: {output}. Choose an unused name or pass --overwrite.",
            EXIT_USAGE,
        )
    return before, after, output


def parse_color(value: str, pil: SimpleNamespace) -> tuple[int, int, int]:
    try:
        return tuple(pil.ImageColor.getrgb(value)[:3])
    except ValueError as exc:
        raise CompositionError(f"Unsupported --background color '{value}'.", EXIT_USAGE) from exc


def load_image(path: Path, role: str, pil: SimpleNamespace):
    """Open an image upright, preserving its samples until both inputs have been read."""
    try:
        with pil.Image.open(path) as source:
            image = pil.ImageOps.exif_transpose(source)
    except (OSError, SyntaxError, ValueError, pil.Image.DecompressionBombError) as exc:
        raise CompositionError(
            f"Could not read the {role} image '{path}': {exc}", EXIT_IMAGE_ERROR
        ) from exc
    return image


def to_srgb(image, role: str, pil: SimpleNamespace, sample_range: tuple[int, int]):
    """8-bit RGB (or RGBA, if transparent) copy, converted to sRGB when a profile is embedded."""
    alpha = extract_alpha(image, role, pil)
    if image.mode in INTEGER_GRAY_MODES:
        image = to_8bit_gray(image, sample_range)
    icc_profile = image.info.get("icc_profile")
    rgb = None
    if icc_profile and pil.ImageCms is not None:
        if image.mode in ("RGB", "L", "CMYK"):
            source = image
        elif image.mode == "LA":
            source = image.convert("L")
        else:
            source = image.convert("RGB")
        try:
            rgb = pil.ImageCms.profileToProfile(
                source,
                pil.ImageCms.ImageCmsProfile(io.BytesIO(icc_profile)),
                pil.ImageCms.createProfile("sRGB"),
                outputMode="RGB",
            )
        except (pil.ImageCms.PyCMSError, OSError, ValueError) as exc:
            print(
                f"warning: ignored the {role} image's embedded color profile ({exc}); "
                "its colors may look slightly different",
                file=sys.stderr,
            )
    if rgb is None:
        rgb = image.convert("RGB")
    if alpha is not None:
        rgb.putalpha(alpha)
    return rgb


def extract_alpha(image, role: str, pil: SimpleNamespace):
    """Return the transparency mask from an alpha channel or a transparency key, or None."""
    key = image.info.get("transparency")
    if image.mode in INTEGER_GRAY_MODES:
        if key is None:
            return None
        try:
            return gray_key_mask(image, int(key), pil)
        except (TypeError, ValueError) as exc:
            print(
                f"warning: ignored the {role} image's transparency key ({exc}); "
                "its transparent areas show as opaque",
                file=sys.stderr,
            )
            return None
    if image.mode in ("RGBA", "LA", "PA") or key is not None:
        # Converting applies a palette, RGB, or 8-bit grayscale transparency key as alpha.
        return image.convert("RGBA").getchannel("A")
    return None


def gray_key_mask(image, key: int, pil: SimpleNamespace):
    """Alpha mask for an integer-grayscale transparency key, which Pillow doesn't apply itself."""
    samples = image.convert("I")
    # Clipping to 8 bits keeps zero distinct from every nonzero difference. Pillow only accepts
    # point() expressions of the form value * a + b on integer images, hence "+ -key".
    above = samples.point(lambda value: value + -key).convert("L")
    below = samples.point(lambda value: value * -1 + key).convert("L")
    return pil.ImageChops.lighter(above, below).point(lambda value: 255 if value else 0)


def integer_gray_range(before, after) -> tuple[int, int]:
    """Keep the 16-bit full scale, extending it once to cover both integer inputs."""
    minimum, maximum = 0, SIXTEEN_BIT_MAX
    for image in (before, after):
        if image.mode in INTEGER_GRAY_MODES:
            low, high = image.convert("I").getextrema()
            minimum = min(minimum, low)
            maximum = max(maximum, high)
    return minimum, maximum


def to_8bit_gray(image, sample_range: tuple[int, int]):
    """Map integer grayscale onto 0-255 using the pair's common sample range."""
    samples = image.convert("I")
    minimum, maximum = sample_range
    scale = 255 / (maximum - minimum)
    return samples.point(lambda value: value * scale + (-minimum * scale)).convert("L")


def scale_to(image, shared_edge: int, horizontal: bool, pil: SimpleNamespace):
    width, height = image.size
    if horizontal:
        size = (max(1, round(width * shared_edge / height)), shared_edge)
    else:
        size = (shared_edge, max(1, round(height * shared_edge / width)))
    if size == image.size:
        return image
    return image.resize(size, pil.resampling.LANCZOS)


def flatten(panel, pil: SimpleNamespace):
    """Place a transparent panel over a checkerboard so cut-out areas read as transparent."""
    if panel.mode != "RGBA":
        return panel
    if panel.getchannel("A").getextrema()[0] == 255:
        return panel.convert("RGB")  # alpha channel present but fully opaque
    width, height = panel.size
    columns = -(-width // CHECKER_PX)
    rows = -(-height // CHECKER_PX)
    pattern = pil.Image.new("RGB", (columns, rows), CHECKER_LIGHT)
    pixels = pattern.load()
    for y in range(rows):
        for x in range(y % 2, columns, 2):
            pixels[x, y] = CHECKER_DARK
    board = pattern.resize((columns * CHECKER_PX, rows * CHECKER_PX), pil.resampling.NEAREST)
    board = board.crop((0, 0, width, height))
    board.paste(panel, (0, 0), panel)
    return board


def load_font(size: int, text: str, pil: SimpleNamespace):
    """Return the first candidate font, at size, that can draw every character in text."""
    for name in FONT_CANDIDATES:
        try:
            font = pil.ImageFont.truetype(name, size)
        except OSError:
            continue  # this face isn't installed here; try the next one
        if not missing_characters(font, text, pil):
            return font
    try:
        font = pil.ImageFont.load_default(size=size)  # scalable built-in font (Pillow 10.1+)
    except TypeError:
        font = pil.ImageFont.load_default()  # older Pillow: small fixed-size bitmap font
    missing = missing_characters(font, text, pil)
    if missing:
        raise CompositionError(
            f"No installed font can draw these label characters: {' '.join(missing)}. "
            "Run again with --no-labels and say which side is which in your reply.",
            EXIT_LABEL_FONT,
        )
    return font


def missing_characters(font, text: str, pil: SimpleNamespace) -> list[str]:
    """Characters of text that font would draw as its missing-glyph box, or not at all."""
    try:
        missing_glyph = glyph_pixels(font, UNMAPPED_CHARACTER, pil)
    except UnicodeEncodeError:
        missing_glyph = None  # legacy bitmap font: Latin-1 only, checked per character below
    missing = []
    for char in dict.fromkeys(text):
        if char.isspace() or unicodedata.category(char) in SHAPELESS_CATEGORIES:
            continue
        try:
            pixels = glyph_pixels(font, char, pil)
        except UnicodeEncodeError:
            missing.append(char)
            continue
        if pixels == missing_glyph or not any(pixels[1]):
            missing.append(char)
    return missing


def glyph_pixels(font, char: str, pil: SimpleNamespace) -> tuple[tuple[int, int], bytes]:
    left, top, right, bottom = font.getbbox(char)
    image = pil.Image.new("L", (max(1, right - left), max(1, bottom - top)), 0)
    pil.ImageDraw.Draw(image).text((-left, -top), char, font=font, fill=255)
    return image.size, image.tobytes()


def needs_complex_layout(text: str) -> bool:
    return any(
        unicodedata.bidirectional(char) in RIGHT_TO_LEFT_CLASSES
        or unicodedata.category(char) in COMBINING_CATEGORIES
        for char in text
    )


def text_width(font, text: str) -> float:
    left, _, right, _ = font.getbbox(text)
    return right - left


def resized(font, size: int):
    """font at another size; a fixed-size bitmap font is returned unchanged."""
    return font.font_variant(size=size) if hasattr(font, "font_variant") else font


def split_word(word: str, font, max_width: float) -> list[str]:
    """Split a word wider than max_width into pieces that each fit."""
    if text_width(font, word) <= max_width:
        return [word]
    pieces = [""]
    for char in word:
        if pieces[-1] and text_width(font, pieces[-1] + char) > max_width:
            pieces.append(char)
        else:
            pieces[-1] += char
    return pieces


def wrap_text(text: str, font, max_width: float) -> list[str]:
    """Break text into lines no wider than max_width: at spaces, or inside a too-wide word."""
    lines: list[str] = []
    for word in text.split():
        joiner = " "
        for piece in split_word(word, font, max_width):
            if lines and text_width(font, lines[-1] + joiner + piece) <= max_width:
                lines[-1] += joiner + piece
            else:
                lines.append(piece)
            joiner = ""  # later pieces of a split word continue it without a space
    return lines


def fit_label(text: str, font, max_width: float) -> tuple[object, list[str]]:
    """Return a font and lines that fit max_width: shrink first, then wrap.

    A long label shrinks down to MIN_LABEL_TEXT_PX, then wraps. If a single character is still
    too wide (a very narrow image), the text shrinks further so nothing spills past its panel.
    """
    scalable = hasattr(font, "font_variant")
    width = text_width(font, text)
    if width > max_width and scalable:
        font = resized(font, max(MIN_LABEL_TEXT_PX, int(font.size * max_width / width)))
    lines = wrap_text(text, font, max_width)
    widest = max((text_width(font, line) for line in lines), default=0)
    if widest > max_width and scalable:
        font = resized(font, max(1, int(font.size * max_width / widest)))
    return font, lines


def line_spacing(font) -> int:
    return max(1, round(getattr(font, "size", MIN_LABEL_TEXT_PX) * LABEL_LINE_SPACING_RATIO))


def layout_labels(labels: list[str], panels, shared_edge: int, pil: SimpleNamespace):
    """Fit each label to its panel's width; return the strip height and (font, text, spacing)s."""
    if not pil.has_raqm and any(needs_complex_layout(text) for text in labels):
        raise CompositionError(
            "The labels use right-to-left text or combining marks, which this Pillow build "
            "can't lay out (it lacks libraqm). Run again with --no-labels and say which side "
            "is which in your reply.",
            EXIT_LABEL_FONT,
        )
    base_band = max(MIN_LABEL_BAND_PX, round(shared_edge * LABEL_BAND_RATIO))
    padding = round(base_band * (1 - LABEL_TEXT_RATIO) / 2)
    font = load_font(
        max(MIN_LABEL_TEXT_PX, round(base_band * LABEL_TEXT_RATIO)), "".join(labels), pil
    )
    measure = pil.ImageDraw.Draw(pil.Image.new("L", (1, 1)))
    band = base_band
    layouts = []
    for text, panel in zip(labels, panels):
        fitted, lines = fit_label(text, font, panel.width * LABEL_MAX_WIDTH_RATIO)
        block = "\n".join(lines)
        spacing = line_spacing(fitted)
        if block:
            _, top, _, bottom = measure.multiline_textbbox(
                (0, 0), block, font=fitted, spacing=spacing, align="center"
            )
            band = max(band, bottom - top + 2 * padding)
        layouts.append((fitted, block, spacing))
    return band, layouts


def label_color(background: tuple[int, int, int]) -> tuple[int, int, int]:
    red, green, blue = background
    luminance = 0.299 * red + 0.587 * green + 0.114 * blue
    return DARK_TEXT if luminance > LIGHT_BACKGROUND_LUMINANCE else LIGHT_TEXT


def draw_label(draw, layout, box: tuple[int, int, int, int], color) -> None:
    """Center a fitted, possibly multi-line label inside box (left, top, width, height)."""
    font, text, spacing = layout
    if not text:
        return
    left, top, width, height = box
    bbox = draw.multiline_textbbox((0, 0), text, font=font, spacing=spacing, align="center")
    x = left + (width - (bbox[2] - bbox[0])) / 2 - bbox[0]
    y = top + (height - (bbox[3] - bbox[1])) / 2 - bbox[1]
    draw.multiline_text((x, y), text, font=font, fill=color, spacing=spacing, align="center")


def compose(before, after, args: argparse.Namespace, background, pil: SimpleNamespace):
    horizontal = args.layout == "horizontal"
    if horizontal:
        shared_edge = min(before.height, after.height, args.max_edge)
    else:
        shared_edge = min(before.width, after.width, args.max_edge)
    panels = [
        flatten(scale_to(image, shared_edge, horizontal, pil), pil) for image in (before, after)
    ]
    first, second = panels
    labels = (
        []
        if args.no_labels
        else [unicodedata.normalize("NFC", text) for text in (args.before_label, args.after_label)]
    )
    gap = max(MIN_GAP_PX, round(shared_edge * GAP_RATIO))
    try:
        band, layouts = layout_labels(labels, panels, shared_edge, pil) if labels else (0, [])
        if horizontal:
            size = (3 * gap + first.width + second.width, 2 * gap + band + shared_edge)
            origins = [(gap, gap + band), (2 * gap + first.width, gap + band)]
        else:
            size = (2 * gap + shared_edge, 3 * gap + 2 * band + first.height + second.height)
            origins = [(gap, gap + band), (gap, 2 * gap + 2 * band + first.height)]
        canvas = pil.Image.new("RGB", size, background)
        for panel, origin in zip(panels, origins):
            canvas.paste(panel, origin)
        if layouts:
            draw = pil.ImageDraw.Draw(canvas)
            color = label_color(background)
            for layout, panel, (x, y) in zip(layouts, panels, origins):
                draw_label(draw, layout, (x, y - band, panel.width, band), color)
    except UnicodeEncodeError as exc:
        raise CompositionError(
            f"The label font can't encode the label text ({exc}). Run again with --no-labels "
            "and say which side is which in your reply.",
            EXIT_LABEL_FONT,
        ) from exc
    return canvas, labels


def save(canvas, output: Path) -> None:
    file_format = OUTPUT_FORMATS[output.suffix.lower()]
    options = {} if file_format == "PNG" else {"quality": LOSSY_QUALITY}
    try:
        output.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(output, file_format, **options)
    except KeyError as exc:
        raise CompositionError(
            f"This Pillow build can't write {file_format} files; use a .png output instead.",
            EXIT_USAGE,
        ) from exc
    except OSError as exc:
        raise CompositionError(f"Could not write '{output}': {exc}", EXIT_IMAGE_ERROR) from exc


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    pil = import_pillow()
    if pil is None:
        print(
            "error: Pillow is not installed, so the comparison image can't be built here. "
            "Nothing was installed; present the two images as labeled links instead.",
            file=sys.stderr,
        )
        return EXIT_PILLOW_MISSING
    try:
        before_path, after_path, output = check_paths(args)
        background = parse_color(args.background, pil)
        before = load_image(before_path, "Before", pil)
        after = load_image(after_path, "After", pil)
        sample_range = integer_gray_range(before, after)
        before = to_srgb(before, "Before", pil, sample_range)
        after = to_srgb(after, "After", pil, sample_range)
        canvas, labels = compose(before, after, args, background, pil)
        save(canvas, output)
    except CompositionError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return exc.exit_code
    summary = {
        "output": str(output.resolve()),
        "width": canvas.width,
        "height": canvas.height,
        "layout": args.layout,
        "labels": labels,
    }
    print(json.dumps(summary))
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
