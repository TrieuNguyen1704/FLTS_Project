<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class QuizAttempt extends Model
{
    protected $guarded = ['id'];
    protected $hidden = ['quiz_snapshot', 'draft_answers'];

    protected function casts(): array
    {
        return [
            'started_at' => 'datetime', 'expires_at' => 'datetime', 'submitted_at' => 'datetime',
            'score' => 'float', 'passed' => 'boolean', 'auto_submitted' => 'boolean',
            'draft_answers' => 'array', 'quiz_snapshot' => 'array',
        ];
    }

    public function quiz(): BelongsTo
    {
        return $this->belongsTo(Quiz::class);
    }

    public function student(): BelongsTo
    {
        return $this->belongsTo(User::class, 'student_id');
    }

    public function answers(): HasMany
    {
        return $this->hasMany(QuizAttemptAnswer::class);
    }
}
