<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DocumentVectorReference extends Model
{
    protected $fillable = [
        'document_chunk_id',
        'provider',
        'embedding_model',
        'collection',
        'vector_id',
        'dimensions',
    ];

    protected $casts = [
        'dimensions' => 'integer',
    ];

    public function chunk(): BelongsTo
    {
        return $this->belongsTo(DocumentChunk::class, 'document_chunk_id');
    }
}
