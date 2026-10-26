<?php

namespace App\Http\Controllers;

use App\Jobs\ProcessTeachingDocument;
use App\Models\Course;
use App\Models\DocumentProcessingRun;
use App\Models\TeachingDocument;
use App\Services\RagService;
use App\Services\RagServiceException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DocumentProcessingController
{
    public function start(Request $request, Course $course, TeachingDocument $document): JsonResponse
    {
        $this->ensureOwner($request, $course, $document);
        if ($document->processing_status === 'processing') {
            return response()->json(['message' => 'This document is already being processed.'], 422);
        }

        $data = $request->validate([
            'max_pages' => ['nullable', 'integer', 'min:1', 'max:500'],
        ]);

        $run = $this->queueRun($request, $document, $data['max_pages'] ?? null);
        return response()->json(['run' => $this->runSummary($run), 'message' => 'Document processing queued.'], 202);
    }

    public function retry(Request $request, Course $course, TeachingDocument $document, RagService $rag): JsonResponse
    {
        $this->ensureOwner($request, $course, $document);
        abort_unless($document->processing_status === 'failed', 422, 'Only a failed document can be retried.');

        try {
            $processingStatus = $rag->documentProcessingStatus($document);
        } catch (RagServiceException) {
            return response()->json([
                'message' => 'The AI processing service is temporarily unavailable. Please retry shortly.',
            ], 503);
        }
        if (($processingStatus['active'] ?? false) === true) {
            return response()->json([
                'message' => 'The previous AI processing request is still finishing. Please wait before retrying.',
            ], 409);
        }

        $data = $request->validate([
            'max_pages' => ['nullable', 'integer', 'min:1', 'max:500'],
        ]);

        $run = $this->queueRun($request, $document, $data['max_pages'] ?? null);
        return response()->json(['run' => $this->runSummary($run), 'message' => 'Document retry queued.'], 202);
    }

    public function show(Request $request, Course $course, TeachingDocument $document): JsonResponse
    {
        $this->ensureOwner($request, $course, $document);
        $document->load(['latestProcessingRun.extraction', 'latestProcessingRun.chunks.vectorReference']);
        return response()->json([
            'document' => $document,
            'run' => $document->latestProcessingRun ? $this->runSummary($document->latestProcessingRun, true) : null,
        ]);
    }

    public function search(Request $request, Course $course, RagService $rag): JsonResponse
    {
        $this->ensureCourseOwner($request, $course);
        $queryInput = $request->input('query') ?? $request->input('question');
        $request->merge(['query' => $queryInput]);

        $data = $request->validate([
            'query' => ['required', 'string', 'min:3', 'max:2000'],
            'top_k' => ['nullable', 'integer', 'min:1', 'max:10'],
            'document_ids' => ['nullable', 'array', 'max:50'],
            'document_ids.*' => ['integer'],
        ]);
        $documentIds = $data['document_ids'] ?? [];
        if ($documentIds !== [] && $course->documents()->whereIn('id', $documentIds)->count() !== count(array_unique($documentIds))) {
            return response()->json(['message' => 'One or more documents do not belong to this course.'], 422);
        }

        try {
            $results = $rag->search($course, $data['query'], $data['top_k'] ?? 5, $documentIds);
        } catch (RagServiceException $exception) {
            $message = in_array($exception->getCode(), [422, 429], true)
                ? $exception->getMessage()
                : 'RAG retrieval is temporarily unavailable.';
            return response()->json(['message' => $message], $exception->getCode());
        } catch (\RuntimeException $exception) {
            return response()->json(['message' => 'RAG retrieval is temporarily unavailable.'], 503);
        }
        return response()->json($results);
    }

    public function generateEvidence(Request $request, Course $course, RagService $rag): JsonResponse
    {
        $this->ensureCourseOwner($request, $course);
        $promptInput = $request->input('prompt') ?? $request->input('question') ?? $request->input('query');
        $request->merge(['prompt' => $promptInput]);

        $data = $request->validate([
            'prompt' => ['required', 'string', 'min:3', 'max:2000'],
            'top_k' => ['nullable', 'integer', 'min:1', 'max:10'],
        ]);
        try {
            return response()->json($rag->generateEvidence($course, $data['prompt'], $data['top_k'] ?? 5));
        } catch (RagServiceException $exception) {
            $message = in_array($exception->getCode(), [422, 429], true)
                ? $exception->getMessage()
                : 'Grounded evidence generation is temporarily unavailable.';
            return response()->json(['message' => $message], $exception->getCode());
        } catch (\RuntimeException $exception) {
            return response()->json(['message' => 'Grounded evidence generation is temporarily unavailable.'], 503);
        }
    }

    public function startDirect(Request $request, TeachingDocument $document): JsonResponse
    {
        return $this->start($request, $document->course, $document);
    }

    public function retryDirect(Request $request, TeachingDocument $document, RagService $rag): JsonResponse
    {
        return $this->retry($request, $document->course, $document, $rag);
    }

    private function queueRun(Request $request, TeachingDocument $document, ?int $maxPages = null): DocumentProcessingRun
    {
        $run = DB::transaction(function () use ($request, $document, $maxPages) {
            $document->refresh();
            $attempt = ((int) $document->processingRuns()->max('attempt_number')) + 1;
            $pipelineConfig = [
                'parser' => 'pypdf/python-docx',
                'chunking' => 'paragraph-window-v1',
                'embedding_model' => (string) config('rag.embedding_model', 'gemini-embedding-2'),
            ];
            if ($maxPages !== null && $maxPages > 0) {
                $pipelineConfig['max_pages'] = $maxPages;
            }
            $run = $document->processingRuns()->create([
                'requested_by' => $request->user()->id,
                'attempt_number' => $attempt,
                'status' => 'queued',
                'stage' => 'queued',
                'pipeline_config' => $pipelineConfig,
            ]);
            $document->update([
                'latest_processing_run_id' => $run->id,
                'processing_status' => 'processing',
                'processing_error' => null,
            ]);
            return $run;
        });

        ProcessTeachingDocument::dispatch($run->id);
        return $run;
    }

    private function runSummary(DocumentProcessingRun $run, bool $includeCounts = false): array
    {
        $summary = [
            'id' => $run->id,
            'attempt_number' => $run->attempt_number,
            'status' => $run->status,
            'stage' => $run->stage,
            'error_detail' => $run->error_detail,
            'started_at' => $run->started_at,
            'finished_at' => $run->finished_at,
            'created_at' => $run->created_at,
        ];
        if (isset($run->pipeline_config['ingestion_checkpoint'])) {
            $summary['ingestion_checkpoint'] = $run->pipeline_config['ingestion_checkpoint'];
            $summary['ingestion_cleanup_pending'] = (bool) ($run->pipeline_config['ingestion_cleanup_pending'] ?? false);
        }
        if ($includeCounts) {
            $summary['extraction'] = $run->extraction ? [
                'character_count' => $run->extraction->character_count,
                'page_count' => $run->extraction->page_count,
            ] : null;
            $summary['chunk_count'] = $run->chunks->count();
        }
        return $summary;
    }

    private function ensureOwner(Request $request, Course $course, TeachingDocument $document): void
    {
        abort_unless($document->course_id === $course->id, 404);
        $this->ensureCourseOwner($request, $course);
    }

    private function ensureCourseOwner(Request $request, Course $course): void
    {
        abort_unless($course->lecturer_id === $request->user()->id, 403);
    }
}
