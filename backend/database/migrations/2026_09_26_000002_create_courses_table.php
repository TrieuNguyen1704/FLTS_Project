<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('courses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('lecturer_id')->constrained('users')->restrictOnDelete();
            $table->string('name', 160);
            $table->string('code', 50)->unique();
            $table->text('description')->nullable();
            $table->timestamps();
            $table->index(['lecturer_id', 'id']);
        });
    }

    public function down(): void { Schema::dropIfExists('courses'); }
};
