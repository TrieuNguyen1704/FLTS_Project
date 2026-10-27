<?php

namespace App\Http\Controllers;

use App\Http\Requests\QuizAnswersRequest;
use App\Models\Course;
use App\Models\QuizAttempt;
use App\Services\QuizAttemptService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class QuizAttemptController
{
    public function __construct(private QuizAttemptService $engine)
    {
    }

    public function start(Request $request, Course $course, int $learningObject): JsonResponse
    {
        $object = $this->engine->object($request, $course, $learningObject);
        $attempt = DB::transaction(function () use ($request, $object) {
            // Serialize concurrent start/retake requests on the same quiz on MySQL.
            $quiz = DB::table('quizzes')->where('learning_object_id', $object->id)
                ->orderByDesc('id')->lockForUpdate()->first();
            abort_unless($quiz, 404);
            $query = QuizAttempt::where('quiz_id', $quiz->id)->where('student_id', $request->user()->id);
            $active = (clone $query)->where('status', 'in_progress')->lockForUpdate()->first();
            if ($active && $this->engine->expired($active)) {
                $this->engine->grade($active, true);
                $active = null;
            }
            if ($active) {
                return $active;
            }
            $snapshot = $this->engine->snapshot($quiz, $object);
            $startedAt = now();
            return QuizAttempt::create([
                'quiz_id' => $quiz->id, 'student_id' => $request->user()->id,
                'attempt_number' => ((int) (clone $query)->max('attempt_number')) + 1,
                'started_at' => $startedAt,
                'expires_at' => $quiz->time_limit_minutes ? $startedAt->copy()->addMinutes($quiz->time_limit_minutes) : null,
                'max_score' => count($snapshot['questions']), 'quiz_snapshot' => $snapshot,
                'status' => 'in_progress', 'draft_answers' => [],
            ]);
        }, 3);
        return response()->json($this->engine->result($attempt->refresh()), 201);
    }

    public function saveDraft(QuizAnswersRequest $request, Course $course, int $learningObject, int $attempt): JsonResponse
    {
        return $this->write($request, $course, $learningObject, $attempt, false);
    }

    public function submit(QuizAnswersRequest $request, Course $course, int $learningObject, int $attempt): JsonResponse
    {
        return $this->write($request, $course, $learningObject, $attempt, true);
    }

    private function write(QuizAnswersRequest $request, Course $course, int $objectId, int $attemptId, bool $submit): JsonResponse
    {
        $this->engine->object($request, $course, $objectId);
        $data = $request->validated();
        $attempt = DB::transaction(function () use ($request, $objectId, $attemptId, $submit, $data) {
            $attempt = $this->engine->attempt($request, $objectId, $attemptId);
            // Duplicate submit is idempotent, including a retry after a lost HTTP response.
            if ($attempt->status === 'completed') {
                abort_unless($submit, 409, 'Bài làm đã được nộp.');
                return $attempt;
            }
            if ($this->engine->expired($attempt)) {
                // Ignore late payloads; grade only the last server-accepted draft.
                $this->engine->grade($attempt, true);
                return $attempt;
            }
            abort_unless((int) $data['draft_version'] === (int) $attempt->draft_version,
                409, 'Bản nháp đã thay đổi. Hãy tải lại bài làm trước khi lưu.');
            $answers = $this->engine->validateAnswers($attempt, $data['answers']);
            $attempt->update(['draft_answers' => $answers, 'draft_version' => $attempt->draft_version + 1]);
            if ($submit) {
                $this->engine->grade($attempt, false);
            }
            return $attempt;
        }, 3);
        return response()->json($this->engine->result($attempt));
    }

    public function history(Request $request, Course $course, int $learningObject): JsonResponse
    {
        $this->engine->object($request, $course, $learningObject);
        $query = QuizAttempt::whereIn('quiz_id', DB::table('quizzes')->select('id')
            ->where('learning_object_id', $learningObject))->where('student_id', $request->user()->id);
        // Only summaries are paginated; no answer key/snapshot is fetched into the response.
        $attempts = (clone $query)->select([
            'id', 'quiz_id', 'student_id', 'attempt_number', 'status', 'started_at', 'expires_at',
            'submitted_at', 'score', 'max_score', 'passed', 'duration_seconds', 'draft_version', 'auto_submitted',
        ])->orderByDesc('id')->paginate(20);
        return response()->json([
            'attempts' => $attempts,
            'best_score' => (clone $query)->where('status', 'completed')->max('score'),
        ]);
    }
}
