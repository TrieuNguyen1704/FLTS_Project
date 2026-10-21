"""PB15–PB18: bounded extraction, cleaning and fixed-word chunking.

No model, vector store or network request is performed by this module.
"""

from __future__ import annotations

import hashlib
import re
import subprocess
import tempfile
import unicodedata
from collections import deque
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any, BinaryIO, Iterable, Iterator
from zipfile import ZipFile

from docx import Document
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph
from pypdf import PdfReader

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_TEXT_CHARS = 2_000_000
MAX_DOCX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024


class PipelineError(Exception):
    def __init__(self, code: str, message: str, stage: str,
                 status_code: int = 422) -> None:
        super().__init__(message)
        self.code = code
        self.stage = stage
        self.status_code = status_code


@dataclass(frozen=True)
class TextUnit:
    text: str
    page_number: int | None = None
    source_locator: str | None = None


@dataclass
class ExtractedDocument:
    text: str
    page_count: int | None
    metadata: dict[str, Any]


def clean_text(value: str) -> str:
    """Preserve Vietnamese accents/math; remove controls and redact emails."""
    value = unicodedata.normalize('NFKC', value)
    value = value.replace('\r\n', '\n').replace('\r', '\n')
    value = ''.join(
        char for char in value
        if char in '\n\t' or not unicodedata.category(char).startswith('C')
    ).replace('\ufffd', '')
    value = re.sub(
        r'(?i)(?<![\w.+-])[\w.!#$%&\x27*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+',
        '[redacted-email]', value,
    )
    value = re.sub(r'[^\S\n]+', ' ', value)
    value = re.sub(r' *\n *', '\n', value)
    return re.sub(r'\n{3,}', '\n\n', value).strip()


def _error(code: str, message: str) -> PipelineError:
    return PipelineError(code, message, 'extracting')


def _extract_units(source: BinaryIO, extension: str,
                   max_pages: int | None) -> Iterator[TextUnit]:
    if extension == 'pdf':
        try:
            reader = PdfReader(source)
            if reader.is_encrypted:
                raise _error('PDF_ENCRYPTED', 'Password-protected PDFs are not supported.')
            limit = len(reader.pages)
            if max_pages is not None:
                limit = min(limit, max_pages)
            for index in range(limit):
                yield TextUnit(reader.pages[index].extract_text() or '', index + 1,
                               f'page {index + 1}')
        except PipelineError:
            raise
        except Exception as exc:  # Parser exceptions vary with PDF structure.
            raise _error('PDF_EXTRACTION_FAILED', 'The PDF could not be read.') from exc
    elif extension == 'docx':
        try:
            # DOCX is a ZIP; reject decompression bombs before python-docx loads XML.
            with ZipFile(source) as archive:
                if sum(item.file_size for item in archive.infolist()) > MAX_DOCX_UNCOMPRESSED_BYTES:
                    raise _error('DOCX_TOO_LARGE', 'Expanded DOCX exceeds the safe limit.')
            source.seek(0)
            document = Document(source)
            paragraph_index = table_index = 0
            # Walk XML in source order instead of moving all tables to the end.
            for element in document.element.body:
                if element.tag == qn('w:p'):
                    paragraph_index += 1
                    yield TextUnit(Paragraph(element, document).text,
                                   source_locator=f'paragraph {paragraph_index}')
                elif element.tag == qn('w:tbl'):
                    table_index += 1
                    table = Table(element, document)
                    for row_index, row in enumerate(table.rows, 1):
                        cells = [cell.text for cell in row.cells]
                        if any(cell.strip() for cell in cells):
                            yield TextUnit(' | '.join(cells),
                                           source_locator=f'table {table_index} row {row_index}')
        except PipelineError:
            raise
        except Exception as exc:  # Includes malformed ZIP/XML and invalid OOXML packages.
            raise _error('DOCX_EXTRACTION_FAILED', 'The DOCX could not be read.') from exc
    else:
        # Close the file before antiword opens it: required on Windows.
        with tempfile.TemporaryDirectory(prefix='flts-doc-') as directory:
            path = Path(directory) / 'input.doc'
            with path.open('wb') as target:
                while block := source.read(64 * 1024):
                    target.write(block)
            try:
                # Spool stdout to disk, not capture_output (unbounded RAM).
                with tempfile.TemporaryFile() as output:
                    result = subprocess.run(
                        ['antiword', '-m', 'UTF-8.txt', str(path)],
                        stdout=output, stderr=subprocess.DEVNULL,
                        timeout=30, check=False, shell=False,
                    )
                    if result.returncode != 0:
                        raise _error('DOC_EXTRACTION_FAILED', 'Antiword could not read the DOC.')
                    if output.tell() > MAX_TEXT_CHARS * 4:
                        raise _error('TEXT_TOO_LARGE', 'Extracted text exceeds the safe limit.')
                    output.seek(0)
                    text = output.read().decode('utf-8', errors='replace')
                    for index, page in enumerate(text.split('\f'), 1):
                        # Antiword page breaks are logical, not reliable rendered pages.
                        yield TextUnit(page, source_locator=f'doc segment {index}')
            except FileNotFoundError as exc:
                raise PipelineError('DOC_PARSER_UNAVAILABLE', 'Install antiword to read DOC.',
                                    'extracting', 503) from exc
            except subprocess.TimeoutExpired as exc:
                raise _error('DOC_EXTRACTION_TIMEOUT', 'Antiword exceeded 30 seconds.') from exc
            except OSError as exc:
                raise _error('DOC_EXTRACTION_FAILED', 'Antiword could not be executed.') from exc


