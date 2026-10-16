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
            $table->string('file_name');
            $table->string('original_name');
            $table->string('file_path');
            $table->unsignedBigInteger('file_size');
            $table->string('mime_type', 160);
            $table->string('processing_status', 40)->default('uploaded_pending_processing');
            $table->timestamps();
            $table->index(['course_id', 'id']);
        });
    }

    public function down(): void { Schema::dropIfExists('teaching_documents'); }
};
