<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LearningObjectVersion extends Model
{
    protected $fillable = [
        'learning_object_id',
        'version_number',
        'payload',
        'prompt',
        'change_summary',
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'prompt' => 'array',
        ];
    }

    public function learningObject(): BelongsTo
    {
        return $this->belongsTo(LearningObject::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