def _bounded_units(source: BinaryIO, extension: str,
                   max_pages: int | None) -> Iterator[TextUnit]:
    extension = extension.lower().lstrip('.')
    if extension not in {'pdf', 'docx', 'doc'}:
        raise _error('UNSUPPORTED_FILE_TYPE', 'Only PDF, DOCX and DOC are supported.')
    if max_pages is not None and max_pages <= 0:
        raise ValueError('max_pages must be positive or None')
    total = 0
    found_text = False
    for unit in _extract_units(source, extension, max_pages):
        cleaned = clean_text(unit.text)
        total += len(cleaned)
        if total > MAX_TEXT_CHARS:
            raise _error('TEXT_TOO_LARGE', 'Extracted text exceeds the safe limit.')
        found_text = found_text or bool(cleaned)
        yield TextUnit(cleaned, unit.page_number, unit.source_locator)
    if not found_text:
        raise _error('NO_EXTRACTABLE_TEXT', 'No text found; scanned PDFs require OCR (out of scope).')


def iter_document_units(path: str | Path,
                        max_pages: int | None = None) -> Iterator[TextUnit]:
    """Preferred worker interface: open from disk and yield one source unit at a time."""
    path = Path(path)
    if path.stat().st_size > MAX_FILE_BYTES:
        raise _error('FILE_TOO_LARGE', 'File exceeds the Sprint 2 limit of 10 MiB.')
    with path.open('rb') as source:
        yield from _bounded_units(source, path.suffix, max_pages)


def extract_document(content: bytes, extension: str,
                     max_pages: int | None = None) -> ExtractedDocument:
    """FLTS-compatible small-upload adapter; prefer the iterator for queued files."""
    if len(content) > MAX_FILE_BYTES:
        raise _error('FILE_TOO_LARGE', 'File exceeds the Sprint 2 limit of 10 MiB.')
    units = list(_bounded_units(BytesIO(content), extension, max_pages))
    extension = extension.lower().lstrip('.')
    text_parts = []
    for unit in units:
        if unit.text:
            label = unit.source_locator.title() if unit.source_locator else None
            text_parts.append(f'[{label}]\n{unit.text}' if label else unit.text)
    page_count = max((unit.page_number or 0 for unit in units), default=0) or None
    return ExtractedDocument('\n\n'.join(text_parts), page_count, {
        'parser': {'pdf': 'pypdf', 'docx': 'python-docx', 'doc': 'antiword'}[extension],
        'extracted_pages': page_count,
        'page_number_kind': 'physical' if extension == 'pdf' else 'unavailable',
    })


def iter_chunks(units: Iterable[TextUnit], target_words: int = 500,
                overlap_words: int = 50) -> Iterator[dict[str, Any]]:
    """Keep only a word window; carry page provenance through the overlap."""
    if target_words <= 0 or not 0 <= overlap_words < target_words:
        raise ValueError('Require target_words > 0 and 0 <= overlap_words < target_words')
    window: deque[tuple[str, int | None, str | None]] = deque()
    chunk_index = 0
    new_words = 0

    def build_chunk() -> dict[str, Any]:
        content = ' '.join(item[0] for item in window)
        pages = list(dict.fromkeys(item[1] for item in window if item[1] is not None))
        locators = list(dict.fromkeys(item[2] for item in window if item[2]))
        return {
            'chunk_index': chunk_index, 'content': content,
            'word_count': len(window), 'token_estimate': max(1, round(len(window) * 1.3)),
            # MD5 is a content fingerprint, never a security/authentication hash.
            'content_hash': hashlib.md5(content.encode('utf-8'), usedforsecurity=False).hexdigest(),
            'hash_algorithm': 'md5', 'page_number': pages[0] if pages else None,
            'page_numbers': pages, 'source_locator': locators[0] if locators else None,
            'source_locators': locators,
        }

    for unit in units:
        for match in re.finditer(r'\S+', clean_text(unit.text)):
            window.append((match.group(), unit.page_number, unit.source_locator))
            new_words += 1
            if len(window) == target_words:
                yield build_chunk()
                chunk_index += 1
                for _ in range(target_words - overlap_words):
                    window.popleft()
                new_words = 0
    # Do not emit an extra chunk containing only the previous overlap.
    if new_words:
        yield build_chunk()


def chunk_text(text: str, target_words: int = 500,
               overlap_words: int = 50) -> list[dict[str, Any]]:
    """Compatibility adapter for FLTS text with [Page N] source markers."""
    def units() -> Iterator[TextUnit]:
        locator: str | None = None
        page: int | None = None
        for part in re.split(r'(\[(?:Page|Paragraph|Table|Doc Segment) \d+(?: Row \d+)?\])', text,
                             flags=re.IGNORECASE):
            marker = re.fullmatch(r'\[([^\]]+)\]', part)
            if marker:
                locator = marker.group(1).lower()
                page = int(locator.split()[1]) if locator.startswith('page ') else None
            elif part.strip():
                yield TextUnit(part, page, locator)
    return list(iter_chunks(units(), target_words, overlap_words))
