<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('document_sections', function (Blueprint $table) {
            $table->id();
            $table->foreignId('document_processing_run_id')->constrained()->cascadeOnDelete();
            $table->foreignId('parent_id')->nullable()->constrained('document_sections')->cascadeOnDelete();
            $table->string('section_key', 64);
            $table->unsignedInteger('level');
            $table->unsignedInteger('order_index');
            $table->string('title');
            $table->string('normalized_title');
            $table->string('source_locator', 160)->nullable();
            $table->unsignedInteger('page_start')->nullable();
            $table->unsignedInteger('page_end')->nullable();
            $table->string('detection_source', 32);
            $table->decimal('confidence', 4, 3)->default(0.500);
            $table->timestamps();

            $table->unique(['document_processing_run_id', 'section_key'], 'doc_sections_run_key_unique');
            $table->index(['document_processing_run_id', 'order_index'], 'doc_sections_run_order_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('document_sections');
    }
};
