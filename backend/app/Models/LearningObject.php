<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class LearningObject extends Model
{
    protected $fillable = ['course_id', 'type', 'title', 'description', 'status', 'created_by', 'published_at'];

    protected function casts(): array
    {
        return ['published_at' => 'datetime'];
    }

    public function course(): BelongsTo
    {
        return $this->belongsTo(Course::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function versions(): HasMany
    {
        return $this->hasMany(LearningObjectVersion::class);
    }

    public function quiz(): HasOne
    {
        return $this->hasOne(Quiz::class);
    }

    public function generationRuns(): HasMany
    {
        return $this->hasMany(LearningObjectGenerationRun::class);
    }

    public function latestGenerationRun(): HasOne
    {
        return $this->hasOne(LearningObjectGenerationRun::class)->latestOfMany();
    }
}
