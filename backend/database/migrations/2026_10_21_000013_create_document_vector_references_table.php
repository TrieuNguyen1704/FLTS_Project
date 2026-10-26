<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('document_vector_references', function (Blueprint $table) {
            $table->id();
            $table->foreignId('document_chunk_id')->constrained()->cascadeOnDelete();
            $table->string('provider', 32)->default('chromadb');
            $table->string('embedding_model', 120)->default('gemini-embedding-2');
            $table->string('collection', 120);
            $table->string('vector_id', 160)->unique();
            $table->unsignedSmallInteger('dimensions')->default(768);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('document_vector_references');
    }
};
