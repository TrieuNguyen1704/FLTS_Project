<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

class DocumentChunk extends Model
{
    protected $fillable = [
        'document_processing_run_id',
        'document_section_id',
        'chunk_index',
        'content',
        'source_locator',
        'source_start',
        'source_end',
        'page_start',
        'page_end',
        'section_title',
        'heading_path',
        'chunking_strategy',
        'token_estimate',
        'content_hash',
    ];

    protected $casts = [
        'chunk_index' => 'integer',
        'page_start' => 'integer',
        'page_end' => 'integer',
        'heading_path' => 'array',
        'token_estimate' => 'integer',
    ];

    public function processingRun(): BelongsTo
    {
        return $this->belongsTo(DocumentProcessingRun::class, 'document_processing_run_id');
    }

    public function section(): BelongsTo
    {
        return $this->belongsTo(DocumentSection::class, 'document_section_id');
    }

    public function vectorReference(): HasOne
    {
        return $this->hasOne(DocumentVectorReference::class);
    }
}
