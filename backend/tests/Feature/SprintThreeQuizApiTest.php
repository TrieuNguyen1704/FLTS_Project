<?php

namespace Tests\Feature;

use App\Models\QuizAttempt;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class SprintThreeQuizApiTest extends CourseDocumentTestCase
{
    private string $base;
    private int $quizId;
    private array $questions;
    private array $correct;
    private array $wrong;
    private array $studentHeaders = ['Authorization' => 'Bearer learner'];
    private array $ownerHeaders = ['Authorization' => 'Bearer teacher'];

    protected function setUp(): void
    {
        parent::setUp();
        // Contract fixtures ONLY: Khoa owns the production migrations/models 15–20.
        // Never export these tables into database/migrations or claim integration done.
        if (!Schema::hasTable('learning_objects')) {
            Schema::create('learning_objects', function (Blueprint $table) {
                $table->id(); $table->unsignedBigInteger('course_id');
                $table->string('title'); $table->string('type'); $table->string('status');
            });
            Schema::create('quizzes', function (Blueprint $table) {
                $table->id(); $table->unsignedBigInteger('learning_object_id');
                $table->unsignedInteger('question_count'); $table->unsignedInteger('time_limit_minutes')->nullable();
                $table->decimal('passing_percentage', 5, 2);
            });
            Schema::create('quiz_questions', function (Blueprint $table) {
                $table->id(); $table->unsignedBigInteger('quiz_id'); $table->text('question_text');
                $table->text('explanation'); $table->unsignedInteger('order_index');
                $table->string('difficulty'); $table->json('citation_metadata')->nullable();
            });
            Schema::create('quiz_options', function (Blueprint $table) {
                $table->id(); $table->unsignedBigInteger('question_id'); $table->text('option_text');
                $table->boolean('is_correct'); $table->unsignedInteger('order_index');
            });
        }
        $owner = $this->user('teacher');
        $student = $this->user('learner', 'student');
        $this->user('outsider', 'student');
        $this->user('otherteacher');
        $course = $this->course($owner);
        $course->students()->attach($student);
        $object = DB::table('learning_objects')->insertGetId([
            'course_id' => $course->id, 'type' => 'quiz', 'status' => 'published', 'title' => 'Ôn tập RAG',
        ]);
        $this->quizId = DB::table('quizzes')->insertGetId([
            'learning_object_id' => $object, 'question_count' => 2,
            'time_limit_minutes' => 1, 'passing_percentage' => 50,
        ]);
        $this->questions = $this->correct = $this->wrong = [];
        for ($index = 0; $index < 2; $index++) {
            $question = DB::table('quiz_questions')->insertGetId([
                'quiz_id' => $this->quizId, 'question_text' => 'Câu hỏi '.$index,
                'explanation' => 'Giải thích $x^2$', 'difficulty' => 'easy', 'order_index' => $index,
                'citation_metadata' => json_encode([['page_number' => 3]]),
            ]);
            $this->questions[] = $question;
            $this->correct[] = DB::table('quiz_options')->insertGetId([
                'question_id' => $question, 'option_text' => 'Đúng', 'is_correct' => true, 'order_index' => 0,
            ]);
            $this->wrong[] = DB::table('quiz_options')->insertGetId([
                'question_id' => $question, 'option_text' => 'Sai', 'is_correct' => false, 'order_index' => 1,
            ]);
        }
        $this->base = "/api/courses/{$course->id}/learning-objects/{$object}";
    }

    private function startAttempt(): int
    {
        return $this->postJson($this->base.'/quiz-attempts', [], $this->studentHeaders)
            ->assertCreated()->json('attempt.id');
    }

    private function payload(int $version = 0): array
    {
        return ['draft_version' => $version, 'answers' => [
            ['question_id' => $this->questions[0], 'selected_option_id' => $this->correct[0], 'time_spent_seconds' => 8],
            ['question_id' => $this->questions[1], 'selected_option_id' => $this->wrong[1], 'time_spent_seconds' => 2],
        ]];
    }

    public function test_start_resumes_and_never_leaks_key_or_explanation(): void
    {
        $id = $this->startAttempt();
        $response = $this->postJson($this->base.'/quiz-attempts', [], $this->studentHeaders)->assertCreated();
        $response->assertJsonPath('attempt.id', $id)->assertJsonPath('attempt.attempt_number', 1);
        $this->assertStringNotContainsString('is_correct', $response->getContent());
        $this->assertStringNotContainsString('explanation', $response->getContent());
        $this->assertStringNotContainsString('quiz_snapshot', $response->getContent());
        $this->assertDatabaseCount('quiz_attempts', 1);
    }

    public function test_draft_resume_and_stale_version_conflict(): void
    {
        $id = $this->startAttempt();
        $this->patchJson($this->base."/quiz-attempts/{$id}", $this->payload(), $this->studentHeaders)
            ->assertOk()->assertJsonPath('attempt.draft_version', 1);
        $this->patchJson($this->base."/quiz-attempts/{$id}", $this->payload(), $this->studentHeaders)->assertStatus(409);
        $this->postJson($this->base.'/quiz-attempts', [], $this->studentHeaders)
            ->assertJsonPath('draft_answers.0.selected_option_id', $this->correct[0]);
        $this->assertDatabaseCount('quiz_attempt_answers', 0);
    }

    public function test_submit_scores_on_server_and_duplicate_submit_is_idempotent(): void
    {
        $id = $this->startAttempt();
        $this->travel(10)->seconds();
        $payload = $this->payload() + ['score' => 100, 'passed' => true];
        $this->postJson($this->base."/quiz-attempts/{$id}/submit", $payload, $this->studentHeaders)
            ->assertOk()->assertJsonPath('attempt.score', 50)->assertJsonPath('attempt.passed', true)
            ->assertJsonPath('attempt.max_score', 2)->assertJsonPath('attempt.duration_seconds', 10)
            ->assertJsonPath('results.0.is_correct', true)->assertJsonPath('results.1.is_correct', false)
            ->assertJsonPath('results.0.time_spent_seconds', 8);
        $this->postJson($this->base."/quiz-attempts/{$id}/submit", $this->payload(), $this->studentHeaders)
            ->assertOk()->assertJsonPath('attempt.score', 50);
        $this->assertDatabaseCount('quiz_attempt_answers', 2);
        $this->patchJson($this->base."/quiz-attempts/{$id}", $this->payload(1), $this->studentHeaders)->assertStatus(409);
    }

    public function test_unanswered_questions_are_incorrect_and_no_time_limit_is_supported(): void
    {
        DB::table('quizzes')->where('id', $this->quizId)->update(['time_limit_minutes' => null]);
        $id = $this->startAttempt();
        $this->postJson($this->base."/quiz-attempts/{$id}/submit", ['draft_version' => 0, 'answers' => []], $this->studentHeaders)
            ->assertOk()->assertJsonPath('attempt.score', 0)->assertJsonPath('attempt.passed', false)
            ->assertJsonPath('attempt.expires_at', null);
        $this->assertDatabaseCount('quiz_attempt_answers', 2);
    }

    public function test_expired_request_grades_only_previously_saved_draft(): void
    {
        $id = $this->startAttempt();
        $this->patchJson($this->base."/quiz-attempts/{$id}", $this->payload(), $this->studentHeaders)->assertOk();
        $this->travel(61)->seconds();
        $payload = $this->payload(1);
        $payload['answers'][1]['selected_option_id'] = $this->correct[1];
        $this->postJson($this->base."/quiz-attempts/{$id}/submit", $payload, $this->studentHeaders)
            ->assertOk()->assertJsonPath('attempt.score', 50)->assertJsonPath('timed_out', true)
            ->assertJsonPath('attempt.duration_seconds', 60);
    }

    public function test_draft_at_deadline_auto_submits_and_next_start_is_retake(): void
    {
        $id = $this->startAttempt();
        $this->travel(60)->seconds();
        $this->patchJson($this->base."/quiz-attempts/{$id}", $this->payload(), $this->studentHeaders)
            ->assertOk()->assertJsonPath('attempt.score', 0)->assertJsonPath('timed_out', true);
        $newId = $this->startAttempt();
        $this->assertNotSame($id, $newId);
        $this->assertEquals(2, QuizAttempt::find($newId)->attempt_number);
    }

    public function test_reopening_expired_attempt_finalizes_it_before_new_start(): void
    {
        $id = $this->startAttempt();
        $this->travel(61)->seconds();
        $this->startAttempt();
        $this->assertSame('completed', QuizAttempt::find($id)->status);
    }

    public function test_rejects_duplicate_question_and_foreign_option_and_negative_time(): void
    {
        $id = $this->startAttempt();
        $url = $this->base."/quiz-attempts/{$id}";
        $payload = $this->payload();
        $payload['answers'][1]['question_id'] = $this->questions[0];
        $this->patchJson($url, $payload, $this->studentHeaders)->assertUnprocessable();
        $payload = $this->payload();
        $payload['answers'][0]['selected_option_id'] = $this->correct[1];
        $this->patchJson($url, $payload, $this->studentHeaders)->assertUnprocessable();
        $payload['answers'][0]['question_id'] = 999999;
        $this->patchJson($url, $payload, $this->studentHeaders)->assertUnprocessable();
        $payload = $this->payload();
        $payload['answers'][0]['time_spent_seconds'] = -1;
        $this->patchJson($url, $payload, $this->studentHeaders)->assertUnprocessable();
        $this->patchJson($url, ['answers' => []], $this->studentHeaders)->assertUnprocessable();
    }

    public function test_auth_roles_enrollment_and_attempt_ownership(): void
    {
        $this->postJson($this->base.'/quiz-attempts')->assertUnauthorized();
        $this->postJson($this->base.'/quiz-attempts', [], $this->ownerHeaders)->assertForbidden();
        $this->postJson($this->base.'/quiz-attempts', [], ['Authorization' => 'Bearer outsider'])->assertForbidden();
        $id = $this->startAttempt();
        $student = \App\Models\User::where('name', 'outsider')->first();
        DB::table('course_enrollments')->insert(['course_id' => 1, 'student_id' => $student->id]);
        $this->postJson($this->base."/quiz-attempts/{$id}/submit", $this->payload(), ['Authorization' => 'Bearer outsider'])->assertNotFound();
        $this->getJson($this->base.'/quiz-results', $this->studentHeaders)->assertForbidden();
        $this->getJson($this->base.'/quiz-results', ['Authorization' => 'Bearer otherteacher'])->assertForbidden();
    }

    public function test_unpublished_or_wrong_course_object_is_not_accessible(): void
    {
        DB::table('learning_objects')->update(['status' => 'draft']);
        $this->postJson($this->base.'/quiz-attempts', [], $this->studentHeaders)->assertNotFound();
        DB::table('learning_objects')->update(['status' => 'published', 'course_id' => 999]);
        $this->postJson($this->base.'/quiz-attempts', [], $this->studentHeaders)->assertNotFound();
    }

    public function test_quiz_with_invalid_answer_key_cannot_be_started(): void
    {
        DB::table('quiz_options')->where('question_id', $this->questions[0])->update(['is_correct' => false]);
        $this->postJson($this->base.'/quiz-attempts', [], $this->studentHeaders)->assertUnprocessable();
        $this->assertDatabaseCount('quiz_attempts', 0);
    }

    public function test_history_is_paginated_and_does_not_expose_private_snapshots(): void
    {
        $id = $this->startAttempt();
        $record = QuizAttempt::find($id);
        for ($index = 2; $index <= 22; $index++) {
            $copy = $record->replicate();
            $copy->attempt_number = $index;
            $copy->status = 'completed';
            $copy->score = 0;
            $copy->save();
        }
        $response = $this->getJson($this->base.'/quiz-attempts', $this->studentHeaders)
            ->assertOk()->assertJsonPath('attempts.total', 22)->assertJsonCount(20, 'attempts.data');
        $this->assertStringNotContainsString('quiz_snapshot', $response->getContent());
        $this->assertStringNotContainsString('explanation', $response->getContent());
    }

    public function test_grading_and_review_use_start_snapshot_not_edited_question_key(): void
    {
        $id = $this->startAttempt();
        DB::table('quiz_options')->whereIn('id', $this->correct)->update(['is_correct' => false]);
        DB::table('quiz_options')->whereIn('id', $this->wrong)->update(['is_correct' => true]);
        $this->postJson($this->base."/quiz-attempts/{$id}/submit", $this->payload(), $this->studentHeaders)
            ->assertOk()->assertJsonPath('attempt.score', 50)->assertJsonPath('results.0.correct_option_id', $this->correct[0]);
    }

    public function test_lecturer_stats_distribution_detail_and_history(): void
    {
        $this->getJson($this->base.'/quiz-results', $this->ownerHeaders)
            ->assertOk()->assertJsonPath('summary.participants', 0)->assertJsonPath('summary.pass_rate', null);
        $id = $this->startAttempt();
        $this->getJson($this->base."/quiz-results/attempts/{$id}", $this->ownerHeaders)->assertNotFound();
        $this->postJson($this->base."/quiz-attempts/{$id}/submit", $this->payload(), $this->studentHeaders)->assertOk();
        $id2 = $this->startAttempt();
        $this->postJson($this->base."/quiz-attempts/{$id2}/submit", ['draft_version' => 0, 'answers' => []], $this->studentHeaders)->assertOk();
        $response = $this->getJson($this->base.'/quiz-results', $this->ownerHeaders)
            ->assertOk()->assertJsonPath('summary.total_attempts', 2)->assertJsonPath('summary.participants', 1)
            ->assertJsonPath('summary.average_score', 25)->assertJsonPath('summary.pass_rate', 0)
            ->assertJsonPath('score_distribution.below_50', 1)->assertJsonPath('score_distribution.from_50_to_69', 1);
        $this->assertStringNotContainsString('quiz_snapshot', $response->getContent());
        $this->getJson($this->base."/quiz-results/attempts/{$id}", $this->ownerHeaders)
            ->assertOk()->assertJsonPath('results.0.correct_option_id', $this->correct[0]);
        $this->getJson($this->base.'/quiz-attempts', $this->studentHeaders)
            ->assertOk()->assertJsonPath('attempts.total', 2)->assertJsonPath('best_score', 50);
    }
}
