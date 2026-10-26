<?php

namespace App\Services;

use App\Models\Course;
use App\Models\TeachingDocument;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

class RagService
{
    /**
     * Laravel remains the public authorization boundary. FastAPI is reachable only on the Docker network.
     */
    public function processDocument(TeachingDocument $document, int $runId, ?int $maxPages = null): array
    {
        $relativePath = $document->stored_path ?? $document->file_path;
        $path = storage_path('app/' . $relativePath);
        if (!file_exists($path)) {
            throw new \RuntimeException('The uploaded source file is no longer available in local storage.');
        }

        $stream = fopen($path, 'r');
        if ($stream === false) {
            throw new \RuntimeException('The uploaded source file is no longer available in local storage.');
        }

        try {
            $data = [
                'document_id' => (string) $document->id,
                'course_id' => (string) $document->course_id,
                'processing_run_id' => (string) $runId,
                'mime_type' => $document->mime_type ?? 'application/octet-stream',
                'extension' => $document->extension,
            ];
            if ($maxPages !== null && $maxPages > 0) {
                $data['max_pages'] = (string) $maxPages;
            }
            $response = $this->client()->attach('file', $stream, $document->original_name)->post('/internal/v1/documents/process', $data);
            if ($response->status() === 404) {
                rewind($stream);
                $response = $this->client()->attach('file', $stream, $document->original_name)->post('/process', $data);
            }
        } finally {
            if (is_resource($stream)) {
                fclose($stream);
            }
        }

        return $this->unwrap($response, 'document processing');
    }

    public function documentProcessingStatus(TeachingDocument $document): array
    {
        return $this->unwrap(
            $this->client(10)->get('/internal/v1/documents/'.$document->id.'/processing-status'),
            'document processing status'
        );
    }

    public function search(Course $course, string $query, int $topK, array $documentIds = []): array
    {
        return $this->unwrap($this->client()->asJson()->post('/internal/v1/retrieval/search', [
            'course_id' => $course->id,
            'query' => $query,
            'top_k' => $topK,
            'document_ids' => array_values($documentIds),
        ]), 'retrieval');
    }

    public function previewSources(Course $course, array $parameters): array
    {
        return $this->unwrap($this->client(30)->asJson()->post('/internal/v1/retrieval/source-preview', [
            'course_id' => $course->id,
            'topic' => $parameters['topic'],
            'learning_object_type' => $parameters['learning_object_type'] ?? 'quiz',
            'requested_count' => $parameters['requested_count'] ?? 5,
            'document_ids' => array_values($parameters['document_ids'] ?? []),
            'top_k' => $parameters['top_k'] ?? 5,
            'max_pages' => $parameters['max_pages'] ?? null,
            'scope_mode' => $parameters['scope_mode'] ?? 'topic',
        ]), 'source preview');
    }

    public function generateEvidence(Course $course, string $prompt, int $topK): array
    {
        return $this->unwrap($this->client()->asJson()->post('/internal/v1/evidence/generate', [
            'course_id' => $course->id,
            'prompt' => $prompt,
            'top_k' => $topK,
        ]), 'evidence generation');
    }

    public function generateQuiz(Course $course, array $parameters): array
    {
        $wholeDocument = ($parameters['scope_mode'] ?? 'topic') === 'whole_document';
        return $this->unwrap($this->client($wholeDocument ? 1500 : 120)->asJson()->post('/internal/v1/generation/quiz', [
            'course_id' => $course->id,
            'topic' => $parameters['topic'],
            'difficulty' => $parameters['difficulty'] ?? 'medium',
            'question_count' => $parameters['question_count'] ?? 5,
            'document_ids' => array_values($parameters['document_ids'] ?? []),
            'top_k' => $parameters['top_k'] ?? 5,
            'scope_mode' => $parameters['scope_mode'] ?? 'topic',
        ]), 'quiz generation');
    }

    public function generateFlashcards(Course $course, array $parameters): array
    {
        $wholeDocument = ($parameters['scope_mode'] ?? 'topic') === 'whole_document';
        return $this->unwrap($this->client($wholeDocument ? 1500 : 120)->asJson()->post('/internal/v1/learning-objects/generate-flashcards', [
            'course_id' => $course->id,
            'topic' => $parameters['topic'],
            'difficulty' => $parameters['difficulty'] ?? 'medium',
            'card_count' => $parameters['card_count'] ?? 10,
            'document_ids' => array_values($parameters['document_ids'] ?? []),
            'top_k' => $parameters['top_k'] ?? 5,
            'max_pages' => $parameters['max_pages'] ?? null,
            'scope_mode' => $parameters['scope_mode'] ?? 'topic',
        ]), 'flashcard generation');
    }

