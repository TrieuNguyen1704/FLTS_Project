<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class DocumentProcessingRun extends Model
{
    protected $fillable = [
        'teaching_document_id',
        'requested_by',
        'attempt_number',
        'status',
        'stage',
        'pipeline_config',
        'error_detail',
        'started_at',
        'finished_at',
    ];

    protected $casts = [
        'pipeline_config' => 'array',
        'error_detail' => 'array',
        'started_at' => 'datetime',
        'finished_at' => 'datetime',
    ];

    public function document(): BelongsTo
    {
        return $this->belongsTo(TeachingDocument::class, 'teaching_document_id');
    }

    public function requestedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requested_by');
    }

    public function extraction(): HasOne
    {
        return $this->hasOne(DocumentExtraction::class);
    }

    public function chunks(): HasMany
    {
        return $this->hasMany(DocumentChunk::class);
    }

    public function sections(): HasMany
    {
        return $this->hasMany(DocumentSection::class)->orderBy('order_index');
    }
}
