<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('document_processing_runs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('teaching_document_id')->constrained()->cascadeOnDelete();
            $table->foreignId('requested_by')->constrained('users')->cascadeOnDelete();
            $table->unsignedInteger('attempt_number')->default(1);
            $table->string('status', 32)->default('queued')->index();
            $table->string('stage', 48)->default('queued');
            $table->json('pipeline_config')->nullable();
            $table->json('error_detail')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();
            // MySQL caps identifiers at 64 characters; Laravel's generated name exceeds that limit here.
            $table->unique(['teaching_document_id', 'attempt_number'], 'doc_runs_document_attempt_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('document_processing_runs');
    }
};
