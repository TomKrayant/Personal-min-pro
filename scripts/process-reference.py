"""Turn the supplied chibi tiger reference into transparent desktop-pet PNGs."""
from collections import deque
from pathlib import Path
import sys

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
    r"C:\Users\TomKrayant\.dsh\attachments\v1\objects\2f\2f5a70a60f0011cf5ab08baf55e350bcca9f1da6a6a36f3f9fc275bf5d6130d4"
)
ASSETS = ROOT / "linhu-pet" / "assets"


def is_background(pixel: tuple[int, int, int, int]) -> bool:
    r, g, b, _ = pixel
    return r >= 235 and g >= 235 and b >= 235 and max(r, g, b) - min(r, g, b) < 18


def remove_white_background(image: Image.Image) -> Image.Image:
    image = image.convert("RGBA")
    width, height = image.size
    pixels = image.load()
    background = [[False] * height for _ in range(width)]
    queue = deque()

    for x in range(width):
        for y in (0, height - 1):
            if is_background(pixels[x, y]) and not background[x][y]:
                background[x][y] = True
                queue.append((x, y))
    for y in range(height):
        for x in (0, width - 1):
            if is_background(pixels[x, y]) and not background[x][y]:
                background[x][y] = True
                queue.append((x, y))

    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height and not background[nx][ny] and is_background(pixels[nx, ny]):
                background[nx][ny] = True
                queue.append((nx, ny))

    alpha = Image.new("L", image.size, 255)
    alpha_pixels = alpha.load()
    for x in range(width):
        for y in range(height):
            if background[x][y]:
                alpha_pixels[x, y] = 0

    # Erode one pixel to remove the white anti-aliased fringe, then feather.
    alpha = alpha.filter(ImageFilter.MinFilter(5))
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.8))
    rgba = image.copy()
    rgba.putalpha(alpha)
    return rgba


def crop_and_resize(image: Image.Image, size: int, pad_ratio: float = 0.04) -> Image.Image:
    bbox = image.getbbox()
    if bbox is None:
        raise RuntimeError("reference image is empty after background removal")
    content = image.crop(bbox)
    width, height = content.size
    side = max(width, height)
    pad = max(1, int(side * pad_ratio))
    canvas = Image.new("RGBA", (side + pad * 2, side + pad * 2), (0, 0, 0, 0))
    canvas.alpha_composite(content, (pad + (side - width) // 2, pad + (side - height) // 2))
    canvas = canvas.resize((size, size), Image.Resampling.LANCZOS)
    return canvas.filter(ImageFilter.UnsharpMask(radius=1.1, percent=65, threshold=3))


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    source = Image.open(SRC)
    cutout = remove_white_background(source)
    pet = crop_and_resize(cutout, 384, 0.035)
    pet.save(ASSETS / "linhu.png", optimize=True)

    # Head-focused tray icon: use the top part of the transparent cutout.
    bbox = cutout.getbbox()
    assert bbox is not None
    left, top, right, bottom = bbox
    head_height = max(1, int((bottom - top) * 0.66))
    head = cutout.crop((left, top, right, top + head_height))
    head = crop_and_resize(head, 256, 0.035)
    head.save(ASSETS / "icon.png", optimize=True)
    head.resize((64, 64), Image.Resampling.LANCZOS).save(ASSETS / "tray.png", optimize=True)

    print("wrote", ASSETS / "linhu.png", pet.size)
    print("wrote", ASSETS / "icon.png", head.size)


if __name__ == "__main__":
    main()
