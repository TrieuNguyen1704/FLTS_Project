<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('quiz_attempt_answers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('quiz_attempt_id')->constrained()->cascadeOnDelete();
            $table->foreignId('question_id')->constrained('quiz_questions')->restrictOnDelete();
            $table->foreignId('selected_option_id')->nullable()->constrained('quiz_options')->restrictOnDelete();
            $table->boolean('is_correct');
            $table->unsignedInteger('time_spent_seconds')->default(0);
            $table->timestamps();
            $table->unique(['quiz_attempt_id', 'question_id'], 'attempt_question_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('quiz_attempt_answers');
    }
};
