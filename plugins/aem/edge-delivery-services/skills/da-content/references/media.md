# Media: storage, formats, limits

Conventions for binaries in DA / Experience Workspace. Carried over from the
previous reference without a fresh live check, except where marked
**checked**. Authoring and upload rules are in `../SKILL.md`.

## Where binaries live

DA accepts any file under `{org}/{repo}/<path>` and serves it at
`https://content.da.live/{org}/{repo}/<path>`. Three patterns:

| Pattern | Path | Use |
|---|---|---|
| Dot-folder (editor drag and drop) | `/{parent}/.{docname}/<file>` | One author, one document. Copies are not shared between documents |
| `/media` folder | `/media/<any depth>/<file>`, created on first PUT | Shared assets, scripted or migration uploads, survives document renames. Branch-independent |
| AEM Assets DAM | AEMaaCS URLs | Governed assets; not written by the DA source API |

Reference an uploaded image with its absolute `content.da.live` URL.
Relative paths never work (they resolve against the editor URL).
Re-uploading a changed PNG/JPG needs a new preview of the pages using it.

## What gets delivered

DA stores any type; the pipeline delivers only:

- Media Bus (hashed, responsive variants, permanent cache): PNG, JPG, AVIF,
  WEBP, MP4. GIF goes through it without variants.
- Content Bus (original bytes, updated by preview/publish): SVG, PDF, JSON,
  ICO, WOFF2, HTML.

OTF, TTF, WOFF, ZIP, MP3, AVI and MOV are not delivered; use WOFF2, the code
repo or external hosting. The detected type must match the extension (a
WEBP renamed `.png` does not deliver). Send the matching `Content-Type` on
the multipart part.

The DA editor refuses WEBP, but the source API accepts it and the pipeline
delivers it with variants.

## Limits

| Type | Cap |
|---|---|
| PNG, JPG, AVIF, WEBP, PDF | 20 MB |
| MP4 | 36 MB |
| ICO | 16 KB |
| SVG | **40 KB** (**checked**: standalone preview returns 409 `AEM_BACKEND_SVG_TOO_BIG`; a page referencing an over-cap SVG was previously seen failing with 409 `AEM_BACKEND_FETCH_FAILED` "Images N have failed validation") |

The SVG cap applies to SVGs the preview fetches for `<img>`. SVGs served from
the code repo (`/icons/`) have no cap. To fit: run SVGO, reduce coordinate
precision, replace embedded rasters, or rasterize. Check `content-length` of
every referenced SVG before previewing.

Sources are never upscaled; upload at the largest size you need (about
2000 px wide, 2400 for a retina 1200 px hero).
