<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LearningObjectGenerationRun extends Model
{
    protected $fillable = [
        'learning_object_id',
        'request_id',
        'attempt_number',
        'status',
        'generation_params',
        'error_code',
        'error_message',
        'started_at',
        'finished_at',
    ];

    protected function casts(): array
    {
        return [
            'generation_params' => 'array',
            'started_at' => 'datetime',
            'finished_at' => 'datetime',
        ];
    }

    public function learningObject(): BelongsTo
    {
        return $this->belongsTo(LearningObject::class);
    }
}
