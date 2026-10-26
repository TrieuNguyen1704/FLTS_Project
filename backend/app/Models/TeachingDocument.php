<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class TeachingDocument extends Model
{
    protected $fillable = [
        'course_id',
        'uploaded_by',
        'file_name',
        'original_name',
        'file_path',
        'stored_path',
        'file_size',
        'size_bytes',
        'mime_type',
        'extension',
        'processing_status',
        'processing_error',
        'latest_processing_run_id',
        'processed_at',
    ];

    protected $casts = [
        'file_size' => 'integer',
        'size_bytes' => 'integer',
        'processed_at' => 'datetime',
    ];

    protected $hidden = ['file_path'];

    protected $appends = ['status'];

    public function getStatusAttribute(): string
    {
        return $this->processing_status ?? 'uploaded_pending_processing';
    }

    public function getStoredPathAttribute(): ?string
    {
        return $this->attributes['stored_path'] ?? $this->attributes['file_path'] ?? null;
    }

    public function getFilePathAttribute(): ?string
    {
        return $this->attributes['file_path'] ?? $this->attributes['stored_path'] ?? null;
    }

    public function setStoredPathAttribute(?string $value): void
    {
        $this->attributes['stored_path'] = $value;
        if (empty($this->attributes['file_path'])) {
            $this->attributes['file_path'] = $value;
        }
    }

    public function setFilePathAttribute(?string $value): void
    {
        $this->attributes['file_path'] = $value;
        if (empty($this->attributes['stored_path'])) {
            $this->attributes['stored_path'] = $value;
        }
    }

    public function getSizeBytesAttribute(): ?int
    {
        return isset($this->attributes['size_bytes'])
            ? (int) $this->attributes['size_bytes']
            : (isset($this->attributes['file_size']) ? (int) $this->attributes['file_size'] : null);
    }

    public function getFileSizeAttribute(): ?int
    {
        return isset($this->attributes['file_size'])
            ? (int) $this->attributes['file_size']
            : (isset($this->attributes['size_bytes']) ? (int) $this->attributes['size_bytes'] : null);
    }

    public function setSizeBytesAttribute(?int $value): void
    {
        $this->attributes['size_bytes'] = $value;
        if (empty($this->attributes['file_size'])) {
            $this->attributes['file_size'] = $value;
        }
    }

    public function setFileSizeAttribute(?int $value): void
    {
        $this->attributes['file_size'] = $value;
        if (empty($this->attributes['size_bytes'])) {
            $this->attributes['size_bytes'] = $value;
        }
    }

    public function getExtensionAttribute(): string
    {
        if (!empty($this->attributes['extension'])) {
            return $this->attributes['extension'];
        }
        return strtolower(pathinfo($this->original_name ?? '', PATHINFO_EXTENSION));
    }

    public function course(): BelongsTo
    {
        return $this->belongsTo(Course::class);
    }

    public function processingRuns(): HasMany
    {
        return $this->hasMany(DocumentProcessingRun::class);
    }

    public function latestProcessingRun(): BelongsTo
    {
        return $this->belongsTo(DocumentProcessingRun::class, 'latest_processing_run_id');
    }
}
