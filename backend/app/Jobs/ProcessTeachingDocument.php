<?php

namespace App\Jobs;

use App\Models\DocumentProcessingRun;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Throwable;

class ProcessTeachingDocument implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;
    public int $timeout = 900;

    public function __construct(public int $runId)
    {
        // Keep heavy extraction/embedding work isolated on the documents queue.
        $this->onQueue('documents');
    }

    public function handle(): void
    {
        $run = DocumentProcessingRun::with('document')->findOrFail($this->runId);
        $document = $run->document;

        if ($run->status === 'processed' || !$document) {
            return;
        }

        // A retried queue message must not overwrite the outcome of a newer manual retry.
        if (isset($document->latest_processing_run_id) && $document->latest_processing_run_id !== $run->id) {
            return;
        }

        $run->update(['status' => 'processing', 'stage' => 'extracting', 'started_at' => now(), 'error_detail' => null]);
        $document->update(['processing_status' => 'processing', 'processing_error' => null]);

        $relativeFilePath = $document->file_path ?? $document->stored_path ?? '';
        $filePath = storage_path('app/' . $relativeFilePath);

        if (!file_exists($filePath)) {
            throw new \RuntimeException("The uploaded source file is no longer available in storage: {$relativeFilePath}");
        }

        $stream = fopen($filePath, 'r');
        if ($stream === false) {
            throw new \RuntimeException("Failed to open file stream for: {$filePath}");
        }

        try {
            $aiBaseUrl = rtrim((string) config('rag.url', env('AI_SERVICE_URL', 'http://ai:8001')), '/');
            $aiToken = (string) config('rag.token', env('AI_SERVICE_TOKEN', ''));
            $endpoint = env('AI_PROCESS_ENDPOINT', '/process');

            $httpClient = Http::baseUrl($aiBaseUrl)->timeout(600);
            if ($aiToken !== '') {
                $httpClient = $httpClient->withToken($aiToken);
            }

            $maxPages = $run->pipeline_config['max_pages'] ?? null;
            $postData = [
                'document_id' => (string) $document->id,
                'course_id' => (string) $document->course_id,
                'processing_run_id' => (string) $run->id,
                'mime_type' => (string) ($document->mime_type ?? 'application/octet-stream'),
                'extension' => strtolower(pathinfo($document->original_name, PATHINFO_EXTENSION)),
            ];

            if ($maxPages !== null && (int) $maxPages > 0) {
                $postData['max_pages'] = (string) $maxPages;
            }

            $response = $httpClient->attach('file', $stream, $document->original_name)->post($endpoint, $postData);

            // If /process is not found, fallback to /internal/v1/documents/process
            if ($response->status() === 404 && $endpoint === '/process') {
                rewind($stream);
                $response = $httpClient->attach('file', $stream, $document->original_name)->post('/internal/v1/documents/process', $postData);
            }
        } finally {
            if (is_resource($stream)) {
                fclose($stream);
            }
        }

        if (!$response->successful()) {
            throw new \RuntimeException('AI service processing failed with status ' . $response->status() . ': ' . $response->body());
        }

        $payload = $response->json() ?? [];
        try {
            $this->persistResult($run, $payload);
        } catch (Throwable $exception) {
            throw $exception;
        }
    }

    private function persistResult(DocumentProcessingRun $run, array $payload): void
    {
        $extraction = $payload['extraction'] ?? null;
        $chunks = $payload['chunks'] ?? null;
        if (!is_array($extraction) || !is_array($chunks) || $chunks === []) {
            throw new \RuntimeException('AI service returned an incomplete processing result.');
        }

        DB::transaction(function () use ($run, $payload) {
            $run->refresh();
            $document = $run->document()->lockForUpdate()->firstOrFail();
            if (isset($document->latest_processing_run_id) && $document->latest_processing_run_id !== $run->id) {
                return;
            }

            $run->update(['stage' => 'persisting']);

            $run->update(['status' => 'processed', 'stage' => 'completed', 'finished_at' => now()]);
            $document->update([
                'processing_status' => 'processed',
                'processing_error' => null,
                'processed_at' => now(),
            ]);
        });
    }

    public function failed(Throwable $exception): void
    {
        $run = DocumentProcessingRun::with('document')->find($this->runId);
        if (!$run) {
            return;
        }

        $run->update([
            'status' => 'failed',
            'stage' => 'failed',
            'finished_at' => now(),
            // Queue/provider exceptions remain in logs; the persisted run must stay safe to return to a Lecturer.
            'error_detail' => ['code' => 'PROCESSING_FAILED', 'message' => 'Processing could not be completed.', 'retryable' => true],
        ]);

        if ($run->document && (!isset($run->document->latest_processing_run_id) || $run->document->latest_processing_run_id === $run->id)) {
            $run->document->update([
                'processing_status' => 'failed',
                'processing_error' => 'Processing failed. You can retry this document.',
            ]);
        }
    }
}
