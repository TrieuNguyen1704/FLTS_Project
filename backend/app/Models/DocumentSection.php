<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class DocumentSection extends Model
{
    protected $fillable = [
        'document_processing_run_id',
        'parent_id',
        'section_key',
        'level',
        'order_index',
        'title',
        'normalized_title',
        'source_locator',
        'page_start',
        'page_end',
        'detection_source',
        'confidence',
    ];

    protected $casts = [
        'level' => 'integer',
        'order_index' => 'integer',
        'page_start' => 'integer',
        'page_end' => 'integer',
        'confidence' => 'float',
    ];

    public function processingRun(): BelongsTo
    {
        return $this->belongsTo(DocumentProcessingRun::class, 'document_processing_run_id');
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id')->orderBy('order_index');
    }

    public function chunks(): HasMany
    {
        return $this->hasMany(DocumentChunk::class);
    }
}
