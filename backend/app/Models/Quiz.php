<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Quiz extends Model
{
    protected $fillable = [
        'learning_object_id',
        'question_count',
        'time_limit_minutes',
        'passing_percentage',
    ];

    public function learningObject(): BelongsTo
    {
        return $this->belongsTo(LearningObject::class);
    }

    public function questions(): HasMany
    {
        return $this->hasMany(QuizQuestion::class)->orderBy('order_index');
    }
}
