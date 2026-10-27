<?php

namespace App\Http\Controllers;

use App\Models\Course;
use App\Models\QuizAttempt;
use App\Services\QuizAttemptService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class LecturerQuizResultController
{
    public function __construct(private QuizAttemptService $engine)
    {
    }

    public function index(Request $request, Course $course, int $learningObject): JsonResponse
    {
        $object = $this->engine->object($request, $course, $learningObject, false);
        $query = QuizAttempt::whereIn('quiz_id', DB::table('quizzes')->select('id')
            ->where('learning_object_id', $object->id))->where('status', 'completed');
        $summary = (clone $query)->selectRaw(
            'COUNT(*) AS total_attempts, COUNT(DISTINCT student_id) AS participants, '
            .'AVG(score) AS average_score, MAX(score) AS highest_score'
        )->first();
        $latestIds = (clone $query)->selectRaw('MAX(id)')->groupBy('student_id');
        $latest = QuizAttempt::whereIn('id', $latestIds);
        $passed = (clone $latest)->where('passed', true)->count();
        $participants = (int) $summary->participants;
        // All aggregation happens in SQL, never load the whole class/event dataset into PHP.
        $distribution = (clone $query)->selectRaw(
            'SUM(CASE WHEN score < 50 THEN 1 ELSE 0 END) AS below_50, '
            .'SUM(CASE WHEN score >= 50 AND score < 70 THEN 1 ELSE 0 END) AS from_50_to_69, '
            .'SUM(CASE WHEN score >= 70 AND score < 90 THEN 1 ELSE 0 END) AS from_70_to_89, '
            .'SUM(CASE WHEN score >= 90 THEN 1 ELSE 0 END) AS from_90_to_100'
        )->first();
        $attempts = (clone $query)->select([
            'id', 'quiz_id', 'student_id', 'attempt_number', 'status', 'started_at', 'expires_at',
            'submitted_at', 'score', 'max_score', 'passed', 'duration_seconds', 'draft_version', 'auto_submitted',
        ])->with('student:id,name')->orderByDesc('id')->paginate(20);
        return response()->json([
            'quiz' => ['learning_object_id' => $object->id, 'title' => $object->title],
            'summary' => [
                'enrolled_students' => $course->students()->count(),
                'participants' => $participants, 'total_attempts' => (int) $summary->total_attempts,
                'average_score' => $summary->average_score === null ? null : round((float) $summary->average_score, 2),
                'highest_score' => $summary->highest_score === null ? null : (float) $summary->highest_score,
                'pass_rate' => $participants ? round(100 * $passed / $participants, 2) : null,
            ],
            'score_distribution' => collect(['below_50', 'from_50_to_69', 'from_70_to_89', 'from_90_to_100'])
                ->mapWithKeys(fn ($key) => [$key => (int) $distribution->$key]),
            'attempts' => $attempts,
        ]);
    }

    public function show(Request $request, Course $course, int $learningObject, int $attempt): JsonResponse
    {
        $this->engine->object($request, $course, $learningObject, false);
        $record = QuizAttempt::whereKey($attempt)->where('status', 'completed')
            ->whereIn('quiz_id', DB::table('quizzes')->select('id')->where('learning_object_id', $learningObject))
            ->with(['student:id,name', 'answers'])->firstOrFail();
        return response()->json($this->engine->result($record) + ['student' => $record->student]);
    }
}
