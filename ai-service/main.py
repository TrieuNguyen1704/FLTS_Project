from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import sqlite3
import threading
import time
from datetime import datetime, timezone
from typing import Annotated, Any, Callable, Literal

import chromadb
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from google import genai
from google.genai import types
from fsrs import Card as FsrsCard, Rating as FsrsRating, Scheduler as FsrsScheduler
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from rag_pipeline import PipelineError, attach_document_sections, chunk_text, extract_document

APP = FastAPI(title='FLTS AI Service', version='0.2.0')
# Keep the conventional ASGI export expected by the Docker uvicorn command.
app = APP
# Uvicorn configures this logger in the container, so provider failures are retained for operators without reaching browsers.
LOGGER = logging.getLogger('uvicorn.error')
COLLECTION_NAME = os.getenv('CHROMA_COLLECTION', 'flts_document_chunks')
STAGING_COLLECTION_NAME = os.getenv('CHROMA_STAGING_COLLECTION', f'{COLLECTION_NAME}_staging')
EMBEDDING_MODEL = os.getenv('GEMINI_EMBEDDING_MODEL', 'gemini-embedding-2')
GENERATION_MODEL = os.getenv('GEMINI_GENERATION_MODEL', 'gemini-3.5-flash-lite')
EMBEDDING_BATCH_SIZE = int(os.getenv('GEMINI_EMBEDDING_BATCH_SIZE', '40'))
EMBEDDING_MAX_RETRIES = int(os.getenv('GEMINI_EMBEDDING_MAX_RETRIES', '4'))
EMBEDDING_RETRY_BASE_SECONDS = float(os.getenv('GEMINI_EMBEDDING_RETRY_BASE_SECONDS', '5'))
EMBEDDING_RETRY_MAX_SECONDS = float(os.getenv('GEMINI_EMBEDDING_RETRY_MAX_SECONDS', '60'))
GENERATION_MAX_RETRIES = int(os.getenv('GEMINI_GENERATION_MAX_RETRIES', '3'))
GENERATION_RETRY_BASE_SECONDS = float(os.getenv('GEMINI_GENERATION_RETRY_BASE_SECONDS', '3'))
# Interactive retrieval/evidence must respond promptly. Long retries are reserved for the queue worker.
EMBEDDING_QUERY_MAX_RETRIES = int(os.getenv('GEMINI_QUERY_MAX_RETRIES', '1'))
# This process-local registry prevents a disconnected Laravel request and a manual retry from
# embedding the same document concurrently. The current deployment intentionally runs one AI worker.
DOCUMENT_PROCESSING_LOCK = threading.Lock()
ACTIVE_DOCUMENT_PROCESSING: dict[str, str] = {}
HIERARCHICAL_CACHE_PATH = os.getenv('AI_CACHE_PATH', '/data/hierarchical-cache.sqlite3')
HIERARCHICAL_PROMPT_VERSION = 'document-outline-v3'


@APP.exception_handler(PipelineError)
async def pipeline_error_handler(_, exc: PipelineError) -> JSONResponse:
    LOGGER.warning('RAG pipeline error code=%s stage=%s status=%s', exc.code, exc.stage, exc.status_code)
    return JSONResponse(status_code=exc.status_code, content={'detail': {'code': exc.code, 'message': str(exc), 'stage': exc.stage}})


def require_service_token(authorization: Annotated[str | None, Header()] = None) -> None:
    expected = os.getenv('AI_SERVICE_TOKEN', '')
    if not expected or authorization != f'Bearer {expected}':
        raise HTTPException(status_code=401, detail={'code': 'UNAUTHORIZED_SERVICE', 'message': 'A valid internal service token is required.', 'stage': 'authorization'})


def gemini_client() -> genai.Client:
    api_key = os.getenv('GEMINI_API_KEY', '')
    if not api_key:
        raise PipelineError('GEMINI_NOT_CONFIGURED', 'GEMINI_API_KEY is not configured for the local AI service.', 'embedding', 503)
    return genai.Client(api_key=api_key)


def chroma_collection():
    try:
        client = chromadb.HttpClient(host=os.getenv('CHROMA_HOST', 'chroma'), port=int(os.getenv('CHROMA_PORT', '8000')))
        return client.get_or_create_collection(name=COLLECTION_NAME, metadata={'hnsw:space': 'cosine'})
    except Exception as exc:
        raise PipelineError('VECTOR_STORE_UNAVAILABLE', 'ChromaDB is not available.', 'vectorizing', 503) from exc


def chroma_staging_collection():
    """Keep incomplete embedding batches outside the collection used by retrieval."""
    try:
        client = chromadb.HttpClient(host=os.getenv('CHROMA_HOST', 'chroma'), port=int(os.getenv('CHROMA_PORT', '8000')))
        return client.get_or_create_collection(name=STAGING_COLLECTION_NAME, metadata={'hnsw:space': 'cosine'})
    except Exception as exc:
        raise PipelineError('VECTOR_STORE_UNAVAILABLE', 'ChromaDB staging is not available.', 'vectorizing', 503) from exc


def extract_provider_retry_delay(err_str: str) -> float | None:
    match = re.search(r'retry in\s+([0-9.]+)\s*s', err_str, re.IGNORECASE)
    if match:
        try:
            return float(match.group(1)) + 2.0
        except ValueError:
            pass
    match_delay = re.search(r'retryDelay[\'":\s]+([0-9.]+)', err_str, re.IGNORECASE)
    if match_delay:
        try:
            return float(match_delay.group(1)) + 2.0
        except ValueError:
            pass
    return None


def embedding_retry_delay(err_str: str, failed_attempt: int) -> float:
    """Use exponential backoff, while never retrying earlier than Gemini recommends."""
    exponential_delay = EMBEDDING_RETRY_BASE_SECONDS * (2 ** max(0, failed_attempt - 1))
    provider_delay = extract_provider_retry_delay(err_str) or 0.0
    return min(EMBEDDING_RETRY_MAX_SECONDS, max(exponential_delay, provider_delay))


def acquire_document_processing(document_id: str, processing_run_id: str) -> bool:
    with DOCUMENT_PROCESSING_LOCK:
        if document_id in ACTIVE_DOCUMENT_PROCESSING:
            return False
        ACTIVE_DOCUMENT_PROCESSING[document_id] = processing_run_id
        return True


def release_document_processing(document_id: str, processing_run_id: str) -> None:
    with DOCUMENT_PROCESSING_LOCK:
        if ACTIVE_DOCUMENT_PROCESSING.get(document_id) == processing_run_id:
            ACTIVE_DOCUMENT_PROCESSING.pop(document_id, None)


def document_processing_status(document_id: str) -> dict[str, Any]:
    with DOCUMENT_PROCESSING_LOCK:
        active_run_id = ACTIVE_DOCUMENT_PROCESSING.get(document_id)
    return {
        'document_id': int(document_id),
        'active': active_run_id is not None,
        'processing_run_id': int(active_run_id) if active_run_id is not None else None,
    }


def is_rate_limited(exception: Exception) -> bool:
    message = str(exception)
    return 'RESOURCE_EXHAUSTED' in message or '429' in message


def is_provider_unavailable(exception: Exception) -> bool:
    message = str(exception)
    return any(marker in message for marker in ('503', 'UNAVAILABLE', 'high demand', 'INTERNAL'))


def generate_structured_content(instruction: str, schema: type[BaseModel], stage: str):
    """Retry short-lived provider 5xx failures without hiding quota or validation errors."""
    attempts = max(1, GENERATION_MAX_RETRIES)
    client = gemini_client()
    for attempt in range(attempts):
        try:
            return client.models.generate_content(
                model=GENERATION_MODEL,
                contents=instruction,
                config=types.GenerateContentConfig(
                    response_mime_type='application/json',
                    response_json_schema=schema.model_json_schema(),
                ),
            )
        except Exception as exc:
            if not is_provider_unavailable(exc) or attempt + 1 >= attempts:
                raise
            delay = GENERATION_RETRY_BASE_SECONDS * (2 ** attempt)
            LOGGER.warning(
                'Gemini generation temporarily unavailable stage=%s attempt=%s/%s; retrying in %.1fs',
                stage, attempt + 1, attempts, delay,
            )
            time.sleep(delay)
    raise RuntimeError('Structured generation retry loop exhausted unexpectedly.')


def embed(contents: list[str], task_type: str) -> list[list[float]]:
    if not contents:
        return []
    config_kwargs: dict[str, Any] = {'task_type': task_type}
    if 'gemini-embedding' in EMBEDDING_MODEL:
        config_kwargs['output_dimensionality'] = 768
    client = gemini_client()
    vectors: list[list[float]] = []
    batch_size = EMBEDDING_BATCH_SIZE
    total_batches = (len(contents) + batch_size - 1) // batch_size
    try:
        for idx in range(0, len(contents), batch_size):
            batch = contents[idx:idx + batch_size]
            batch_num = idx // batch_size + 1
            print(f'Embedding batch {batch_num}/{total_batches} ({len(batch)} items)...', flush=True)
            formatted_contents = [types.Content(parts=[types.Part.from_text(text=item)]) for item in batch]
            max_retries = EMBEDDING_QUERY_MAX_RETRIES if task_type == 'RETRIEVAL_QUERY' else EMBEDDING_MAX_RETRIES
            for attempt in range(max_retries):
                try:
                    response = client.models.embed_content(
                        model=EMBEDDING_MODEL,
                        contents=formatted_contents,
                        config=types.EmbedContentConfig(**config_kwargs),
                    )
                    for item in response.embeddings:
                        vectors.append(list(item.values))
                    time.sleep(1.0)
                    break
                except Exception as exc:
                    err_str = str(exc)
                    if is_rate_limited(exc):
                        if attempt + 1 >= max_retries:
                            raise PipelineError(
                                'GEMINI_RATE_LIMITED',
                                'Gemini is temporarily rate limited. Please retry shortly.',
                                'embedding',
                                429,
                            ) from exc
                        delay = embedding_retry_delay(err_str, attempt + 1)
                        print(f'Rate limit reached on batch {batch_num} (attempt {attempt + 1}/{max_retries}). Waiting {delay:.1f}s...', flush=True)
                        time.sleep(delay)
                    else:
                        raise
            else:
                raise RuntimeError(f'Failed to embed batch {batch_num} after {max_retries} attempts.')
    except PipelineError:
        raise
    except Exception as exc:
        # Keep provider diagnostics in internal logs instead of returning them to Laravel for persistence.
        LOGGER.exception('Gemini embedding request failed')
        raise PipelineError('EMBEDDING_FAILED', 'Gemini could not create document embeddings.', 'embedding', 502) from exc
    if len(vectors) != len(contents) or any(len(vector) != 768 for vector in vectors):
        raise PipelineError('EMBEDDING_DIMENSION_INVALID', 'Gemini did not return the expected 768-dimensional embeddings.', 'embedding', 502)
    return vectors


class SearchRequest(BaseModel):
    course_id: int
    query: str = Field(min_length=3, max_length=2000)
    top_k: int = Field(default=5, ge=1, le=15)
    document_ids: list[int] = Field(default_factory=list)


class SourcePreviewRequest(BaseModel):
    course_id: int
    topic: str = Field(min_length=3, max_length=500)
    learning_object_type: Literal['quiz', 'flashcard', 'mindmap', 'slide']
    requested_count: int = Field(ge=2, le=20)
    document_ids: list[int] = Field(default_factory=list)
    top_k: int = Field(default=8, ge=3, le=15)
    max_pages: int | None = Field(default=None, ge=1, le=10)
    scope_mode: Literal['topic', 'whole_document'] = 'topic'


class EvidenceRequest(BaseModel):
    course_id: int
    prompt: str = Field(min_length=3, max_length=2000)
    top_k: int = Field(default=5, ge=1, le=10)


class Citation(BaseModel):
    vector_id: str
    source_locator: str | None = None


class EvidenceOutput(BaseModel):
    answer: str
    citations: list[Citation]
    limitations: str


class EvidenceDraft(BaseModel):
    answer: str
    citation_indexes: list[int] = Field(min_length=1)
    limitations: str


class QuizGenerationRequest(BaseModel):
    course_id: int
    topic: str = Field(min_length=3, max_length=500)
    difficulty: Literal['easy', 'medium', 'hard'] = 'medium'
    question_count: int = Field(default=5, ge=3, le=20)
    document_ids: list[int] = Field(default_factory=list)
    top_k: int = Field(default=8, ge=3, le=15)
    scope_mode: Literal['topic', 'whole_document'] = 'topic'


class QuizQuestionDraft(BaseModel):
    question: str = Field(min_length=3, max_length=2000)
    options: list[str] = Field(min_length=4, max_length=4)
    correct_index: int = Field(ge=0, le=3)
    explanation: str = Field(min_length=3, max_length=4000)
    citation_indexes: list[int] = Field(min_length=1)


