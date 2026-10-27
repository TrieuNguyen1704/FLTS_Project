<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('quiz_attempts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('quiz_id')->constrained()->restrictOnDelete();
            $table->foreignId('student_id')->constrained('users')->restrictOnDelete();
            $table->unsignedInteger('attempt_number');
            $table->string('status', 20)->default('in_progress');
            $table->timestamp('started_at');
            $table->timestamp('expires_at')->nullable();
            $table->timestamp('submitted_at')->nullable();
            $table->decimal('score', 5, 2)->nullable();
            $table->unsignedInteger('max_score');
            $table->boolean('passed')->nullable();
            $table->unsignedInteger('duration_seconds')->nullable();
            $table->boolean('auto_submitted')->default(false);
            $table->unsignedInteger('draft_version')->default(0);
            $table->json('draft_answers')->nullable();
            // Immutable server-side questions/key; never serialized to an active student.
            $table->json('quiz_snapshot');
            $table->timestamps();
            $table->unique(['quiz_id', 'student_id', 'attempt_number'], 'quiz_student_attempt_unique');
            $table->index(['quiz_id', 'student_id', 'status', 'id'], 'quiz_student_status_index');
            $table->index(['quiz_id', 'status', 'id'], 'quiz_result_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('quiz_attempts');
    }
};
