<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('learning_object_versions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('learning_object_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('version_number')->default(1);
            $table->json('payload');
            $table->json('prompt');
            $table->string('change_summary')->nullable();
            $table->foreignId('created_by')->constrained('users')->cascadeOnDelete();
            $table->timestamps();
            $table->unique(['learning_object_id', 'version_number'], 'learning_object_version_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('learning_object_versions');
    }
};
