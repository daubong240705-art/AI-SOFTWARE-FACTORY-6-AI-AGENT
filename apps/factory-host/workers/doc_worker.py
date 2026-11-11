"""One-shot, offline document extraction. The caller supplies the OS sandbox."""
import contextlib
import io
import json
import os
import re
import socket
import sys
import zipfile

MAX_TEXT = 2_000_000
TYPES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
}
PLAIN = {"text/plain", "text/markdown", "text/csv", "application/json"}


def offline(*_args, **_kwargs):
    raise OSError("offline")


def headings(text):
    result, offset, fence = [], 0, None
    for line in text.splitlines(keepends=True):
        match = re.match(r"^\s{0,3}(`{3,}|~{3,})", line)
        if match:
            token = match[1]
            if fence is None:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence) and not line[match.end():].strip():
                fence = None
        elif fence is None:
            match = re.match(r"^(#{1,6})\s+(.+?)\s*#*\s*$", line)
            if match:
                result.append({"level": len(match[1]), "title": match[2][:200], "page": None, "offset": offset})
        offset += len(line)
    return result[:500]


def pdf_extract(path, warnings):
    import pdfplumber
    from pdfminer.pdftypes import resolve1
    with pdfplumber.open(path) as pdf:
        count, chunks, outline, offsets, size = len(pdf.pages), [], [], [], 0
        if count > 500:
            warnings.append("truncated-pages")
        for number, page in enumerate(pdf.pages[:500], 1):
            marker = ("\n\n" if chunks else "") + f"<!-- page {number} -->\n\n"
            offsets.append(size + (2 if chunks else 0))
            chunk = marker + (page.extract_text() or "")
            outline.append({"level": 2, "title": f"Trang {number}", "page": number, "offset": offsets[-1]})
            chunks.append(chunk[:max(0, MAX_TEXT + 1 - size)])
            size += len(chunk)
            if size > MAX_TEXT:
                break
        try:
            page_ids = {p.page_obj.pageid: i + 1 for i, p in enumerate(pdf.pages[:len(offsets)])}
            for level, title, dest, action, _se in pdf.doc.get_outlines():
                if len(outline) >= 500:
                    break
                destination = resolve1(dest or resolve1(action).get("D"))
                if isinstance(destination, (str, bytes)):
                    destination = resolve1(pdf.doc.get_dest(destination))
                if isinstance(destination, dict):
                    destination = resolve1(destination.get("D"))
                page = page_ids.get(destination[0].objid)
                if page:
                    outline.append({"level": min(6, max(1, level)), "title": str(title)[:200], "page": page, "offset": offsets[page - 1]})
        except Exception:
            pass  # Bookmarks are optional and can be malformed independently of the pages.
        info = pdf.metadata or {}
        return "".join(chunks), count, outline, {"title": info.get("Title"), "author": info.get("Author"), "language": None}


def extract(path, media):
    if os.path.getsize(path) > 30 * 1024 * 1024:
        return {"error": "too-large"}
    warnings, pages = [], None
    metadata = {"title": None, "author": None, "language": None}
    if media == "application/pdf":
        markdown, pages, outline, metadata = pdf_extract(path, warnings)
    elif media in PLAIN:
        with open(path, encoding="utf-8-sig") as source:
            markdown = source.read(MAX_TEXT + 1)
        outline = headings(markdown)
    elif media in TYPES:
        # Bound ZIP expansion before any Office parser touches it.
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            if len(entries) > 10000 or sum(e.file_size for e in entries) > 256 * 1024 * 1024:
                return {"error": "too-large"}
            if any(e.flag_bits & 1 for e in entries):
                return {"error": "encrypted"}
        from markitdown import MarkItDown
        markdown = MarkItDown(enable_plugins=False).convert(path).text_content
        outline = headings(markdown[:MAX_TEXT])
        if TYPES[media] == ".pptx":
            slides = list(re.finditer(r"<!-- Slide number: (\d+) -->", markdown))
            pages = len(slides)
            outline = [{"level": 2, "title": f"Slide {m[1]}", "page": int(m[1]), "offset": m.start()} for m in slides[:500]]
    else:
        return {"error": "unsupported"}
    encoded = markdown.encode("utf-16-le")
    if len(encoded) // 2 > MAX_TEXT:
        warnings.append("truncated-text")
        markdown = encoded[:MAX_TEXT * 2].decode("utf-16-le", errors="ignore")
    outline = [o for o in outline if o["offset"] < len(markdown)]
    for entry in outline:
        # JavaScript readers address UTF-16 code units.
        entry["offset"] = len(markdown[:entry["offset"]].encode("utf-16-le")) // 2
    metadata = {k: (str(v)[:200] if v is not None else None) for k, v in metadata.items()}
    return {"markdown": markdown, "pages": pages, "outline": outline,
            "metadata": metadata, "warnings": warnings}


def main():
    for key in ("http_proxy", "https_proxy", "all_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
        os.environ.pop(key, None)
    socket.socket.connect = offline
    socket.socket.connect_ex = offline
    socket.socket.sendto = offline
    socket.create_connection = offline
    socket.getaddrinfo = offline
    try:
        # Converters and native libraries must never pollute the JSON protocol.
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = extract(sys.argv[1], sys.argv[2]) if len(sys.argv) == 3 else {"error": "unsupported"}
    except Exception as error:
        name = type(error).__name__.lower()
        code = "encrypted" if "password" in name or "encrypt" in name else "corrupt" if any(
            part in name for part in ("pdf", "zip", "syntax", "decode", "xml", "invalid", "conversion")) else "failed"
        result = {"error": code}
    print(json.dumps(result, ensure_ascii=True))
    return 1 if "error" in result else 0


if __name__ == "__main__":
    sys.exit(main())