class QuizDraft(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    description: str = Field(default='', max_length=2000)
    questions: list[QuizQuestionDraft] = Field(min_length=3, max_length=20)


class QuizCitation(BaseModel):
    vector_id: str
    source_locator: str | None = None
    document_id: int
    document_name: str


class QuizQuestionOutput(BaseModel):
    question: str
    options: list[str]
    correct_index: int
    explanation: str
    citations: list[QuizCitation]


class QuizOutput(BaseModel):
    title: str
    description: str
    questions: list[QuizQuestionOutput]


class FlashcardGenerationRequest(BaseModel):
    course_id: int
    topic: str = Field(min_length=3, max_length=500)
    difficulty: Literal['easy', 'medium', 'hard'] = 'medium'
    card_count: int = Field(default=8, ge=5, le=15)
    document_ids: list[int] = Field(default_factory=list)
    top_k: int = Field(default=10, ge=3, le=15)
    max_pages: int = Field(default=5, ge=1, le=10)
    scope_mode: Literal['topic', 'whole_document'] = 'topic'


class FlashcardDraftCard(BaseModel):
    front: str = Field(min_length=1, max_length=2000)
    back: str = Field(min_length=1, max_length=4000)
    hint: str = Field(default='', max_length=2000)
    citation_indexes: list[int] = Field(min_length=1)


class FlashcardDraft(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    description: str = Field(default='', max_length=2000)
    cards: list[FlashcardDraftCard] = Field(min_length=5, max_length=15)


class FlashcardCardOutput(BaseModel):
    id: int
    front: str
    back: str
    hint: str
    citations: list[QuizCitation]


class FlashcardOutput(BaseModel):
    title: str
    description: str
    cards: list[FlashcardCardOutput]


class MindmapGenerationRequest(BaseModel):
    course_id: int
    topic: str = Field(min_length=3, max_length=500)
    difficulty: Literal['easy', 'medium', 'hard'] = 'medium'
    depth: int = Field(default=3, ge=2, le=5)
    document_ids: list[int] = Field(default_factory=list)
    top_k: int = Field(default=10, ge=3, le=15)
    max_pages: int = Field(default=5, ge=1, le=10)
    scope_mode: Literal['topic', 'whole_document'] = 'topic'
    target_node_count: int = Field(default=30, ge=10, le=120)


class MindmapDraftNode(BaseModel):
    label: str = Field(min_length=1, max_length=500)
    citation_indexes: list[int] = Field(min_length=1)
    # Internal trees are validated by the adaptive quality gate. Keeping an old provider-facing
    # eight-child cap here would raise an unhandled validation error before that gate can regroup
    # an overly flat whole-document outline.
    children: list['MindmapDraftNode'] = Field(default_factory=list)


class MindmapDraft(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    description: str = Field(default='', max_length=2000)
    root: MindmapDraftNode


class MindmapPathItem(BaseModel):
    """Provider-friendly hierarchy representation without a recursive JSON schema."""
    path: list[str] = Field(min_length=1, max_length=5)
    citation_indexes: list[int] = Field(min_length=1)


class MindmapPathDraft(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    description: str = Field(default='', max_length=2000)
    # A large maxItems combined with the nested path array makes Gemini's constrained-decoding
    # grammar exceed its complexity budget. The server enforces the upper bound after parsing.
    items: list[MindmapPathItem] = Field(min_length=2)


class MindmapNode(BaseModel):
    id: str
    label: str
    citations: list[QuizCitation]
    children: list['MindmapNode'] = Field(default_factory=list)


class MindmapPayload(BaseModel):
    title: str
    description: str
    root: MindmapNode
    markdown: str


class SlideGenerationRequest(BaseModel):
    course_id: int
    topic: str = Field(min_length=3, max_length=500)
    difficulty: Literal['easy', 'medium', 'hard'] = 'medium'
    slide_count: int = Field(default=6, ge=5, le=10)
    document_ids: list[int] = Field(default_factory=list)
    top_k: int = Field(default=10, ge=3, le=15)
    max_pages: int = Field(default=5, ge=1, le=10)
    scope_mode: Literal['topic', 'whole_document'] = 'topic'


class SlideDraftItem(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    layout: Literal['title', 'bullet_points', 'summary'] = 'bullet_points'
    bullet_points: list[str] = Field(min_length=3, max_length=5)
    speaker_notes: str = Field(min_length=1, max_length=4000)
    citation_indexes: list[int] = Field(min_length=1)


class SlideDraft(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    description: str = Field(default='', max_length=2000)
    slides: list[SlideDraftItem] = Field(min_length=5, max_length=10)


class SlideItem(BaseModel):
    slide_number: int
    title: str
    layout: Literal['title', 'bullet_points', 'summary']
    bullet_points: list[str]
    speaker_notes: str
    citations: list[QuizCitation]


class SlidePayload(BaseModel):
    title: str
    description: str
    slides: list[SlideItem]


class FsrsScheduleRequest(BaseModel):
    card: dict[str, Any] | None = None
    rating: int = Field(ge=1, le=4)
    reviewed_at: datetime
    desired_retention: float = Field(default=0.9, ge=0.8, le=0.97)


@APP.post('/internal/v1/fsrs/schedule', dependencies=[Depends(require_service_token)])
def schedule_fsrs_review(request: FsrsScheduleRequest) -> dict[str, Any]:
    """Apply one authoritative FSRS review without involving Gemini or ChromaDB."""
    reviewed_at = request.reviewed_at.astimezone(timezone.utc)
    card = FsrsCard.from_json(json.dumps(request.card)) if request.card else FsrsCard()
    scheduler = FsrsScheduler(desired_retention=request.desired_retention, enable_fuzzing=False)
    updated, review_log = scheduler.review_card(card, FsrsRating(request.rating), review_datetime=reviewed_at)
    return {
        'card': json.loads(updated.to_json()),
        'review_log': json.loads(review_log.to_json()),
        'state': updated.state.name.lower(),
        'due_at': updated.due.isoformat(),
        'stability': updated.stability,
        'difficulty': updated.difficulty,
        'retrievability': scheduler.get_card_retrievability(updated, current_datetime=reviewed_at),
        'interval_seconds': max(0, int((updated.due - reviewed_at).total_seconds())),
    }


def redact_sensitive_text(value: str) -> str:
    return re.sub(r'(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', '[redacted-email]', value)


def chunk_metadata(chunk: dict[str, Any], *, course_id: str, document_id: str, filename: str,
                   mime_type: str, processing_run_id: str = '', checkpoint_id: str = '') -> dict[str, Any]:
    """Serialize structure metadata using only scalar values accepted by ChromaDB."""
    return {
        'course_id': str(course_id),
        'document_id': str(document_id),
        'document_name': filename,
        'source_locator': chunk.get('source_locator') or '',
        'source_start': chunk.get('source_start') or '',
        'source_end': chunk.get('source_end') or '',
        'page_start': int(chunk.get('page_start') or -1),
        'page_end': int(chunk.get('page_end') or -1),
        'section_title': chunk.get('section_title') or '',
        'section_key': chunk.get('section_key') or '',
        'heading_path': json.dumps(chunk.get('heading_path') or [], ensure_ascii=False),
        'chunking_strategy': chunk.get('chunking_strategy') or 'paragraph-window-v1',
        'content_hash': chunk.get('content_hash') or '',
        'chunk_index': int(chunk['chunk_index']),
        'mime_type': mime_type,
        'processing_run_id': str(processing_run_id),
        'checkpoint_id': checkpoint_id,
    }


def match_from_chroma(vector_id: str, content: str, metadata: dict[str, Any], score: float) -> dict[str, Any]:
    page_start = int(metadata.get('page_start') or -1)
    page_end = int(metadata.get('page_end') or -1)
    locator = metadata.get('source_locator') or None
    # Chunks ingested before structure-v2 do not have page metadata. Their extracted
    # text still contains page markers, so keep citations useful without reprocessing
    # or mutating the existing vector collection.
    if not locator:
        page_markers = [int(value) for value in re.findall(r'\[Page\s+(\d+)\]', content, flags=re.IGNORECASE)]
        if page_markers:
            page_start = page_markers[0]
            page_end = page_markers[-1]
            locator = f'page {page_start}' if page_start == page_end else f'pages {page_start}-{page_end}'
    try:
        heading_path = json.loads(metadata.get('heading_path') or '[]')
    except (TypeError, ValueError, json.JSONDecodeError):
        heading_path = []
    return {
        'vector_id': vector_id,
        'content': redact_sensitive_text(content),
        'score': round(score, 4),
        'document_id': int(metadata['document_id']),
        'document_name': metadata.get('document_name') or 'document',
        'source_locator': locator,
        'source_start': metadata.get('source_start') or locator,
        'source_end': metadata.get('source_end') or locator,
        'page_start': None if page_start < 0 else page_start,
        'page_end': None if page_end < 0 else page_end,
        'section_title': metadata.get('section_title') or None,
        'section_key': metadata.get('section_key') or None,
        'heading_path': heading_path if isinstance(heading_path, list) else [],
        'chunk_index': int(metadata.get('chunk_index', str(vector_id).rsplit(':', 1)[-1])),
        'processing_run_id': str(metadata.get('processing_run_id') or ''),
    }


def neighbouring_vector_ids(matches: list[dict[str, Any]], radius: int = 1) -> list[str]:
    ids: list[str] = []
    for match in matches:
        parts = str(match['vector_id']).split(':')
        if len(parts) != 3 or not parts[2].isdigit():
            continue
        for offset in range(-radius, radius + 1):
            index = int(parts[2]) + offset
            if index >= 0:
                ids.append(f'{parts[0]}:{parts[1]}:{index}')
    return list(dict.fromkeys(ids))


def search_collection(request: SearchRequest) -> dict[str, Any]:
    vector = embed([request.query], 'RETRIEVAL_QUERY')[0]
    where: dict[str, Any] = {'course_id': str(request.course_id)}
    if request.document_ids:
        where = {'$and': [where, {'document_id': {'$in': [str(value) for value in request.document_ids]}}]}
    try:
        collection = chroma_collection()
        # Retrieve a larger semantic candidate pool, then add adjacent chunks so a sentence at a
        # chunk boundary is not presented to generation without its surrounding explanation.
        result = collection.query(query_embeddings=[vector], n_results=min(45, request.top_k * 3), where=where, include=['documents', 'metadatas', 'distances'])
    except PipelineError:
        raise
    except Exception as exc:
        raise PipelineError('RETRIEVAL_FAILED', 'ChromaDB could not search the processed chunks.', 'retrieval', 503) from exc
    ids, documents, metadatas, distances = (result.get('ids', [[]])[0], result.get('documents', [[]])[0], result.get('metadatas', [[]])[0], result.get('distances', [[]])[0])
    semantic_matches = []
    for vector_id, content, metadata, distance in zip(ids, documents, metadatas, distances):
        semantic_matches.append(match_from_chroma(vector_id, content, metadata, 1 / (1 + float(distance))))

    seeds: list[dict[str, Any]] = []
    seen_sections: set[tuple[int, str]] = set()
    for match in semantic_matches:
        section_key = (match['document_id'], match.get('section_title') or match.get('source_locator') or match['vector_id'])
        if section_key in seen_sections and len(seeds) < max(2, request.top_k // 2):
            continue
        seen_sections.add(section_key)
        seeds.append(match)
        if len(seeds) >= request.top_k:
            break

    neighbour_ids = neighbouring_vector_ids(seeds)
    neighbours_by_id: dict[str, dict[str, Any]] = {}
    if neighbour_ids:
        neighbour_result = collection.get(ids=neighbour_ids, include=['documents', 'metadatas'])
        for vector_id, content, metadata in zip(
            neighbour_result.get('ids', []), neighbour_result.get('documents', []), neighbour_result.get('metadatas', [])
        ):
            neighbours_by_id[vector_id] = match_from_chroma(vector_id, content, metadata, 0.5)

    matches: list[dict[str, Any]] = []
    semantic_scores = {match['vector_id']: match['score'] for match in semantic_matches}
    for vector_id in neighbouring_vector_ids(seeds):
        match = neighbours_by_id.get(vector_id)
        if not match:
            continue
        match['score'] = semantic_scores.get(vector_id, match['score'])
        matches.append(match)
        if len(matches) >= request.top_k:
            break
    return {'query': request.query, 'matches': matches, 'embedding_model': EMBEDDING_MODEL, 'collection': COLLECTION_NAME}


@APP.get('/health')
def health() -> dict[str, Any]:
    return {
        'status': 'ok', 'service': 'fastapi-rag', 'embedding_model': EMBEDDING_MODEL,
        'generation_model': GENERATION_MODEL, 'vector_store': 'chromadb',
        'gemini_configured': bool(os.getenv('GEMINI_API_KEY')),
    }


@APP.post('/internal/v1/documents/process', dependencies=[Depends(require_service_token)])
@APP.post('/process', dependencies=[Depends(require_service_token)])
async def process_document(
    file: Annotated[UploadFile, File()],
    document_id: Annotated[str, Form()],
    course_id: Annotated[str, Form()],
    processing_run_id: Annotated[str, Form()],
    extension: Annotated[str, Form()],
    mime_type: Annotated[str, Form()],
    max_pages: Annotated[int | None, Form()] = None,
) -> dict[str, Any]:
    content = await file.read()
    # The lock lives inside the worker thread, not the request coroutine: a disconnected Laravel
    # client cannot release it while synchronous provider work is still running.
    return await run_in_threadpool(
        process_locked_document_content,
        content,
        file.filename or 'document',
        document_id,
        course_id,
        processing_run_id,
        extension,
        mime_type,
        max_pages,
    )


@APP.get('/internal/v1/documents/{document_id}/processing-status', dependencies=[Depends(require_service_token)])
def get_document_processing_status(document_id: int) -> dict[str, Any]:
    return document_processing_status(str(document_id))


def process_locked_document_content(
    content: bytes,
    filename: str,
    document_id: str,
    course_id: str,
    processing_run_id: str,
    extension: str,
    mime_type: str,
    max_pages: int | None = None,
) -> dict[str, Any]:
    if not acquire_document_processing(document_id, processing_run_id):
        raise PipelineError(
            'DOCUMENT_PROCESSING_IN_PROGRESS',
            'This document already has an active AI processing request.',
            'processing',
            409,
        )
    try:
        return process_document_content(
            content, filename, document_id, course_id, processing_run_id, extension, mime_type, max_pages,
        )
    finally:
        release_document_processing(document_id, processing_run_id)


def process_document_content(
    content: bytes,
    filename: str,
    document_id: str,
    course_id: str,
    processing_run_id: str,
    extension: str,
    mime_type: str,
    max_pages: int | None = None,
) -> dict[str, Any]:
    extracted = extract_document(content, extension, max_pages=max_pages)
    sections = extracted.metadata.get('outline') or []
    chunks = attach_document_sections(chunk_text(extracted.text), sections)
    if not chunks:
        raise PipelineError('NO_CHUNKS_CREATED', 'No chunks could be created from the extracted text.', 'chunking')

    # The checkpoint is stable across manual retries but changes when source text, chunking output,
    # page scope or embedding model changes. Completed batches can therefore be reused safely.
    checkpoint_material = json.dumps({
        'document_id': str(document_id),
        'embedding_model': EMBEDDING_MODEL,
        'max_pages': max_pages,
        'chunk_hashes': [chunk['content_hash'] for chunk in chunks],
    }, sort_keys=True, separators=(',', ':'))
    checkpoint_id = hashlib.sha256(checkpoint_material.encode('utf-8')).hexdigest()
    staging_ids = [f'stage:{document_id}:{checkpoint_id[:20]}:{chunk["chunk_index"]}' for chunk in chunks]
    vector_ids = [f'{document_id}:{processing_run_id}:{chunk["chunk_index"]}' for chunk in chunks]
    staging = chroma_staging_collection()

    try:
        # Remove checkpoints produced from an obsolete source/config while preserving this retry's batches.
        staged_for_document = staging.get(where={'document_id': str(document_id)}, include=['metadatas'])
        expected_staging_ids = set(staging_ids)
        stale_ids = [value for value in staged_for_document.get('ids', []) if value not in expected_staging_ids]
        if stale_ids:
            staging.delete(ids=stale_ids)

        staged_result = staging.get(ids=staging_ids, include=['metadatas'])
        existing_staging_ids = set(staged_result.get('ids', []))
        reused_chunks = len(existing_staging_ids)
        embedded_chunks = 0
        for offset in range(0, len(chunks), EMBEDDING_BATCH_SIZE):
            batch_chunks = chunks[offset:offset + EMBEDDING_BATCH_SIZE]
            batch_staging_ids = staging_ids[offset:offset + EMBEDDING_BATCH_SIZE]
            missing = [
                (chunk, staging_id)
                for chunk, staging_id in zip(batch_chunks, batch_staging_ids)
                if staging_id not in existing_staging_ids
            ]
            if not missing:
                continue
            missing_vectors = embed([chunk['content'] for chunk, _ in missing], 'RETRIEVAL_DOCUMENT')
            missing_chunks = [chunk for chunk, _ in missing]
            missing_ids = [staging_id for _, staging_id in missing]
            staging.upsert(
                ids=missing_ids,
                documents=[chunk['content'] for chunk in missing_chunks],
                embeddings=missing_vectors,
                metadatas=[chunk_metadata(
                    chunk, course_id=course_id, document_id=document_id,
                    filename=filename, mime_type=mime_type, checkpoint_id=checkpoint_id,
                ) for chunk in missing_chunks],
            )
            existing_staging_ids.update(missing_ids)
            embedded_chunks += len(missing_ids)

        completed = staging.get(ids=staging_ids, include=['documents', 'metadatas', 'embeddings'])
        completed_ids = completed.get('ids', [])
        if len(completed_ids) != len(chunks):
            raise PipelineError('STAGING_INCOMPLETE', 'Not all document chunks reached the staging checkpoint.', 'embedding', 503)
        staged_by_id = {
            value: {
                'document': completed['documents'][index],
                'embedding': completed['embeddings'][index],
            }
            for index, value in enumerate(completed_ids)
        }
        ordered_documents = [staged_by_id[value]['document'] for value in staging_ids]
        ordered_embeddings = [staged_by_id[value]['embedding'] for value in staging_ids]
        metadatas = [chunk_metadata(
            chunk, course_id=course_id, document_id=document_id, filename=filename,
            mime_type=mime_type, processing_run_id=processing_run_id, checkpoint_id=checkpoint_id,
        ) for chunk in chunks]
        # Active vectors are written only after every staged chunk exists. Older active vectors stay
        # searchable until Laravel commits MySQL artifacts and calls the finalize endpoint.
        chroma_collection().upsert(ids=vector_ids, documents=ordered_documents, embeddings=ordered_embeddings, metadatas=metadatas)
    except PipelineError:
        raise
    except Exception as exc:
        raise PipelineError('VECTOR_UPSERT_FAILED', 'ChromaDB could not store the document chunks.', 'vectorizing', 503) from exc

    response_chunks = []
    for chunk, vector_id in zip(chunks, vector_ids):
        response_chunks.append({**chunk, 'vector_id': vector_id, 'dimensions': 768})
    return {
        'extraction': {'normalized_text': extracted.text, 'character_count': len(extracted.text), 'page_count': extracted.page_count, 'metadata': extracted.metadata},
        'sections': sections,
        'chunks': response_chunks,
        'embedding_model': EMBEDDING_MODEL,
        'vector_store': {'provider': 'chromadb', 'collection': COLLECTION_NAME},
        'ingestion': {
            'checkpoint_id': checkpoint_id,
            'staging_collection': STAGING_COLLECTION_NAME,
            'total_chunks': len(chunks),
            'reused_chunks': reused_chunks,
            'embedded_chunks': embedded_chunks,
        },
    }


@APP.post('/internal/v1/retrieval/search', dependencies=[Depends(require_service_token)])
@APP.post('/retrieve', dependencies=[Depends(require_service_token)])
def retrieval_search(request: SearchRequest) -> dict[str, Any]:
    return search_collection(request)


@APP.post('/internal/v1/retrieval/source-preview', dependencies=[Depends(require_service_token)])
def source_preview(request: SourcePreviewRequest) -> dict[str, Any]:
    if request.scope_mode == 'whole_document':
        all_matches = document_collection_matches(request.course_id, request.document_ids)
        if not all_matches:
            raise PipelineError('NO_GROUNDED_CONTEXT', 'The selected documents do not contain processed chunks.', 'retrieval', 422)
        representative = representative_document_matches(all_matches, request.top_k)
        retrieved = {
            'query': request.topic,
            'matches': representative,
            'embedding_model': EMBEDDING_MODEL,
            'collection': COLLECTION_NAME,
            'total_scope_chunks': len(all_matches),
        }
        return build_source_preview(request, retrieved)
    retrieved = search_collection(SearchRequest(
        course_id=request.course_id,
        query=request.topic,
        top_k=request.top_k,
        document_ids=request.document_ids,
    ))
    return build_source_preview(request, retrieved)


@APP.post('/internal/v1/evidence/generate', dependencies=[Depends(require_service_token)])
def generate_evidence(request: EvidenceRequest) -> dict[str, Any]:
    retrieved = search_collection(SearchRequest(course_id=request.course_id, query=request.prompt, top_k=request.top_k))
    matches = retrieved['matches']
    if not matches:
        raise PipelineError('NO_GROUNDED_CONTEXT', 'No processed chunks matched this request.', 'generation', 422)
    context = '\n\n'.join(
        f'[Source {index}] [Hierarchy] {" > ".join(match.get("heading_path") or []) or "not detected"}\n{match["content"]}'
        for index, match in enumerate(matches, start=1)
    )
    instruction = (
        'Answer only from the source chunks below. Return Vietnamese JSON following the schema. '
        'citation_indexes must contain one or more supplied Source numbers and must not invent any number. '\
        f'\n\nQuestion: {request.prompt}\n\nSource chunks:\n{context}'
    )
    try:
        client = gemini_client()
        response = client.models.generate_content(
            model=GENERATION_MODEL,
            contents=instruction,
            config=types.GenerateContentConfig(response_mime_type='application/json', response_json_schema=EvidenceDraft.model_json_schema()),
        )
        draft = EvidenceDraft.model_validate(json.loads(response.text))
    except PipelineError:
        raise
    except Exception as exc:
        print(f'Gemini evidence-generation failure type: {type(exc).__name__}', flush=True)
        LOGGER.exception('Gemini evidence-generation request failed')
        if is_rate_limited(exc):
            raise PipelineError('GEMINI_RATE_LIMITED', 'Gemini is temporarily rate limited. Please retry shortly.', 'generation', 429) from exc
        raise PipelineError('GENERATION_FAILED', 'Gemini could not generate grounded evidence.', 'generation', 502) from exc
    if any(index < 1 or index > len(matches) for index in draft.citation_indexes):
        raise PipelineError('UNGROUNDABLE_CITATION', 'Gemini returned a citation outside the retrieved source set.', 'generation', 502)
    selected_indexes = list(dict.fromkeys(draft.citation_indexes))
    output = EvidenceOutput(
        answer=draft.answer,
        limitations=draft.limitations,
        citations=[Citation(vector_id=matches[index - 1]['vector_id'], source_locator=matches[index - 1]['source_locator']) for index in selected_indexes],
    )
    return {'evidence': output.model_dump(), 'retrieval': retrieved}


@APP.post('/internal/v1/generation/quiz', dependencies=[Depends(require_service_token)])
def generate_quiz(request: QuizGenerationRequest) -> dict[str, Any]:
    if request.scope_mode == 'whole_document':
        return generate_whole_document_quiz(request)
    retrieved = search_collection(SearchRequest(
        course_id=request.course_id,
        query=request.topic,
        top_k=request.top_k,
        document_ids=request.document_ids,
    ))
    matches = retrieved['matches']
    if not matches:
        raise PipelineError('NO_GROUNDED_CONTEXT', 'No processed chunks matched this quiz topic.', 'generation', 422)
    context = '\n\n'.join(
        f'[Source {index}] [Hierarchy] {" > ".join(match.get("heading_path") or []) or "not detected"}\n{match["content"]}'
        for index, match in enumerate(matches, start=1)
    )
    instruction = (
        'Create a Vietnamese single-choice educational quiz using only the numbered source chunks below.\n'
        f'- Topic: {request.topic}\n'
        f'- Question count: {request.question_count} | Difficulty: {request.difficulty}\n\n'
        'REQUIREMENTS:\n'
        '1. Grounding: Rely strictly on the conceptual facts in the provided source chunks. Each question must include valid citation_indexes referencing the supporting [Source] numbers.\n'
        '2. Formula & Notation Auditing (Auto-Correction): Textbooks may contain typos, font encoding artifacts, missing brackets, or malformed expressions. NEVER copy broken or garbled formulas verbatim. Intelligently detect, correct, and restore all mathematical, logical, chemical, or technical notations to their canonical, mathematically sound forms.\n'
        '3. LaTeX Formatting: Enclose all mathematical notations, equations, variables, set operations, and expressions in standard LaTeX using $...$ (or $$...$$ for block display) in question text, options, and explanations.\n'
        '4. Natural Presentation: Use clear, unambiguous, high-quality Vietnamese. Ensure questions and options are pedagogically sound and logically consistent.\n'
        '5. Strict Structure: Each question must have exactly four distinct options, one zero-based correct_index (0-3), and an evidence-backed explanation.\n\n'
        '6. Coverage: Questions must assess distinct supported concepts or reasoning skills; do not paraphrase the same fact repeatedly.\n\n'
        f'Source chunks:\n{context}'
    )
    raw_draft, citation_repaired = grounded_generation_direct(
        instruction,
        QuizDraft,
        len(matches),
        'topic quiz',
        'QUIZ_GENERATION_FAILED',
        'Gemini could not generate a valid quiz.',
    )
    draft = QuizDraft.model_validate(raw_draft)

    if len(draft.questions) != request.question_count:
        raise PipelineError('QUIZ_SCHEMA_INVALID', 'Gemini returned a different number of questions than requested.', 'generation', 502)
    normalized_questions = [re.sub(r'\W+', ' ', item.question, flags=re.UNICODE).strip().casefold() for item in draft.questions]
    if len(set(normalized_questions)) != len(normalized_questions):
        raise PipelineError('QUIZ_SCHEMA_INVALID', 'Gemini returned duplicate quiz questions.', 'generation', 502)
    output_questions: list[QuizQuestionOutput] = []
    for question in draft.questions:
        if len({option.strip().casefold() for option in question.options}) != 4 or any(not option.strip() for option in question.options):
            raise PipelineError('QUIZ_SCHEMA_INVALID', 'Every quiz question must contain four distinct non-empty options.', 'generation', 502)
        if any(index < 1 or index > len(matches) for index in question.citation_indexes):
            raise PipelineError('UNGROUNDABLE_CITATION', 'Gemini returned a quiz citation outside the retrieved source set.', 'generation', 502)
        selected_indexes = list(dict.fromkeys(question.citation_indexes))
        citations = [QuizCitation(
            vector_id=matches[index - 1]['vector_id'],
            source_locator=matches[index - 1]['source_locator'],
            document_id=matches[index - 1]['document_id'],
            document_name=matches[index - 1]['document_name'],
        ) for index in selected_indexes]
        output_questions.append(QuizQuestionOutput(
            question=question.question,
            options=question.options,
            correct_index=question.correct_index,
            explanation=question.explanation,
            citations=citations,
        ))
    output = QuizOutput(title=draft.title, description=draft.description, questions=output_questions)
    return {
        'quiz': output.model_dump(),
        'retrieval': {
            'query': retrieved['query'],
            'match_count': len(matches),
            'citation_repair_applied': citation_repaired,
            'embedding_model': retrieved['embedding_model'],
            'collection': retrieved['collection'],
        },
        'generation_model': GENERATION_MODEL,
    }


def limit_matches_to_source_pages(matches: list[dict[str, Any]], max_pages: int) -> list[dict[str, Any]]:
    """Limit context by real source locators instead of inventing a token-based page estimate."""
    selected: list[dict[str, Any]] = []
    page_keys: list[tuple[int, str]] = []
    for match in matches:
        locator = match.get('source_locator') or 'unknown-location'
        page_key = (int(match['document_id']), str(locator))
        if page_key not in page_keys:
            if len(page_keys) >= max_pages:
                continue
            page_keys.append(page_key)
        selected.append(match)
    return selected


def truncate_at_word(value: str, limit: int = 700) -> str:
    compact = re.sub(r'\s+', ' ', value).strip()
    if len(compact) <= limit:
        return compact
    boundary = compact.rfind(' ', 0, limit)
    return compact[:boundary if boundary > limit // 2 else limit].rstrip(' ,;:-') + '…'


def document_collection_matches(course_id: int, document_ids: list[int]) -> list[dict[str, Any]]:
    if not document_ids:
        raise PipelineError(
            'DOCUMENT_SCOPE_REQUIRED',
            'Whole-document synthesis requires at least one explicitly selected processed document.',
            'retrieval',
            422,
        )
    where: dict[str, Any] = {'$and': [
        {'course_id': str(course_id)},
        {'document_id': {'$in': [str(value) for value in document_ids]}},
    ]}
    try:
        result = chroma_collection().get(where=where, include=['documents', 'metadatas'])
    except PipelineError:
        raise
    except Exception as exc:
        raise PipelineError('RETRIEVAL_FAILED', 'ChromaDB could not read the selected documents.', 'retrieval', 503) from exc

    matches = [
        match_from_chroma(vector_id, content, metadata, 1.0)
        for vector_id, content, metadata in zip(
            result.get('ids', []), result.get('documents', []), result.get('metadatas', [])
        )
    ]
    # A finalized ingestion normally leaves one run. Selecting the newest run here also prevents
    # duplicate coverage if an older deployment left stale vectors behind.
    newest_run: dict[int, int] = {}
    for match in matches:
        run_id = int(match['processing_run_id']) if str(match['processing_run_id']).isdigit() else 0
        newest_run[match['document_id']] = max(newest_run.get(match['document_id'], 0), run_id)
    selected = [
        match for match in matches
        if (int(match['processing_run_id']) if str(match['processing_run_id']).isdigit() else 0) == newest_run[match['document_id']]
    ]
    return sorted(selected, key=lambda item: (item['document_id'], item['chunk_index']))


def representative_document_matches(matches: list[dict[str, Any]], limit: int = 15) -> list[dict[str, Any]]:
    if len(matches) <= limit:
        return matches
    indexes = {round(index * (len(matches) - 1) / (limit - 1)) for index in range(limit)}
    return [matches[index] for index in sorted(indexes)]


def recommended_output_limit(object_type: str, usable_match_count: int) -> int:
    """Return a conservative UX recommendation, not a promise about generation quality."""
    if usable_match_count <= 0:
        return 0
    if object_type == 'quiz':
        return min(20, max(3, usable_match_count * 2))
    if object_type == 'flashcard':
        return min(15, max(5, usable_match_count * 2))
    if object_type == 'mindmap':
        return 2 if usable_match_count < 5 else 3 if usable_match_count < 10 else 4
    return min(10, max(5, usable_match_count + 2))


def build_source_preview(request: SourcePreviewRequest, retrieved: dict[str, Any]) -> dict[str, Any]:
    matches = list(retrieved.get('matches', []))
    if request.scope_mode == 'topic' and request.max_pages is not None:
        matches = limit_matches_to_source_pages(matches, request.max_pages)

    usable_matches = [match for match in matches if float(match.get('score', 0)) >= 0.5]
    suggested_max = recommended_output_limit(request.learning_object_type, len(usable_matches))
    total_scope_chunks = int(retrieved.get('total_scope_chunks', len(matches)))
    if request.scope_mode == 'whole_document':
        # The representative matches are a UI sample. Generation consumes every chunk
        # through map-reduce, so topic-mode output heuristics do not apply here.
        suggested_max = request.requested_count
    best_score = max((float(match.get('score', 0)) for match in matches), default=0)

    if not matches or best_score < 0.45:
        assessment = 'insufficient'
        message = 'Không tìm thấy nguồn đủ liên quan. Hãy điều chỉnh chủ đề hoặc chọn tài liệu khác.'
    elif request.scope_mode == 'whole_document':
        assessment = 'sufficient'
        message = (
            f'Hệ thống đã xác nhận {total_scope_chunks} đoạn trong toàn bộ tài liệu được chọn. '
            'Các đoạn bên dưới chỉ là mẫu đại diện; khi tạo học liệu, toàn bộ phạm vi sẽ được phân tích theo từng lô.'
        )
    elif suggested_max >= request.requested_count and len(usable_matches) >= 2:
        assessment = 'sufficient'
        message = f'Nguồn phù hợp với yêu cầu hiện tại và hỗ trợ khoảng tối đa {suggested_max} mục.'
    else:
        assessment = 'limited'
        message = f'Nguồn còn hạn chế; nên tạo tối đa khoảng {suggested_max} mục hoặc mở rộng phạm vi.'

    preview_matches = []
    for match in matches:
        score = float(match.get('score', 0))
        preview_matches.append({
            'vector_id': match['vector_id'],
            'excerpt': truncate_at_word(str(match.get('content', ''))),
            'score': score,
            'relevance': 'high' if score >= 0.7 else 'medium' if score >= 0.55 else 'low',
            'document_id': match['document_id'],
            'document_name': match['document_name'],
            'source_locator': match.get('source_locator'),
        })

    return {
        'assessment': assessment,
        'message': message,
        'suggested_max_output': suggested_max,
        'requested_count': request.requested_count,
        'match_count': len(preview_matches),
        'usable_match_count': len(usable_matches),
        'document_count': len({match['document_id'] for match in preview_matches}),
        'source_locator_count': len({
            (match['document_id'], match['source_locator'])
            for match in preview_matches
            if match.get('source_locator')
        }),
        'matches': preview_matches,
        'retrieval': {
            'query': retrieved['query'],
            'top_k': request.top_k,
            'max_pages': request.max_pages,
            'embedding_model': retrieved['embedding_model'],
            'collection': retrieved['collection'],
            'scope_mode': request.scope_mode,
            'total_scope_chunks': total_scope_chunks,
        },
    }


def authoritative_citations(indexes: list[int], matches: list[dict[str, Any]], object_name: str) -> list[QuizCitation]:
    """Map provider indexes to trusted retrieval metadata; provider-supplied source metadata is never persisted."""
    if any(index < 1 or index > len(matches) for index in indexes):
        raise PipelineError('UNGROUNDABLE_CITATION', f'Gemini returned a {object_name} citation outside the retrieved source set.', 'generation', 502)
    return [QuizCitation(
        vector_id=matches[index - 1]['vector_id'],
        source_locator=matches[index - 1]['source_locator'],
        document_id=matches[index - 1]['document_id'],
        document_name=matches[index - 1]['document_name'],
    ) for index in dict.fromkeys(indexes)]


def normalize_mindmap_node(node: MindmapDraftNode, matches: list[dict[str, Any]], path: list[int], max_depth: int) -> MindmapNode:
    if len(path) + 1 > max_depth:
        raise PipelineError('MINDMAP_SCHEMA_INVALID', 'Gemini returned a mindmap deeper than requested.', 'generation', 502)
    node_id = 'root' if not path else 'node_' + '_'.join(str(value) for value in path)
    return MindmapNode(
        id=node_id,
        label=node.label.strip(),
        citations=authoritative_citations(node.citation_indexes, matches, 'mindmap'),
        children=[normalize_mindmap_node(child, matches, [*path, index], max_depth) for index, child in enumerate(node.children, start=1)],
    )


def mindmap_markdown(node: MindmapNode, level: int = 1) -> list[str]:
    lines = [f'{"#" * min(level, 6)} {node.label}']
    for child in node.children:
        lines.extend(mindmap_markdown(child, level + 1))
    return lines


def clean_mindmap_draft_node(node: dict[str, Any]) -> dict[str, Any]:
    """Gemini may emit null placeholders for recursive array slots; they carry no content and are safely removed."""
    cleaned = dict(node)
    children = cleaned.get('children') or []
    cleaned['children'] = [clean_mindmap_draft_node(child) for child in children if isinstance(child, dict)]
    return cleaned


def mindmap_path_draft_to_tree(draft: MindmapPathDraft) -> MindmapDraft:
    """Build a deterministic tree from provider-generated hierarchy paths.

    Recursive response schemas are legal JSON, but lightweight generation models often satisfy
    them with empty ``children`` arrays. Full paths keep provider output non-recursive while the
    server remains responsible for tree shape, prefix merging and citation propagation.
    """
    if len(draft.items) > 120:
        LOGGER.warning('Mindmap hierarchy rejected because provider returned %s paths', len(draft.items))
        raise PipelineError(
            'MINDMAP_HIERARCHY_INVALID',
            'Gemini returned more than 120 mindmap paths.',
            'hierarchy_validation',
            502,
        )

    prepared_items: list[tuple[list[str], list[int]]] = []
    for item in draft.items:
        segments = [re.sub(r'\s+', ' ', value).strip() for value in item.path if value.strip()]
        if segments:
            prepared_items.append((segments, item.citation_indexes))
    if len(prepared_items) != len(draft.items):
        raise PipelineError(
            'MINDMAP_HIERARCHY_INVALID',
            'Gemini returned a mindmap path without a meaningful child node.',
            'hierarchy_validation',
            502,
        )

    root_label = draft.title.strip()
    first_segments = {segments[0].casefold() for segments, _ in prepared_items}
    if len(first_segments) == 1 and all(len(segments) > 1 for segments, _ in prepared_items):
        # Providers commonly repeat a course/topic wrapper in every path. Promote that shared
        # prefix to the actual root so the meaningful chapters become first-level branches.
        root_label = prepared_items[0][0][0]
        prepared_items = [(segments[1:], citations) for segments, citations in prepared_items]

    root: dict[str, Any] = {
        'label': root_label,
        'citation_indexes': [],
        'children': [],
        '_children_by_label': {},
    }

    for segments, item_citations in prepared_items:
        if segments and segments[0].casefold() == root_label.casefold():
            segments = segments[1:]
        if not segments:
            raise PipelineError(
                'MINDMAP_HIERARCHY_INVALID',
                'Gemini returned a mindmap path without a meaningful child node.',
                'hierarchy_validation',
                502,
            )

        node = root
        for segment in segments:
            normalized = re.sub(r'\W+', ' ', segment, flags=re.UNICODE).strip().casefold()
            if not normalized:
                raise PipelineError(
                    'MINDMAP_HIERARCHY_INVALID',
                    'Gemini returned an empty mindmap path segment.',
                    'hierarchy_validation',
                    502,
                )
            child = node['_children_by_label'].get(normalized)
            if child is None:
                child = {
                    'label': segment,
                    'citation_indexes': [],
                    'children': [],
                    '_children_by_label': {},
                }
                node['_children_by_label'][normalized] = child
                node['children'].append(child)
            child['citation_indexes'] = list(dict.fromkeys([*child['citation_indexes'], *item_citations]))
            node['citation_indexes'] = list(dict.fromkeys([*node['citation_indexes'], *item_citations]))
            node = child

    def strip_indexes(node: dict[str, Any]) -> dict[str, Any]:
        citations = list(dict.fromkeys(node['citation_indexes']))
        if not citations:
            citations = [index for child in node['children'] for index in child['citation_indexes']]
            citations = list(dict.fromkeys(citations))
        return {
            'label': node['label'],
            'citation_indexes': citations,
            'children': [strip_indexes(child) for child in node['children']],
        }

    return MindmapDraft(
        title=draft.title,
        description=draft.description,
        root=MindmapDraftNode.model_validate(strip_indexes(root)),
    )


def hierarchical_cache_connection() -> sqlite3.Connection:
    directory = os.path.dirname(HIERARCHICAL_CACHE_PATH)
    if directory:
        os.makedirs(directory, exist_ok=True)
    connection = sqlite3.connect(HIERARCHICAL_CACHE_PATH, timeout=30)
    connection.execute(
        'CREATE TABLE IF NOT EXISTS generation_cache ('
        'cache_key TEXT PRIMARY KEY, payload_json TEXT NOT NULL, created_at TEXT NOT NULL)'
    )
    return connection


def structured_generation_cache_key(instruction: str, schema: type[BaseModel], stage: str) -> str:
    """Keep cache identity deterministic across retries without exposing source text in logs."""
    return hashlib.sha256(json.dumps({
        'model': GENERATION_MODEL,
        'prompt_version': HIERARCHICAL_PROMPT_VERSION,
        'stage': stage,
        'schema': schema.__name__,
        'instruction': instruction,
    }, sort_keys=True, ensure_ascii=False).encode('utf-8')).hexdigest()


def validated_structured_payload(
    payload: dict[str, Any],
    schema: type[BaseModel],
    semantic_validator: Callable[[BaseModel], None] | None = None,
) -> dict[str, Any]:
    """Validate both JSON shape and domain invariants before a provider result becomes reusable."""
    if schema is MindmapDraft:
        payload = dict(payload)
        payload['root'] = clean_mindmap_draft_node(payload['root'])
    model = schema.model_validate(payload)
    if semantic_validator is not None:
        semantic_validator(model)
    return model.model_dump()


def structured_generation_cached(
    instruction: str,
    schema: type[BaseModel],
    stage: str,
    semantic_validator: Callable[[BaseModel], None] | None = None,
) -> tuple[dict[str, Any], bool]:
    """Return only schema- and domain-valid cache entries; evict a poisoned entry in isolation."""
    cache_key = structured_generation_cache_key(instruction, schema, stage)
    with hierarchical_cache_connection() as connection:
        cached = connection.execute(
            'SELECT payload_json FROM generation_cache WHERE cache_key = ?', (cache_key,)
        ).fetchone()
        if cached:
            try:
                validated = validated_structured_payload(json.loads(cached[0]), schema, semantic_validator)
                return validated, True
            except (PipelineError, ValueError, TypeError, KeyError) as exc:
                # Schema-valid JSON can still be unsafe for the current evidence set. Delete only
                # this fingerprint so other completed map batches remain resumable.
                connection.execute('DELETE FROM generation_cache WHERE cache_key = ?', (cache_key,))
                LOGGER.warning(
                    'Evicted invalid hierarchical cache entry stage=%s key=%s reason=%s',
                    stage, cache_key[:12], exc,
                )

    try:
        # Keep the owning Client alive for the complete SDK call. Accessing `.models` on a
        # temporary Client lets its destructor close the shared HTTP transport before an
        # internal retry can send the request (observed as "client has been closed").
        response = generate_structured_content(instruction, schema, stage)
        payload = json.loads(response.text)
        # Domain validation deliberately runs before INSERT. This prevents a structurally valid
        # but ungroundable Gemini response from poisoning every later retry.
        validated = validated_structured_payload(payload, schema, semantic_validator)
    except PipelineError:
        raise
    except Exception as exc:
        LOGGER.exception('Gemini hierarchical %s generation failed', stage)
        if is_rate_limited(exc):
            raise PipelineError(
                'GEMINI_RATE_LIMITED',
                'Gemini is temporarily rate limited. Completed hierarchy batches are cached; retry later to continue.',
                'generation',
                429,
            ) from exc
        if is_provider_unavailable(exc):
            raise PipelineError(
                'GEMINI_UNAVAILABLE',
                'Gemini is temporarily unavailable. Completed hierarchy batches are cached; retry later to continue.',
                'generation',
                503,
            ) from exc
        raise PipelineError('MINDMAP_GENERATION_FAILED', 'Gemini could not generate a valid hierarchy.', 'generation', 502) from exc

    with hierarchical_cache_connection() as connection:
        connection.execute(
            'INSERT OR REPLACE INTO generation_cache(cache_key, payload_json, created_at) VALUES (?, ?, ?)',
            (cache_key, json.dumps(validated, ensure_ascii=False), datetime.now(timezone.utc).isoformat()),
        )
    return validated, False


def structured_citation_groups(draft: BaseModel) -> list[list[int]]:
    if isinstance(draft, MindmapPathDraft):
        return [item.citation_indexes for item in draft.items]
    if isinstance(draft, MindmapDraft):
        groups: list[list[int]] = []

        def visit(node: MindmapDraftNode) -> None:
            groups.append(node.citation_indexes)
            for child in node.children:
                visit(child)

        visit(draft.root)
        return groups
    if isinstance(draft, QuizDraft):
        return [item.citation_indexes for item in draft.questions]
    if isinstance(draft, FlashcardDraft):
        return [item.citation_indexes for item in draft.cards]
    if isinstance(draft, SlideDraft):
        return [item.citation_indexes for item in draft.slides]
    raise TypeError(f'Citation validation is not implemented for {type(draft).__name__}.')


def grounded_citation_validator(available_sources: int, object_name: str) -> Callable[[BaseModel], None]:
    """Bind a structured draft to the exact numbered evidence set used in its prompt."""
    def validate(draft: BaseModel) -> None:
        invalid = sorted({
            index
            for indexes in structured_citation_groups(draft)
            for index in indexes
            if index < 1 or index > available_sources
        })
        if invalid:
            preview = ', '.join(str(index) for index in invalid[:8])
            raise PipelineError(
                'UNGROUNDABLE_CITATION',
                f'Gemini returned {object_name} citation indexes outside 1-{available_sources}: {preview}.',
                'grounding_validation',
                502,
            )

    return validate


def grounded_generation_cached(
    instruction: str,
    schema: type[BaseModel],
    stage: str,
    available_sources: int,
    object_name: str,
    semantic_validator: Callable[[BaseModel], None] | None = None,
) -> tuple[dict[str, Any], bool, bool]:
    """Generate grounded JSON with one bounded regeneration when citation numbers are invalid."""
    citation_validator = grounded_citation_validator(available_sources, object_name)

    def validator(draft: BaseModel) -> None:
        citation_validator(draft)
        if semantic_validator is not None:
            semantic_validator(draft)

    try:
        payload, cache_hit = structured_generation_cached(instruction, schema, stage, validator)
        return payload, cache_hit, False
    except PipelineError as exc:
        if exc.code != 'UNGROUNDABLE_CITATION':
            raise

    LOGGER.warning(
        'Regenerating %s stage=%s after provider returned an out-of-range citation (allowed=1-%s)',
        object_name, stage, available_sources,
    )
    strict_instruction = (
        f'{instruction}\n\nGROUNDING CORRECTION REQUIRED:\n'
        f'- citation_indexes may contain only integers from 1 through {available_sources}.\n'
        '- Check every nested item before returning JSON. Do not copy section, page, vector, or outline numbers into citation_indexes.\n'
        '- If a statement cannot cite one of these numbered sources, remove that statement rather than inventing a citation.'
    )
    payload, cache_hit = structured_generation_cached(
        strict_instruction,
        schema,
        f'{stage}-citation-repair',
        validator,
    )
    return payload, cache_hit, True


def grounded_generation_direct(
    instruction: str,
    schema: type[BaseModel],
    available_sources: int,
    object_name: str,
    failure_code: str,
    failure_message: str,
    semantic_validator: Callable[[BaseModel], None] | None = None,
) -> tuple[dict[str, Any], bool]:
    """Apply the same bounded grounding correction to non-cached topic generation."""
    citation_validator = grounded_citation_validator(available_sources, object_name)

    def validator(draft: BaseModel) -> None:
        citation_validator(draft)
        if semantic_validator is not None:
            semantic_validator(draft)

    current_instruction = instruction
    for attempt in range(2):
        try:
            response = generate_structured_content(current_instruction, schema, f'topic-{object_name}')
            payload = validated_structured_payload(json.loads(response.text), schema, validator)
            return payload, attempt == 1
        except PipelineError as exc:
            if exc.code != 'UNGROUNDABLE_CITATION' or attempt == 1:
                raise
            LOGGER.warning(
                'Regenerating topic %s after provider returned an out-of-range citation (allowed=1-%s)',
                object_name, available_sources,
            )
            current_instruction = (
                f'{instruction}\n\nGROUNDING CORRECTION REQUIRED:\n'
                f'- citation_indexes may contain only integers from 1 through {available_sources}.\n'
                '- Check every item and nested node before returning JSON. Remove unsupported content instead of inventing a citation.'
            )
        except Exception as exc:
            LOGGER.exception('Gemini %s generation request failed', object_name)
            if is_rate_limited(exc):
                raise PipelineError(
                    'GEMINI_RATE_LIMITED',
                    'Gemini is temporarily rate limited. Please retry shortly.',
                    'generation',
                    429,
                ) from exc
            if is_provider_unavailable(exc):
                raise PipelineError(
                    'GEMINI_UNAVAILABLE',
                    'Gemini is temporarily unavailable. Please retry shortly.',
                    'generation',
                    503,
                ) from exc
            raise PipelineError(failure_code, failure_message, 'generation', 502) from exc

    raise PipelineError(failure_code, failure_message, 'generation', 502)


def context_batches(matches: list[dict[str, Any]], max_characters: int = 60000) -> list[list[dict[str, Any]]]:
    batches: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    current_size = 0
    for match in matches:
        size = len(match['content']) + 120
        if current and current_size + size > max_characters:
            batches.append(current)
            current = []
            current_size = 0
        current.append(match)
        current_size += size
    if current:
        batches.append(current)
    return batches


def canonical_document_outline(matches: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str]:
    """Return the persisted source hierarchy in document order, without LLM inference."""
    sections: list[dict[str, Any]] = []
    seen: set[tuple[int, str]] = set()
    for match in matches:
        path = [str(value).strip() for value in match.get('heading_path') or [] if str(value).strip()]
        section_key = str(match.get('section_key') or '')
        if not path or not section_key:
            continue
        identity = (match['document_id'], section_key)
        if identity in seen:
            continue
        seen.add(identity)
        sections.append({
            'document_id': match['document_id'],
            'document_name': match['document_name'],
            'section_key': section_key,
            'path': path,
            'source_locator': match.get('source_locator'),
        })
    lines = [
        f'- {section["document_name"]}: {" > ".join(section["path"])}'
        + (f' ({section["source_locator"]})' if section.get('source_locator') else '')
        for section in sections
    ]
    return sections, '\n'.join(lines)


def structure_aware_context_batches(matches: list[dict[str, Any]], max_characters: int = 60000) -> list[list[dict[str, Any]]]:
    """Prefer section boundaries while retaining the bounded provider context size."""
    if not any(match.get('section_key') for match in matches):
        return context_batches(matches) if max_characters == 60000 else context_batches(matches, max_characters)
    batches: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    current_size = 0
    current_section = None
    for match in matches:
        size = len(match['content']) + 160
        section = (match['document_id'], match.get('section_key'))
        section_changed = current_section is not None and section != current_section
        if current and current_size + size > max_characters and section_changed:
            batches.append(current)
            current, current_size = [], 0
        elif current and current_size + size > max_characters * 1.25:
            batches.append(current)
            current, current_size = [], 0
        current.append(match)
        current_size += size
        current_section = section
    if current:
        batches.append(current)
    return batches


def mindmap_draft_stats(node: MindmapDraftNode) -> tuple[int, int, list[str]]:
    """Return total nodes, maximum depth and normalized labels for quality checks."""
    child_stats = [mindmap_draft_stats(child) for child in node.children]
    count = 1 + sum(item[0] for item in child_stats)
    depth = 1 + max((item[1] for item in child_stats), default=0)
    labels = [re.sub(r'\W+', ' ', node.label, flags=re.UNICODE).strip().casefold()]
    for _, _, child_labels in child_stats:
        labels.extend(child_labels)
    return count, depth, labels


def mindmap_path_contract(max_depth: int) -> str:
    """Describe the flat path contract used to obtain reliable multi-level provider output."""
    return (
        '\nHIERARCHY OUTPUT CONTRACT:\n'
        '- Return a flat items array, not nested children. Each item.path is the full hierarchy from a main branch '
        'to one supported subtopic, for example ["Chapter II", "Dialectics", "Quantity and quality"].\n'
        f'- Use paths of 1-{max(1, max_depth - 1)} segments so the final tree, including its root, has at most '
        f'{max_depth} levels.\n'
        '- Reuse exactly the same spelling for shared path prefixes so the server can merge them into one branch.\n'
        '- Include separate paths for meaningful definitions, relationships, examples, formulas and conclusions; '
        'do not return only chapter-heading paths when supporting detail exists.\n'
        '- Every item must contain citation_indexes supporting that complete path. The server constructs the nested tree.'
    )


def mindmap_has_duplicate_siblings(node: MindmapDraftNode) -> bool:
    """Treat duplicate labels as ambiguous only within the same parent branch."""
    labels = [re.sub(r'\W+', ' ', child.label, flags=re.UNICODE).strip().casefold() for child in node.children]
    if len(labels) != len(set(labels)):
        return True
    return any(mindmap_has_duplicate_siblings(child) for child in node.children)


def mindmap_quality_issues(
    draft: MindmapDraft,
    request: MindmapGenerationRequest,
    evidence_count: int,
    outline_node_count: int | None = None,
    expected_branches: list[str] | None = None,
) -> list[str]:
    """Evaluate useful coverage without treating the requested node count as an exact quota."""
    node_count, actual_depth, labels = mindmap_draft_stats(draft.root)
    if request.scope_mode == 'whole_document':
        evidence_goal = max(12, min(request.target_node_count, outline_node_count or request.target_node_count))
        minimum_nodes = max(8, round(evidence_goal * .6))
    else:
        evidence_goal = max(4, min(request.target_node_count, 1 + evidence_count * 2))
        minimum_nodes = max(4, round(evidence_goal * .5))

    issues: list[str] = []
    if len(draft.root.children) < 2:
        issues.append('the root has fewer than two meaningful main branches')
    if node_count < minimum_nodes:
        issues.append(f'the map has only {node_count} nodes; the available evidence supports at least about {minimum_nodes}')
    expected_depth = min(request.depth, 3) if evidence_goal >= 8 else 2
    if actual_depth < expected_depth:
        issues.append(f'the map depth is {actual_depth}; the evidence supports at least {expected_depth} levels')
    detailed_branches = sum(bool(child.children) for child in draft.root.children)
    if len(draft.root.children) >= 2 and evidence_goal >= 8 and detailed_branches < min(2, len(draft.root.children)):
        issues.append('major branches only name headings and do not contain supporting subtopics')
    if mindmap_has_duplicate_siblings(draft.root):
        issues.append('the hierarchy contains duplicate labels under the same parent branch')
    if expected_branches:
        normalize = lambda value: re.sub(r'\W+', ' ', value, flags=re.UNICODE).strip().casefold()
        actual = {normalize(child.label) for child in draft.root.children}
        expected = [normalize(value) for value in expected_branches]
        covered = sum(value in actual for value in expected)
        required = len(expected) if len(expected) <= 12 else max(1, round(len(expected) * .8))
        if covered < required:
            issues.append(
                f'the root preserves only {covered}/{len(expected)} canonical top-level document sections; '
                f'at least {required} are required in source order'
            )
    return issues


def build_whole_document_outline(
    *, topic: str, difficulty: str, depth: int, matches: list[dict[str, Any]], cache_namespace: str = 'document-outline',
) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
    """Map every consecutive source batch into a grounded reusable document outline."""
    canonical_sections, canonical_outline = canonical_document_outline(matches)
    batches = structure_aware_context_batches(matches)
    outline_sections: list[str] = []
    evidence_matches: list[dict[str, Any]] = []
    evidence_indexes: dict[str, int] = {}
    cached_batches = 0
    citation_repair_batches = 0
    outline_node_count = 0

    for batch_number, batch in enumerate(batches, start=1):
        context = '\n\n'.join(
            f'[Source {index}] {match["document_name"]} — {match.get("source_locator") or "unknown location"}'
            f'\n[Hierarchy] {" > ".join(match.get("heading_path") or []) or "not detected"}\n{match["content"]}'
            for index, match in enumerate(batch, start=1)
        )
        instruction = (
            'Analyze this consecutive section of a teaching document and create a detailed Vietnamese knowledge outline. '
            'This outline will be reused to produce several learning-object types; it is not the final output.\n'
            f'- Requested theme: {topic} | Difficulty: {difficulty}.\n'
            f'- Batch {batch_number}/{len(batches)}; use up to {min(max(depth, 3), 4)} hierarchy levels.\n'
            '- Preserve every supported chapter/section heading and expand it with definitions, arguments, relationships, '
            'formulas, examples, and conclusions found in this batch.\n'
            '- Do not merely list chapter names. When the source is substantive, produce a useful multi-level outline '
            'with roughly 6-16 nodes; use fewer only when the batch truly contains little instructional content.\n'
            '- Every node must cite supplied Source numbers only. Do not invent facts or omit a major heading.\n\n'
            + (f'Canonical source outline (preserve these paths and order):\n{canonical_outline}\n\n' if canonical_outline else '')
            + f'{mindmap_path_contract(min(max(depth, 3), 4))}\n\nSource chunks:\n{context}'
        )
        raw_path_draft, was_cached, citation_repaired = grounded_generation_cached(
            instruction,
            MindmapPathDraft,
            f'{cache_namespace}-map-{batch_number}',
            len(batch),
            f'mindmap outline batch {batch_number}',
        )
        cached_batches += int(was_cached)
        citation_repair_batches += int(citation_repaired)
        draft = mindmap_path_draft_to_tree(MindmapPathDraft.model_validate(raw_path_draft))
        outline_node_count += mindmap_draft_stats(draft.root)[0]
        lines: list[str] = []
        for child in draft.root.children or [draft.root]:
            lines.extend(draft_node_evidence_lines(child, batch, evidence_matches, evidence_indexes))
        outline_sections.append(f'[Batch outline {batch_number}]\n' + '\n'.join(lines))

    return '\n\n'.join(outline_sections), evidence_matches, {
        'batch_count': len(batches),
        'cached_batch_count': cached_batches,
        'citation_repair_batch_count': citation_repair_batches,
        'outline_node_count': outline_node_count,
        'canonical_section_count': len(canonical_sections),
        'canonical_outline': canonical_outline,
        'canonical_branches': list(dict.fromkeys(
            section['path'][0] for section in canonical_sections if section.get('path')
        )),
        'structure_source': 'persisted_outline' if canonical_sections else 'provider_inferred',
    }


def repair_mindmap_if_needed(
    draft: MindmapDraft,
    request: MindmapGenerationRequest,
    matches: list[dict[str, Any]],
    grounded_context: str,
    stage: str,
    outline_node_count: int | None = None,
    expected_branches: list[str] | None = None,
) -> tuple[MindmapDraft, bool]:
    issues = mindmap_quality_issues(draft, request, len(matches), outline_node_count, expected_branches)
    if not issues:
        return draft, False
    LOGGER.warning('Mindmap quality repair requested stage=%s issues=%s', stage, '; '.join(issues))

    current_node_count, current_depth, _ = mindmap_draft_stats(draft.root)
    maximum_path_items = min(120, max(16, round(request.target_node_count * 1.5)))
    repair_instruction = (
        'Repair the Vietnamese mindmap below using only the grounded evidence. Preserve correct content and citations, '
        'but expand missing instructional detail and remove duplicates. The requested node count is a planning guide, '
        'not an exact quota: include as many nodes as the evidence genuinely needs.\n'
        f'- Theme: {request.topic} | Difficulty: {request.difficulty} | Maximum depth: {request.depth}.\n'
        f'- Quality problems detected by the server: {"; ".join(issues)}.\n'
        f'- The current draft has {current_node_count} nodes at depth {current_depth}. Primarily regroup and enrich that '
        f'evidence-backed structure; return no more than {maximum_path_items} hierarchy paths. This is a usability '
        'guardrail, not a demand to produce exactly that many items.\n'
        '- Every major branch must contain its supported subtopics, and every node must use valid citation_indexes from '
        'the numbered evidence. Never invent filler merely to increase the count.\n\n'
        + (f'- Preserve these canonical root branches exactly and in source order: {json.dumps(expected_branches, ensure_ascii=False)}.\n\n' if expected_branches else '')
        + f'Current mindmap JSON:\n{json.dumps(draft.model_dump(), ensure_ascii=False)}\n\n'
        + f'{mindmap_path_contract(request.depth)}\n\nGrounded evidence:\n{grounded_context}'
    )

    def quality_validator(model: BaseModel) -> None:
        if not isinstance(model, MindmapPathDraft):
            raise TypeError('Mindmap quality validation requires MindmapPathDraft.')
        candidate = mindmap_path_draft_to_tree(model)
        remaining = mindmap_quality_issues(candidate, request, len(matches), outline_node_count, expected_branches)
        if remaining:
            LOGGER.warning('Mindmap quality repair rejected stage=%s issues=%s', stage, '; '.join(remaining))
            raise PipelineError(
                'LEARNING_OBJECT_QUALITY_INSUFFICIENT',
                'Gemini returned a mindmap that does not adequately cover the available source structure.',
                'quality_validation',
                502,
            )

    repaired_raw, _, _ = grounded_generation_cached(
        repair_instruction,
        MindmapPathDraft,
        f'{stage}-quality-repair',
        len(matches),
        'mindmap quality repair',
        quality_validator,
    )
    repaired = mindmap_path_draft_to_tree(MindmapPathDraft.model_validate(repaired_raw))
    remaining = mindmap_quality_issues(repaired, request, len(matches), outline_node_count)
    if remaining:
        LOGGER.warning('Mindmap quality repair failed post-validation stage=%s issues=%s', stage, '; '.join(remaining))
        raise PipelineError(
            'LEARNING_OBJECT_QUALITY_INSUFFICIENT',
            'Gemini returned a mindmap that does not adequately cover the available source structure.',
            'quality_validation',
            502,
        )
    return repaired, True


def whole_document_generation_context(
    *, course_id: int, document_ids: list[int], topic: str, difficulty: str, object_type: str,
) -> tuple[list[dict[str, Any]], str, dict[str, Any]]:
    all_matches = document_collection_matches(course_id, document_ids)
    if not all_matches:
        raise PipelineError('NO_GROUNDED_CONTEXT', 'The selected documents do not contain processed chunks.', 'generation', 422)
    outline, evidence_matches, outline_meta = build_whole_document_outline(
        topic=topic,
        difficulty=difficulty,
        depth=4,
        matches=all_matches,
        cache_namespace='shared-document-outline',
    )
    if not evidence_matches:
        raise PipelineError('NO_GROUNDED_CONTEXT', 'The document outline contains no grounded evidence.', 'generation', 422)
    return evidence_matches, outline, {
        'query': topic,
        'scope_mode': 'whole_document',
        'match_count': len(all_matches),
        'evidence_count': len(evidence_matches),
        'document_count': len({match['document_id'] for match in all_matches}),
        'batch_count': outline_meta['batch_count'],
        'cached_batch_count': outline_meta['cached_batch_count'],
        'citation_repair_batch_count': outline_meta['citation_repair_batch_count'],
        'outline_node_count': outline_meta['outline_node_count'],
        'canonical_section_count': outline_meta['canonical_section_count'],
        'canonical_branches': outline_meta['canonical_branches'],
        'structure_source': outline_meta['structure_source'],
        'embedding_model': EMBEDDING_MODEL,
        'collection': COLLECTION_NAME,
        'learning_object_type': object_type,
    }


def generated_item_quality_issues(
    labels: list[str], citation_groups: list[list[int]], requested_count: int, available_evidence: int,
) -> list[str]:
    """Check semantic breadth without requiring every available source to be cited."""
    normalized = [re.sub(r'\W+', ' ', label, flags=re.UNICODE).strip().casefold() for label in labels]
    issues: list[str] = []
    if len(labels) != requested_count:
        issues.append(f'expected {requested_count} items but received {len(labels)}')
    if len(set(normalized)) != len(normalized):
        issues.append('items contain duplicate or near-identical titles/prompts')
    cited = {index for group in citation_groups for index in group}
    minimum_sources = min(max(1, available_evidence), max(2, min(requested_count, 4)))
    if len(cited) < minimum_sources:
        issues.append(f'items rely on only {len(cited)} evidence locations; use at least {minimum_sources} when supported')
    return issues


def repair_structured_items_if_needed(
    *, draft: BaseModel, schema: type[BaseModel], issues: list[str], instruction: str, stage: str,
    quality_check: Any, available_sources: int, object_name: str,
) -> tuple[BaseModel, bool]:
    if not issues:
        return draft, False
    repair_instruction = (
        f'{instruction}\n\nThe server rejected the first draft for these quality reasons: {"; ".join(issues)}.\n'
        'Repair the draft while staying strictly grounded. Preserve useful items, remove repetition, and broaden evidence '
        'coverage across the supplied sections. Return the required JSON schema only.\n\n'
        f'First draft JSON:\n{json.dumps(draft.model_dump(), ensure_ascii=False)}'
    )
    raw, _, _ = grounded_generation_cached(
        repair_instruction,
        schema,
        f'{stage}-quality-repair',
        available_sources,
        f'{object_name} quality repair',
    )
    repaired = schema.model_validate(raw)
    if quality_check(repaired):
        raise PipelineError(
            'LEARNING_OBJECT_QUALITY_INSUFFICIENT',
            'Gemini returned learning material that does not adequately cover the available evidence.',
            'quality_validation',
            502,
        )
    return repaired, True


def draft_node_evidence_lines(
    node: MindmapDraftNode,
    batch: list[dict[str, Any]],
    evidence_matches: list[dict[str, Any]],
    evidence_indexes: dict[str, int],
    depth: int = 0,
) -> list[str]:
    """Render map output while preserving an authoritative source index for every node."""
    node_evidence: list[int] = []
    for source_index in dict.fromkeys(node.citation_indexes):
        if source_index < 1 or source_index > len(batch):
            raise PipelineError(
                'UNGROUNDABLE_CITATION',
                'Gemini returned a map-stage citation outside its source batch.',
                'generation',
                502,
            )
        match = batch[source_index - 1]
        vector_id = str(match['vector_id'])
        if vector_id not in evidence_indexes:
            evidence_matches.append(match)
            evidence_indexes[vector_id] = len(evidence_matches)
        node_evidence.append(evidence_indexes[vector_id])

    evidence_label = ','.join(str(value) for value in node_evidence)
    lines = [f'{"  " * depth}- [Evidence {evidence_label}] {node.label}']
    for child in node.children:
        lines.extend(draft_node_evidence_lines(
            child, batch, evidence_matches, evidence_indexes, depth + 1,
        ))
    return lines


def generate_whole_document_mindmap(request: MindmapGenerationRequest) -> dict[str, Any]:
    matches = document_collection_matches(request.course_id, request.document_ids)
    if not matches:
        raise PipelineError('NO_GROUNDED_CONTEXT', 'The selected documents do not contain processed chunks.', 'generation', 422)

    outline_context, evidence_matches, outline_meta = build_whole_document_outline(
        topic=request.topic, difficulty=request.difficulty, depth=request.depth, matches=matches,
        cache_namespace='shared-document-outline',
    )
    canonical_requirement = (
        '- The following persisted hierarchy is authoritative. Use its top-level headings verbatim as root branches, '
        'in the same order; enrich below them rather than replacing them with conceptual categories:\n'
        f'{outline_meta["canonical_outline"]}\n'
    ) if outline_meta['canonical_outline'] else ''
    reduce_instruction = (
        'Create the final Vietnamese whole-document mindmap by merging all numbered section outlines below.\n'
        f'- Theme: {request.topic} | Difficulty: {request.difficulty} | Maximum depth: {request.depth}.\n'
        f'- Use approximately {request.target_node_count} nodes only as a planning guide. The real requirement is to '
        'represent every supported major chapter and the meaningful subtopics needed to understand it.\n'
        '- Preserve the document hierarchy and order where pedagogically meaningful. Merge duplicates, but retain every major chapter.\n'
        + canonical_requirement
        + '- Each node must cite one or more valid Evidence numbers shown in brackets as citation_indexes. Never invent an index.\n'
        '- Do not stop at a flat list of chapter names. Expand major branches with supported definitions, arguments, '
        'relationships, examples, formulas, and conclusions.\n'
        '- Labels must be concise but specific. Do not invent filler to reach a numeric target.\n'
        '- Do not add knowledge absent from the outlines.\n\n'
        f'{mindmap_path_contract(request.depth)}\n\nSection outlines:\n{outline_context}'
    )
    raw_final_paths, final_cached, final_citation_repaired = grounded_generation_cached(
        reduce_instruction,
        MindmapPathDraft,
        'mindmap-reduce',
        len(evidence_matches),
        'whole-document mindmap',
    )
    final_draft = mindmap_path_draft_to_tree(MindmapPathDraft.model_validate(raw_final_paths))
    final_draft, repaired = repair_mindmap_if_needed(
        final_draft, request, evidence_matches, outline_context, 'whole-document-mindmap',
        outline_meta['outline_node_count'], outline_meta['canonical_branches'],
    )
    root = normalize_mindmap_node(final_draft.root, evidence_matches, [], request.depth)
    payload = MindmapPayload(
        title=final_draft.title,
        description=final_draft.description,
        root=root,
        markdown='\n'.join(mindmap_markdown(root)),
    )
    return {
        'mindmap': payload.model_dump(),
        'retrieval': {
            'query': request.topic,
            'scope_mode': 'whole_document',
            'match_count': len(matches),
            'document_count': len({match['document_id'] for match in matches}),
            'batch_count': outline_meta['batch_count'],
            'cached_batch_count': outline_meta['cached_batch_count'],
            'citation_repair_batch_count': outline_meta['citation_repair_batch_count'],
            'reduce_cache_hit': final_cached,
            'citation_repair_applied': final_citation_repaired or outline_meta['citation_repair_batch_count'] > 0,
            'quality_repair_applied': repaired,
            'outline_node_count': outline_meta['outline_node_count'],
            'canonical_section_count': outline_meta['canonical_section_count'],
            'structure_source': outline_meta['structure_source'],
            'embedding_model': EMBEDDING_MODEL,
            'collection': COLLECTION_NAME,
        },
        'generation_model': GENERATION_MODEL,
    }


def generate_whole_document_quiz(request: QuizGenerationRequest) -> dict[str, Any]:
    matches, outline, retrieval = whole_document_generation_context(
        course_id=request.course_id, document_ids=request.document_ids, topic=request.topic,
        difficulty=request.difficulty, object_type='quiz',
    )
    instruction = (
        'Create a Vietnamese single-choice quiz from the complete grounded document outline below.\n'
        f'- Topic: {request.topic} | Difficulty: {request.difficulty} | Questions: {request.question_count}.\n'
        '- Distribute questions across distinct major sections instead of repeatedly testing one definition. Difficulty must '
        'change the cognitive work: easy recalls, medium applies/explains, hard compares or reasons across supported ideas.\n'
        '- Each question has exactly four distinct options, one correct_index, an evidence-backed explanation, and valid '
        'citation_indexes referencing [Evidence] numbers. Do not invent knowledge or citations.\n'
        '- Return exactly the requested number of questions, but prioritize meaningful curricular coverage over superficial wording variation.\n\n'
        f'Complete document outline:\n{outline}'
    )
    raw, cache_hit, citation_repaired = grounded_generation_cached(
        instruction, QuizDraft, 'whole-document-quiz', len(matches), 'whole-document quiz',
    )
    draft = QuizDraft.model_validate(raw)

    def quality(candidate: QuizDraft) -> list[str]:
        issues = generated_item_quality_issues(
            [item.question for item in candidate.questions],
            [item.citation_indexes for item in candidate.questions],
            request.question_count,
            len(matches),
        )
        if any(index < 1 or index > len(matches) for item in candidate.questions for index in item.citation_indexes):
            issues.append('one or more citations are outside the grounded evidence set')
        if any(len({option.strip().casefold() for option in item.options}) != 4 for item in candidate.questions):
            issues.append('one or more questions do not have four distinct options')
        return issues

    draft, repaired = repair_structured_items_if_needed(
        draft=draft, schema=QuizDraft, issues=quality(draft), instruction=instruction,
        stage='whole-document-quiz', quality_check=quality,
        available_sources=len(matches), object_name='quiz',
    )
    output = QuizOutput(
        title=draft.title,
        description=draft.description,
        questions=[QuizQuestionOutput(
            question=item.question.strip(), options=[option.strip() for option in item.options],
            correct_index=item.correct_index, explanation=item.explanation.strip(),
            citations=authoritative_citations(item.citation_indexes, matches, 'quiz'),
        ) for item in draft.questions],
    )
    retrieval.update({
        'final_cache_hit': cache_hit,
        'citation_repair_applied': citation_repaired,
        'quality_repair_applied': repaired,
    })
    return {'quiz': output.model_dump(), 'retrieval': retrieval, 'generation_model': GENERATION_MODEL}


def generate_whole_document_flashcards(request: FlashcardGenerationRequest) -> dict[str, Any]:
    matches, outline, retrieval = whole_document_generation_context(
        course_id=request.course_id, document_ids=request.document_ids, topic=request.topic,
        difficulty=request.difficulty, object_type='flashcard',
    )
    instruction = (
        'Create Vietnamese retrieval-practice flashcards from the complete grounded document outline below.\n'
        f'- Topic: {request.topic} | Difficulty: {request.difficulty} | Cards: {request.card_count}.\n'
        '- Cover distinct major sections and a balanced mix of concepts, relationships, formulas, and applications. '
        'Do not create several cards that test the same fact with different wording.\n'
        '- front is a concise recall prompt, back is a complete answer, hint aids recall without revealing the answer, '
        'and citation_indexes must reference valid [Evidence] numbers only.\n'
        '- Return exactly the requested card count and remain strictly grounded.\n\n'
        f'Complete document outline:\n{outline}'
    )
    raw, cache_hit, citation_repaired = grounded_generation_cached(
        instruction, FlashcardDraft, 'whole-document-flashcard', len(matches), 'whole-document flashcard',
    )
    draft = FlashcardDraft.model_validate(raw)

    def quality(candidate: FlashcardDraft) -> list[str]:
        issues = generated_item_quality_issues(
            [item.front for item in candidate.cards], [item.citation_indexes for item in candidate.cards],
            request.card_count, len(matches),
        )
        if any(index < 1 or index > len(matches) for item in candidate.cards for index in item.citation_indexes):
            issues.append('one or more citations are outside the grounded evidence set')
        return issues

    draft, repaired = repair_structured_items_if_needed(
        draft=draft, schema=FlashcardDraft, issues=quality(draft), instruction=instruction,
        stage='whole-document-flashcard', quality_check=quality,
        available_sources=len(matches), object_name='flashcard',
    )
    cards = [FlashcardCardOutput(
        id=index, front=item.front.strip(), back=item.back.strip(), hint=item.hint.strip(),
        citations=authoritative_citations(item.citation_indexes, matches, 'flashcard'),
    ) for index, item in enumerate(draft.cards, start=1)]
    retrieval.update({
        'final_cache_hit': cache_hit,
        'citation_repair_applied': citation_repaired,
        'quality_repair_applied': repaired,
    })
    return {
        'flashcards': FlashcardOutput(title=draft.title, description=draft.description, cards=cards).model_dump(),
        'retrieval': retrieval,
        'generation_model': GENERATION_MODEL,
    }


def generate_whole_document_slides(request: SlideGenerationRequest) -> dict[str, Any]:
    matches, outline, retrieval = whole_document_generation_context(
        course_id=request.course_id, document_ids=request.document_ids, topic=request.topic,
        difficulty=request.difficulty, object_type='slide',
    )
    instruction = (
        'Create a coherent Vietnamese lecture slide deck from the complete grounded document outline below.\n'
        f'- Topic: {request.topic} | Difficulty: {request.difficulty} | Slides: {request.slide_count}.\n'
        '- Build a teaching sequence that covers distinct major sections: orientation, key concepts and relationships, '
        'supported applications/examples, then synthesis. Do not repeat one concept across multiple slides.\n'
        '- Every slide needs 3-5 concise bullet_points, useful speaker_notes, and valid citation_indexes referencing '
        '[Evidence] numbers. Use title layout first, summary last, and bullet_points between them.\n'
        '- Return exactly the requested slide count and remain strictly grounded.\n\n'
        f'Complete document outline:\n{outline}'
    )
    raw, cache_hit, citation_repaired = grounded_generation_cached(
        instruction, SlideDraft, 'whole-document-slides', len(matches), 'whole-document slides',
    )
    draft = SlideDraft.model_validate(raw)

    def quality(candidate: SlideDraft) -> list[str]:
        issues = generated_item_quality_issues(
            [item.title for item in candidate.slides], [item.citation_indexes for item in candidate.slides],
            request.slide_count, len(matches),
        )
        if any(index < 1 or index > len(matches) for item in candidate.slides for index in item.citation_indexes):
            issues.append('one or more citations are outside the grounded evidence set')
        return issues

    draft, repaired = repair_structured_items_if_needed(
        draft=draft, schema=SlideDraft, issues=quality(draft), instruction=instruction,
        stage='whole-document-slides', quality_check=quality,
        available_sources=len(matches), object_name='slide',
    )
    slides = [SlideItem(
        slide_number=index, title=item.title.strip(), layout=item.layout,
        bullet_points=[point.strip() for point in item.bullet_points], speaker_notes=item.speaker_notes.strip(),
        citations=authoritative_citations(item.citation_indexes, matches, 'slide'),
    ) for index, item in enumerate(draft.slides, start=1)]
    retrieval.update({
        'final_cache_hit': cache_hit,
        'citation_repair_applied': citation_repaired,
        'quality_repair_applied': repaired,
    })
    return {
        'slides': SlidePayload(title=draft.title, description=draft.description, slides=slides).model_dump(),
        'retrieval': retrieval,
        'generation_model': GENERATION_MODEL,
    }


@APP.post('/internal/v1/learning-objects/generate-flashcards', dependencies=[Depends(require_service_token)])
def generate_flashcards(request: FlashcardGenerationRequest) -> dict[str, Any]:
    if request.scope_mode == 'whole_document':
        return generate_whole_document_flashcards(request)
    retrieved = search_collection(SearchRequest(
        course_id=request.course_id,
        query=request.topic,
        top_k=request.top_k,
        document_ids=request.document_ids,
    ))
    matches = limit_matches_to_source_pages(retrieved['matches'], request.max_pages)
    if not matches:
        raise PipelineError('NO_GROUNDED_CONTEXT', 'No processed chunks matched this flashcard topic.', 'generation', 422)

    context = '\n\n'.join(f'[Source {index}] {match["content"]}' for index, match in enumerate(matches, start=1))
    instruction = (
        'Create Vietnamese study flashcards using only the numbered source chunks below.\n'
        f'- Topic: {request.topic}\n'
        f'- Card count: {request.card_count} | Difficulty: {request.difficulty}\n'
        f'- Context is limited to at most {request.max_pages} distinct source pages or locators.\n\n'
        'REQUIREMENTS:\n'
        '1. Each card must test one useful concept, definition, theorem, formula, or relationship grounded in the supplied sources.\n'
        '2. front must be a concise retrieval question or concept prompt; back must be a complete, self-contained answer.\n'
        '3. hint must help recall without revealing the full answer.\n'
        '4. Every card must contain valid citation_indexes referencing the supporting [Source] numbers; never invent a source number.\n'
        '5. Correct malformed technical notation and wrap every mathematical expression in standard LaTeX $...$ or $$...$$.\n'
        '6. Avoid duplicate cards, distribute cards across distinct supported concepts, and return exactly the requested number of cards.\n\n'
        f'Source chunks:\n{context}'
    )
    raw_draft, citation_repaired = grounded_generation_direct(
        instruction,
        FlashcardDraft,
        len(matches),
        'topic flashcard',
        'FLASHCARD_GENERATION_FAILED',
        'Gemini could not generate valid flashcards.',
    )
    draft = FlashcardDraft.model_validate(raw_draft)

    if len(draft.cards) != request.card_count:
        raise PipelineError('FLASHCARD_SCHEMA_INVALID', 'Gemini returned a different number of cards than requested.', 'generation', 502)
    normalized_fronts = [card.front.strip().casefold() for card in draft.cards]
    if len(set(normalized_fronts)) != len(normalized_fronts):
        raise PipelineError('FLASHCARD_SCHEMA_INVALID', 'Gemini returned duplicate flashcards.', 'generation', 502)

    output_cards: list[FlashcardCardOutput] = []
    for card_index, card in enumerate(draft.cards, start=1):
        if any(index < 1 or index > len(matches) for index in card.citation_indexes):
            raise PipelineError('UNGROUNDABLE_CITATION', 'Gemini returned a flashcard citation outside the retrieved source set.', 'generation', 502)
        selected_indexes = list(dict.fromkeys(card.citation_indexes))
        citations = [QuizCitation(
            vector_id=matches[index - 1]['vector_id'],
            source_locator=matches[index - 1]['source_locator'],
            document_id=matches[index - 1]['document_id'],
            document_name=matches[index - 1]['document_name'],
        ) for index in selected_indexes]
        output_cards.append(FlashcardCardOutput(
            id=card_index,
            front=card.front.strip(),
            back=card.back.strip(),
            hint=card.hint.strip(),
            citations=citations,
        ))

    output = FlashcardOutput(title=draft.title, description=draft.description, cards=output_cards)
    return {
        'flashcards': output.model_dump(),
        'retrieval': {
            'query': retrieved['query'],
            'match_count': len(matches),
            'max_pages': request.max_pages,
            'citation_repair_applied': citation_repaired,
            'embedding_model': retrieved['embedding_model'],
            'collection': retrieved['collection'],
        },
        'generation_model': GENERATION_MODEL,
    }


@APP.post('/internal/v1/learning-objects/generate-mindmap', dependencies=[Depends(require_service_token)])
def generate_mindmap(request: MindmapGenerationRequest) -> dict[str, Any]:
    if request.scope_mode == 'whole_document':
        return generate_whole_document_mindmap(request)
    retrieved = search_collection(SearchRequest(
        course_id=request.course_id, query=request.topic, top_k=request.top_k, document_ids=request.document_ids,
    ))
    matches = limit_matches_to_source_pages(retrieved['matches'], request.max_pages)
    if not matches:
        raise PipelineError('NO_GROUNDED_CONTEXT', 'No processed chunks matched this mindmap topic.', 'generation', 422)
    context = '\n\n'.join(
        f'[Source {index}] [Hierarchy] {" > ".join(match.get("heading_path") or []) or "not detected"}\n{match["content"]}'
        for index, match in enumerate(matches, start=1)
    )
    topic_branches = list(dict.fromkeys(
        match['heading_path'][0] for match in matches if match.get('heading_path')
    ))
    structure_requirement = (
        '6. Preserve these relevant source hierarchy branches verbatim and in source order: '
        f'{json.dumps(topic_branches, ensure_ascii=False)}. Add concepts below them.\n\n'
    ) if topic_branches else ''
    instruction = (
        'Create a Vietnamese hierarchical knowledge mindmap using only the numbered source chunks below.\n'
        f'- Topic: {request.topic} | Difficulty: {request.difficulty} | Maximum tree depth: {request.depth}\n'
        f'- Context is limited to at most {request.max_pages} distinct source pages or locators.\n\n'
        'REQUIREMENTS:\n'
        '1. Return one meaningful root and 2-6 main branches. Expand each supported main branch with the definitions, '
        'relationships, examples, formulas, or implications required to understand it; never stop at a flat heading list when details exist. Never exceed the requested depth.\n'
        '2. Every node must include valid citation_indexes referencing its supporting [Source] numbers.\n'
        '3. Do not return node IDs or source metadata; the server assigns authoritative IDs and citations.\n'
        '4. Correct malformed notation and wrap mathematical expressions in standard LaTeX $...$ or $$...$$.\n'
        '5. Avoid duplicate branches and do not add facts absent from the context.\n\n'
        + structure_requirement
        + f'{mindmap_path_contract(request.depth)}\n\nSource chunks:\n{context}'
    )
    raw_draft, citation_repaired = grounded_generation_direct(
        instruction,
        MindmapPathDraft,
        len(matches),
        'topic mindmap',
        'MINDMAP_GENERATION_FAILED',
        'Gemini could not generate a valid mindmap.',
    )
    draft = mindmap_path_draft_to_tree(MindmapPathDraft.model_validate(raw_draft))

    draft, repaired = repair_mindmap_if_needed(
        draft, request, matches, context, 'topic-mindmap', None, topic_branches,
    )
    root = normalize_mindmap_node(draft.root, matches, [], request.depth)
    payload = MindmapPayload(
        title=draft.title, description=draft.description, root=root,
        markdown='\n'.join(mindmap_markdown(root)),
    )
    return {
        'mindmap': payload.model_dump(),
        'retrieval': {'query': retrieved['query'], 'scope_mode': 'topic', 'match_count': len(matches), 'max_pages': request.max_pages,
                      'citation_repair_applied': citation_repaired,
                      'quality_repair_applied': repaired,
                      'structure_source': 'persisted_outline' if topic_branches else 'provider_inferred',
                      'embedding_model': retrieved['embedding_model'], 'collection': retrieved['collection']},
        'generation_model': GENERATION_MODEL,
    }


@APP.post('/internal/v1/learning-objects/generate-slides', dependencies=[Depends(require_service_token)])
def generate_slides(request: SlideGenerationRequest) -> dict[str, Any]:
    if request.scope_mode == 'whole_document':
        return generate_whole_document_slides(request)
    retrieved = search_collection(SearchRequest(
        course_id=request.course_id, query=request.topic, top_k=request.top_k, document_ids=request.document_ids,
    ))
    matches = limit_matches_to_source_pages(retrieved['matches'], request.max_pages)
    if not matches:
        raise PipelineError('NO_GROUNDED_CONTEXT', 'No processed chunks matched this slide topic.', 'generation', 422)
    context = '\n\n'.join(f'[Source {index}] {match["content"]}' for index, match in enumerate(matches, start=1))
    instruction = (
        'Create a Vietnamese interactive lecture slide deck using only the numbered source chunks below.\n'
        f'- Topic: {request.topic} | Difficulty: {request.difficulty} | Slide count: {request.slide_count}\n'
        f'- Context is limited to at most {request.max_pages} distinct source pages or locators.\n\n'
        'REQUIREMENTS:\n'
        '1. Return exactly the requested number of slides in a coherent teaching sequence.\n'
        '2. Each slide has a concise title, 3-5 concise bullet_points, practical speaker_notes, and valid citation_indexes.\n'
        '3. Use title for the opening slide, summary for the final slide, and bullet_points for the remaining slides.\n'
        '4. Do not return source metadata; the server maps citation_indexes to authoritative retrieval metadata.\n'
        '5. Correct malformed notation and wrap mathematical expressions in standard LaTeX $...$ or $$...$$.\n'
        '6. Do not add facts absent from the context, and do not repeat the same concept across several slides.\n\n'
        f'Source chunks:\n{context}'
    )
    raw_draft, citation_repaired = grounded_generation_direct(
        instruction,
        SlideDraft,
        len(matches),
        'topic slide',
        'SLIDE_GENERATION_FAILED',
        'Gemini could not generate valid slides.',
    )
    draft = SlideDraft.model_validate(raw_draft)

    if len(draft.slides) != request.slide_count:
        raise PipelineError('SLIDE_SCHEMA_INVALID', 'Gemini returned a different number of slides than requested.', 'generation', 502)
    normalized_titles = [re.sub(r'\W+', ' ', item.title, flags=re.UNICODE).strip().casefold() for item in draft.slides]
    if len(set(normalized_titles)) != len(normalized_titles):
        raise PipelineError('SLIDE_SCHEMA_INVALID', 'Gemini returned duplicate slide topics.', 'generation', 502)
    slides = [SlideItem(
        slide_number=index,
        title=slide.title.strip(), layout=slide.layout,
        bullet_points=[point.strip() for point in slide.bullet_points],
        speaker_notes=slide.speaker_notes.strip(),
        citations=authoritative_citations(slide.citation_indexes, matches, 'slide'),
    ) for index, slide in enumerate(draft.slides, start=1)]
    payload = SlidePayload(title=draft.title, description=draft.description, slides=slides)
    return {
        'slides': payload.model_dump(),
        'retrieval': {'query': retrieved['query'], 'match_count': len(matches), 'max_pages': request.max_pages,
                      'citation_repair_applied': citation_repaired,
                      'embedding_model': retrieved['embedding_model'], 'collection': retrieved['collection']},
        'generation_model': GENERATION_MODEL,
    }


@APP.delete('/internal/v1/documents/{document_id}/vectors', dependencies=[Depends(require_service_token)])
def delete_document_vectors(document_id: int) -> dict[str, Any]:
    try:
        chroma_collection().delete(where={'document_id': str(document_id)})
        chroma_staging_collection().delete(where={'document_id': str(document_id)})
    except PipelineError:
        raise
    except Exception as exc:
        raise PipelineError('VECTOR_DELETE_FAILED', 'ChromaDB could not remove the document vectors.', 'cleanup', 503) from exc
    return {'deleted': True, 'document_id': document_id}


@APP.delete('/internal/v1/courses/{course_id}/vectors', dependencies=[Depends(require_service_token)])
def delete_course_vectors(course_id: int) -> dict[str, Any]:
    try:
        chroma_collection().delete(where={'course_id': str(course_id)})
        chroma_staging_collection().delete(where={'course_id': str(course_id)})
    except PipelineError:
        raise
    except Exception as exc:
        raise PipelineError('VECTOR_DELETE_FAILED', 'ChromaDB could not remove the course vectors.', 'cleanup', 503) from exc
    return {'deleted': True, 'course_id': course_id}


@APP.delete('/internal/v1/documents/{document_id}/processing-runs/{processing_run_id}/vectors', dependencies=[Depends(require_service_token)])
def delete_processing_run_vectors(document_id: int, processing_run_id: int) -> dict[str, Any]:
    """Compensate a Laravel persistence failure without deleting the last known-good run."""
    try:
        chroma_collection().delete(where={'$and': [
            {'document_id': str(document_id)},
            {'processing_run_id': str(processing_run_id)},
        ]})
    except PipelineError:
        raise
    except Exception as exc:
        raise PipelineError('VECTOR_DELETE_FAILED', 'ChromaDB could not remove the processing-run vectors.', 'cleanup', 503) from exc
    return {'deleted': True, 'document_id': document_id, 'processing_run_id': processing_run_id}


@APP.delete('/internal/v1/documents/{document_id}/processing-runs/{processing_run_id}/finalize/{checkpoint_id}', dependencies=[Depends(require_service_token)])
def finalize_document_ingestion(document_id: int, processing_run_id: int, checkpoint_id: str) -> dict[str, Any]:
    """Retire prior active versions only after Laravel has committed the new run."""
    try:
        active = chroma_collection()
        current_ids = set(active.get(where={'$and': [
            {'document_id': str(document_id)},
            {'processing_run_id': str(processing_run_id)},
        ]}, include=['metadatas']).get('ids', []))
        all_document_ids = active.get(where={'document_id': str(document_id)}, include=['metadatas']).get('ids', [])
        stale_active_ids = [value for value in all_document_ids if value not in current_ids]
        if stale_active_ids:
            active.delete(ids=stale_active_ids)
        chroma_staging_collection().delete(where={'$and': [
            {'document_id': str(document_id)},
            {'checkpoint_id': checkpoint_id},
        ]})
    except PipelineError:
        raise
    except Exception as exc:
        raise PipelineError('INGESTION_FINALIZE_FAILED', 'ChromaDB could not finalize the document ingestion.', 'cleanup', 503) from exc
    return {
        'finalized': True,
        'document_id': document_id,
        'processing_run_id': processing_run_id,
        'checkpoint_id': checkpoint_id,
        'retired_vector_count': len(stale_active_ids),
    }
