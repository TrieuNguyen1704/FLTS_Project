<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('learning_object_generation_runs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('learning_object_id')->constrained()->cascadeOnDelete();
            $table->uuid('request_id')->unique();
            $table->unsignedInteger('attempt_number')->default(1);
            $table->string('status', 24)->default('queued')->index();
            $table->json('generation_params');
            $table->string('error_code', 64)->nullable();
            $table->string('error_message', 255)->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();
            $table->unique(['learning_object_id', 'attempt_number'], 'lo_generation_attempt_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('learning_object_generation_runs');
    }
};
