<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('document_chunks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('document_processing_run_id')->constrained()->cascadeOnDelete();
            $table->foreignId('document_section_id')->nullable()->constrained('document_sections')->nullOnDelete();
            $table->unsignedInteger('chunk_index');
            $table->longText('content');
            $table->string('source_locator', 160)->nullable();
            $table->string('source_start', 160)->nullable();
            $table->string('source_end', 160)->nullable();
            $table->unsignedInteger('page_start')->nullable();
            $table->unsignedInteger('page_end')->nullable();
            $table->string('section_title')->nullable();
            $table->json('heading_path')->nullable();
            $table->string('chunking_strategy', 64)->nullable();
            $table->unsignedInteger('token_estimate')->nullable();
            $table->string('content_hash', 64);
            $table->timestamps();

            $table->unique(['document_processing_run_id', 'chunk_index']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('document_chunks');
    }
};
