<?php

namespace App\Services;

use App\Models\Course;
use App\Models\QuizAttempt;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class QuizAttemptService
{
    public function object(Request $request, Course $course, int $objectId, bool $student = true): object
    {
        $object = DB::table('learning_objects')->where('id', $objectId)
            ->where('course_id', $course->id)->where('type', 'quiz')->first();
        abort_unless($object && (!$student || $object->status === 'published'), 404);
        if ($student) {
            abort_unless($course->students()->where('users.id', $request->user()->id)->exists(), 403);
        } else {
            abort_unless((int) $course->lecturer_id === (int) $request->user()->id, 403);
        }
        return $object;
    }

    public function attempt(Request $request, int $objectId, int $attemptId): QuizAttempt
    {
        $attempt = QuizAttempt::whereKey($attemptId)->where('student_id', $request->user()->id)
            ->whereIn('quiz_id', DB::table('quizzes')->select('id')->where('learning_object_id', $objectId))
            ->lockForUpdate()->firstOrFail();
        return $attempt;
    }

    public function snapshot(object $quiz, object $object): array
    {
        $questions = DB::table('quiz_questions')->where('quiz_id', $quiz->id)
            ->orderBy('order_index')->orderBy('id')->limit(101)->get();
        abort_unless($questions->count() > 0 && $questions->count() <= 100, 422, 'Quiz phải có từ 1 đến 100 câu.');
        $options = DB::table('quiz_options')->whereIn('question_id', $questions->pluck('id'))
            ->orderBy('order_index')->orderBy('id')->limit(1001)->get();
        abort_if($options->count() > 1000, 422, 'Quiz vượt quá giới hạn số lựa chọn.');
        $options = $options->groupBy('question_id');
        $payload = [];
        foreach ($questions as $question) {
            $choices = $options->get($question->id, collect());
            abort_unless($choices->count() >= 2 && $choices->count() <= 10
                && $choices->where('is_correct', true)->count() === 1,
                422, 'Mỗi câu phải có đúng một đáp án đúng.');
            $payload[] = [
                'id' => (int) $question->id, 'order_index' => $question->order_index,
                'question_text' => $question->question_text, 'explanation' => $question->explanation,
                'citation_metadata' => json_decode($question->citation_metadata ?? 'null', true),
                'options' => $choices->map(fn ($option) => [
                    'id' => (int) $option->id, 'option_text' => $option->option_text,
                    'order_index' => $option->order_index, 'is_correct' => (bool) $option->is_correct,
                ])->values()->all(),
            ];
        }
        abort_unless($quiz->passing_percentage >= 0 && $quiz->passing_percentage <= 100, 422);
        return ['learning_object_id' => $object->id, 'title' => $object->title, 'passing_percentage' => (float) $quiz->passing_percentage,
            'time_limit_minutes' => $quiz->time_limit_minutes, 'questions' => $payload];
    }

    public function expired(QuizAttempt $attempt): bool
    {
        return $attempt->expires_at !== null && now()->greaterThanOrEqualTo($attempt->expires_at);
    }

    public function validateAnswers(QuizAttempt $attempt, array $answers): array
    {
        $questions = collect($attempt->quiz_snapshot['questions'])->keyBy('id');
        foreach ($answers as &$answer) {
            $question = $questions->get($answer['question_id']);
            if (!$question || ($answer['selected_option_id'] !== null
                && !collect($question['options'])->contains('id', (int) $answer['selected_option_id']))) {
                throw ValidationException::withMessages(['answers' => ['Câu hỏi hoặc lựa chọn không thuộc bài làm.']]);
            }
            $answer = [
                'question_id' => (int) $answer['question_id'],
                'selected_option_id' => isset($answer['selected_option_id']) ? (int) $answer['selected_option_id'] : null,
                'time_spent_seconds' => (int) ($answer['time_spent_seconds'] ?? 0),
            ];
        }
        unset($answer);
        return $answers;
    }

    public function grade(QuizAttempt $attempt, bool $expired): void
    {
        if ($attempt->status === 'completed') {
            return;
        }
        $selected = collect($attempt->draft_answers ?? [])->keyBy('question_id');
        $correctCount = 0;
        $rows = [];
        foreach ($attempt->quiz_snapshot['questions'] as $question) {
            $answer = $selected->get($question['id']);
            $option = collect($question['options'])->firstWhere('id', $answer['selected_option_id'] ?? null);
            $correct = (bool) ($option['is_correct'] ?? false);
            $correctCount += (int) $correct;
            $rows[] = [
                'quiz_attempt_id' => $attempt->id, 'question_id' => $question['id'],
                'selected_option_id' => $option['id'] ?? null, 'is_correct' => $correct,
                'time_spent_seconds' => $answer['time_spent_seconds'] ?? 0,
                'created_at' => now(), 'updated_at' => now(),
            ];
        }
        // At most 100 answers: one insert, not one SQL write per question.
        DB::table('quiz_attempt_answers')->insert($rows);
        $score = round(100 * $correctCount / $attempt->max_score, 2);
        $end = $expired ? $attempt->expires_at : now();
        $attempt->update([
            'status' => 'completed', 'submitted_at' => now(), 'score' => $score,
            'passed' => $score >= $attempt->quiz_snapshot['passing_percentage'],
            'duration_seconds' => max(0, (int) $attempt->started_at->diffInSeconds($end)),
            'auto_submitted' => $expired,
        ]);
    }

    public function summary(QuizAttempt $attempt): array
    {
        return $attempt->only([
            'id', 'quiz_id', 'student_id', 'attempt_number', 'status', 'started_at', 'expires_at',
            'submitted_at', 'score', 'max_score', 'passed', 'duration_seconds', 'draft_version', 'auto_submitted',
        ]);
    }

    public function result(QuizAttempt $attempt): array
    {
        $payload = ['attempt' => $this->summary($attempt), 'server_time' => now()];
        if ($attempt->status === 'in_progress') {
            $snapshot = $attempt->quiz_snapshot;
            $snapshot['questions'] = array_map(function (array $question): array {
                unset($question['explanation'], $question['citation_metadata']);
                $question['options'] = array_map(function (array $option): array {
                    unset($option['is_correct']);
                    return $option;
                }, $question['options']);
                return $question;
            }, $snapshot['questions']);
            $payload['quiz'] = $snapshot;
            $payload['draft_answers'] = $attempt->draft_answers ?? [];
        } else {
            $answers = $attempt->answers->keyBy('question_id');
            $payload['results'] = array_map(function (array $question) use ($answers): array {
                $answer = $answers->get($question['id']);
                return $question + [
                    'selected_option_id' => $answer?->selected_option_id,
                    'is_correct' => (bool) $answer?->is_correct,
                    'time_spent_seconds' => $answer?->time_spent_seconds ?? 0,
                    'correct_option_id' => collect($question['options'])->firstWhere('is_correct', true)['id'],
                ];
            }, $attempt->quiz_snapshot['questions']);
            $payload['timed_out'] = $attempt->auto_submitted;
        }
        return $payload;
    }
}
