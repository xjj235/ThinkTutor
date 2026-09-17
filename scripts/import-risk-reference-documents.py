"""Import the five explicitly supplied DOCX archives as inert reference data."""

import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import zipfile
import xml.etree.ElementTree as ET


TOPICS = [
    ("exchange-rate-risk", "汇率风险", ["exchange rate risk", "foreign exchange risk", "汇率"]),
    ("economic-cycle-risk", "经济周期风险", ["business cycle risk", "economic cycle risk", "经济周期"]),
    ("interest-rate-risk", "利率风险", ["interest rate risk", "利率"]),
    ("inflation-risk", "通货膨胀风险", ["inflation risk", "通胀", "通货膨胀"]),
    ("policy-risk", "政策风险", ["policy risk", "政策变化", "政策调整"]),
]
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "knowledge/courses/financial-risk-management/reference-library"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def paragraph_text(element):
    return "".join(
        node.text or "" if node.tag == W + "t" else "\t" if node.tag == W + "tab" else "\n"
        for node in element.iter()
        if node.tag in {W + "t", W + "tab", W + "br", W + "cr"}
    ).strip()


def read_blocks(data):
    with zipfile.ZipFile(io.BytesIO(data)) as document:
        if sum(item.file_size for item in document.infolist()) > 20_000_000:
            raise ValueError("DOCX expanded size exceeds limit")
        if document.testzip():
            raise ValueError("Corrupt DOCX")
        xml = document.read("word/document.xml")
        if b"<!DOCTYPE" in xml or b"<!ENTITY" in xml:
            raise ValueError("XML entities are not allowed")
        body = ET.fromstring(xml).find(W + "body")
        if body is None:
            raise ValueError("Missing document body")
        blocks = []
        section = "正文"
        paragraph_index = 0
        table_index = 0
        for element in body:
            if element.tag == W + "p":
                paragraph_index += 1
                text = paragraph_text(element)
                if not text:
                    continue
                style = element.find(W + "pPr/" + W + "pStyle")
                if style is not None and style.get(W + "val", "").lower().startswith(("heading", "标题")):
                    section = text
                blocks.append({"locator": f"paragraph:{paragraph_index}", "section": section, "text": text})
            elif element.tag == W + "tbl":
                table_index += 1
                for row_index, row in enumerate(element.findall(W + "tr"), 1):
                    cells = ["\n".join(filter(None, (paragraph_text(p) for p in cell.iter(W + "p")))) for cell in row.findall(W + "tc")]
                    if any(cells):
                        blocks.append({"locator": f"table:{table_index}/row:{row_index}", "section": section, "text": " | ".join(cells)})
        if not blocks:
            raise ValueError("Empty document")
        return blocks


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    args = parser.parse_args()
    imported = []
    for slug, title, aliases in TOPICS:
        archive_name = f"{title}_8个文档_v1.2.1.zip"
        archive_data = (args.source_dir / archive_name).read_bytes()
        documents = []
        with zipfile.ZipFile(io.BytesIO(archive_data)) as archive:
            members = [item for item in archive.infolist() if not item.is_dir()]
            if len(members) != 8 or sum(item.file_size for item in members) > 80_000_000:
                raise ValueError(f"Unexpected archive contents: {archive_name}")
            if archive.testzip():
                raise ValueError(f"Corrupt archive: {archive_name}")
            for order, member in enumerate(sorted(members, key=lambda item: item.filename), 1):
                path = PurePosixPath(member.filename.replace("\\", "/"))
                if path.is_absolute() or ".." in path.parts or len(path.parts) != 1 or path.suffix.lower() != ".docx" or not path.name.startswith(f"{order:02}_"):
                    raise ValueError(f"Unexpected archive member: {member.filename}")
                data = archive.read(member)
                source_relative = f"sources/{slug}/{order:02}.docx"
                blocks = read_blocks(data)
                documents.append({
                    "id": f"{slug}-{order:02}", "order": order,
                    "title": Path(member.filename).stem, "fileName": member.filename,
                    "sourcePath": source_relative, "sha256": digest(data),
                    "textSha256": digest("\n".join(block["text"] for block in blocks).encode("utf-8")),
                    "blocks": blocks,
                })
                imported.append((DESTINATION / source_relative, data))
        topic = {
            "id": slug, "title": title, "aliases": aliases, "version": "1.2.1",
            "status": "reference", "instructionPolicy": "untrusted-reference-only",
            "archive": {"fileName": archive_name, "sha256": digest(archive_data)},
            "documents": documents,
        }
        imported.append((DESTINATION / f"{slug}.json", (json.dumps(topic, ensure_ascii=False, indent=2) + "\n").encode("utf-8")))
        print(f"{title}: {len(documents)} documents, {sum(len(d['blocks']) for d in documents)} blocks")
    # Validate every archive before creating files; never silently overwrite different data.
    for path, data in imported:
        if path.exists() and path.read_bytes() != data:
            raise FileExistsError(f"Refusing to overwrite changed import: {path}")
    for path, data in imported:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)


if __name__ == "__main__":
    main()
