<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('teaching_documents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('course_id')->constrained()->cascadeOnDelete();
            $table->foreignId('uploaded_by')->nullable()->constrained('users')->cascadeOnDelete();
            $table->string('file_name')->nullable();
            $table->string('original_name');
            $table->string('file_path')->nullable();
            $table->string('stored_path')->nullable();
            $table->unsignedBigInteger('file_size')->nullable();
            $table->unsignedBigInteger('size_bytes')->nullable();
            $table->string('mime_type', 160);
            $table->string('extension', 10)->nullable();
            $table->string('processing_status', 40)->default('uploaded_pending_processing');
            $table->text('processing_error')->nullable();
            $table->timestamps();
            $table->index(['course_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('teaching_documents');
    }
};
