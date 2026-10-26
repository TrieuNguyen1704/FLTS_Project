<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DocumentExtraction extends Model
{
    protected $fillable = [
        'document_processing_run_id',
        'normalized_text',
        'character_count',
        'page_count',
        'metadata',
    ];

    protected $casts = [
        'metadata' => 'array',
        'character_count' => 'integer',
        'page_count' => 'integer',
    ];

    public function processingRun(): BelongsTo
    {
        return $this->belongsTo(DocumentProcessingRun::class, 'document_processing_run_id');
    }
}
