<?php

namespace App\Jobs;

use App\Models\DocumentChunk;
use App\Models\DocumentExtraction;
use App\Models\DocumentProcessingRun;
use App\Models\DocumentSection;
use App\Models\DocumentVectorReference;
use App\Services\RagService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

class ProcessTeachingDocument implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;
    public int $timeout = 600;

    public function __construct(public int $runId)
    {
        $this->onQueue('documents');
    }

    public function handle(RagService $rag): void
    {
        $run = DocumentProcessingRun::with('document')->findOrFail($this->runId);
        $document = $run->document;

        if ($run->status === 'processed' || !$document) {
            return;
        }

        if (isset($document->latest_processing_run_id) && $document->latest_processing_run_id !== $run->id) {
            return;
        }

        $run->update(['status' => 'processing', 'stage' => 'extracting', 'started_at' => now(), 'error_detail' => null]);
        $document->update(['processing_status' => 'processing', 'processing_error' => null]);

        $maxPages = $run->pipeline_config['max_pages'] ?? null;
        $payload = $rag->processDocument($document, $run->id, $maxPages ? (int) $maxPages : null);
        try {
            $this->persistResult($run, $payload);
        } catch (Throwable $exception) {
            try {
                $rag->deleteProcessingRunVectors($document, $run->id);
            } catch (Throwable) {
            }
            throw $exception;
        }
        $checkpointId = $payload['ingestion']['checkpoint_id'] ?? null;
        if (is_string($checkpointId) && $checkpointId !== '') {
            try {
                $rag->finalizeDocumentIngestion($document, $run->id, $checkpointId);
            } catch (Throwable $exception) {
                $config = $run->fresh()->pipeline_config ?? [];
                $config['ingestion_cleanup_pending'] = true;
                $run->update(['pipeline_config' => $config]);
                Log::warning('Document ingestion staging cleanup is pending.', [
                    'document_id' => $document->id,
                    'processing_run_id' => $run->id,
                    'checkpoint_id' => $checkpointId,
                ]);
            }
        }
    }

    private function persistResult(DocumentProcessingRun $run, array $payload): void
    {
        $extraction = $payload['extraction'] ?? null;
        $chunks = $payload['chunks'] ?? null;
        if (!is_array($extraction) || !is_array($chunks) || $chunks === []) {
            throw new \RuntimeException('AI service returned an incomplete processing result.');
        }

        DB::transaction(function () use ($run, $payload, $extraction, $chunks) {
            $run->refresh();
            $document = $run->document()->lockForUpdate()->firstOrFail();
            if (isset($document->latest_processing_run_id) && $document->latest_processing_run_id !== $run->id) {
                return;
            }

            $pipelineConfig = $run->pipeline_config ?? [];
            if (isset($payload['ingestion']) && is_array($payload['ingestion'])) {
                $pipelineConfig['ingestion_checkpoint'] = [
                    'checkpoint_id' => $payload['ingestion']['checkpoint_id'] ?? null,
                    'total_chunks' => (int) ($payload['ingestion']['total_chunks'] ?? count($chunks)),
                    'reused_chunks' => (int) ($payload['ingestion']['reused_chunks'] ?? 0),
                    'embedded_chunks' => (int) ($payload['ingestion']['embedded_chunks'] ?? count($chunks)),
                ];
            }
            $sections = is_array($payload['sections'] ?? null) ? $payload['sections'] : [];
            $pipelineConfig['document_structure'] = [
                'section_count' => count($sections),
                'source' => $extraction['metadata']['structure_source'] ?? 'unstructured',
            ];
            $run->update(['stage' => 'persisting', 'pipeline_config' => $pipelineConfig]);
            DocumentExtraction::updateOrCreate(
                ['document_processing_run_id' => $run->id],
                [
                    'normalized_text' => (string) ($extraction['normalized_text'] ?? ''),
                    'character_count' => (int) ($extraction['character_count'] ?? 0),
                    'page_count' => isset($extraction['page_count']) ? (int) $extraction['page_count'] : null,
                    'metadata' => $extraction['metadata'] ?? [],
                ]
            );

            $storedSections = [];
            foreach ($sections as $section) {
                $sectionKey = (string) ($section['section_key'] ?? '');
                if ($sectionKey === '') {
                    continue;
                }
                $parentKey = $section['parent_key'] ?? null;
                $storedSections[$sectionKey] = DocumentSection::create([
                    'document_processing_run_id' => $run->id,
                    'parent_id' => $parentKey ? ($storedSections[$parentKey]->id ?? null) : null,
                    'section_key' => $sectionKey,
                    'level' => max(1, (int) ($section['level'] ?? 1)),
                    'order_index' => max(1, (int) ($section['order_index'] ?? count($storedSections) + 1)),
                    'title' => (string) ($section['title'] ?? 'Untitled section'),
                    'normalized_title' => mb_strtolower(trim((string) ($section['title'] ?? 'Untitled section'))),
                    'source_locator' => $section['source_locator'] ?? null,
                    'page_start' => isset($section['page_start']) ? (int) $section['page_start'] : null,
                    'page_end' => isset($section['page_end']) ? (int) $section['page_end'] : null,
                    'detection_source' => (string) ($section['detection_source'] ?? 'inferred_heading'),
                    'confidence' => (float) ($section['confidence'] ?? 0.5),
                ]);
            }

            foreach ($chunks as $chunk) {
                $sectionKey = $chunk['section_key'] ?? null;
                $storedChunk = DocumentChunk::create([
                    'document_processing_run_id' => $run->id,
                    'document_section_id' => $sectionKey ? ($storedSections[$sectionKey]->id ?? null) : null,
                    'chunk_index' => (int) $chunk['chunk_index'],
                    'content' => (string) $chunk['content'],
                    'source_locator' => $chunk['source_locator'] ?? null,
                    'source_start' => $chunk['source_start'] ?? null,
                    'source_end' => $chunk['source_end'] ?? null,
                    'page_start' => isset($chunk['page_start']) ? (int) $chunk['page_start'] : null,
                    'page_end' => isset($chunk['page_end']) ? (int) $chunk['page_end'] : null,
                    'section_title' => $chunk['section_title'] ?? null,
                    'heading_path' => $chunk['heading_path'] ?? null,
                    'chunking_strategy' => $chunk['chunking_strategy'] ?? null,
                    'token_estimate' => isset($chunk['token_estimate']) ? (int) $chunk['token_estimate'] : null,
                    'content_hash' => (string) $chunk['content_hash'],
                ]);
                DocumentVectorReference::create([
                    'document_chunk_id' => $storedChunk->id,
                    'provider' => 'chromadb',
                    'embedding_model' => (string) ($payload['embedding_model'] ?? config('rag.embedding_model', 'gemini-embedding-2')),
                    'collection' => (string) ($payload['vector_store']['collection'] ?? 'flts_document_chunks'),
                    'vector_id' => (string) $chunk['vector_id'],
                    'dimensions' => (int) ($chunk['dimensions'] ?? 768),
                ]);
            }

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