    public function generateMindmap(Course $course, array $parameters): array
    {
        $wholeDocument = ($parameters['scope_mode'] ?? 'topic') === 'whole_document';
        return $this->unwrap($this->client($wholeDocument ? 1500 : 120)->asJson()->post('/internal/v1/learning-objects/generate-mindmap', [
            'course_id' => $course->id,
            'topic' => $parameters['topic'],
            'difficulty' => $parameters['difficulty'] ?? 'medium',
            'depth' => $parameters['depth'] ?? 3,
            'document_ids' => array_values($parameters['document_ids'] ?? []),
            'top_k' => $parameters['top_k'] ?? 5,
            'max_pages' => $parameters['max_pages'] ?? null,
            'scope_mode' => $parameters['scope_mode'] ?? 'topic',
            'target_node_count' => $parameters['target_node_count'] ?? 30,
        ]), 'mindmap generation');
    }

    public function generateSlides(Course $course, array $parameters): array
    {
        $wholeDocument = ($parameters['scope_mode'] ?? 'topic') === 'whole_document';
        return $this->unwrap($this->client($wholeDocument ? 1500 : 120)->asJson()->post('/internal/v1/learning-objects/generate-slides', [
            'course_id' => $course->id,
            'topic' => $parameters['topic'],
            'difficulty' => $parameters['difficulty'] ?? 'medium',
            'slide_count' => $parameters['slide_count'] ?? 8,
            'document_ids' => array_values($parameters['document_ids'] ?? []),
            'top_k' => $parameters['top_k'] ?? 5,
            'max_pages' => $parameters['max_pages'] ?? null,
            'scope_mode' => $parameters['scope_mode'] ?? 'topic',
        ]), 'slide generation');
    }

    public function deleteDocumentVectors(TeachingDocument $document): void
    {
        $this->unwrap($this->client()->delete('/internal/v1/documents/'.$document->id.'/vectors'), 'vector cleanup');
    }

    public function deleteProcessingRunVectors(TeachingDocument $document, int $runId): void
    {
        $this->unwrap(
            $this->client()->delete('/internal/v1/documents/'.$document->id.'/processing-runs/'.$runId.'/vectors'),
            'processing-run vector cleanup'
        );
    }

    public function finalizeDocumentIngestion(TeachingDocument $document, int $runId, string $checkpointId): void
    {
        $this->unwrap(
            $this->client()->delete(
                '/internal/v1/documents/'.$document->id.'/processing-runs/'.$runId.'/finalize/'.rawurlencode($checkpointId)
            ),
            'document ingestion finalization'
        );
    }

    public function deleteCourseVectors(Course $course): void
    {
        $this->unwrap($this->client(30)->delete('/internal/v1/courses/'.$course->id.'/vectors'), 'course vector cleanup');
    }

    private function client(int $timeout = 600)
    {
        return Http::baseUrl(rtrim((string) (config('rag.url') ?? env('AI_SERVICE_URL', 'http://ai:8001')), '/'))
            ->acceptJson()
            ->withToken((string) (config('rag.token') ?? env('AI_SERVICE_TOKEN', '')))
            ->connectTimeout(5)
            ->timeout($timeout);
    }

    private function unwrap(Response $response, string $operation): array
    {
        if ($response->successful()) {
            return $response->json();
        }

        $error = $response->json('detail');
        $code = is_array($error) ? ($error['code'] ?? null) : null;
        if ($response->status() === 429 || $code === 'GEMINI_RATE_LIMITED') {
            throw new RagServiceException('Gemini is temporarily rate limited. Please retry shortly.', 429, 'GEMINI_RATE_LIMITED');
        }
        if ($response->status() === 422 && $code === 'NO_GROUNDED_CONTEXT') {
            throw new RagServiceException('No processed source chunks matched this request.', 422, 'NO_GROUNDED_CONTEXT');
        }
        if (in_array($code, ['UNGROUNDABLE_CITATION', 'LEARNING_OBJECT_QUALITY_INSUFFICIENT'], true)) {
            throw new RagServiceException('AI output failed grounded quality validation.', 502, $code);
        }

        throw new RagServiceException("AI service {$operation} is temporarily unavailable.", 503, $code);
    }
}
