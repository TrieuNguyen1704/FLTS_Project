<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('quizzes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('learning_object_id')->unique()->constrained()->cascadeOnDelete();
            $table->unsignedInteger('question_count');
            $table->unsignedInteger('time_limit_minutes')->nullable();
            $table->unsignedInteger('passing_percentage')->default(60);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('quizzes');
    }
};
