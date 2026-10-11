<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TeachingDocument extends Model
{
    protected $fillable = ['course_id', 'file_name', 'original_name', 'file_path', 'file_size', 'mime_type', 'processing_status'];
    protected $hidden = ['file_path'];
    protected $casts = ['file_size' => 'integer'];
    protected $appends = ['status'];

    // One stored state; status is an API alias for the task sheet's terminology.
    public function getStatusAttribute(): string { return $this->processing_status; }
    public function course(): BelongsTo { return $this->belongsTo(Course::class); }
}
