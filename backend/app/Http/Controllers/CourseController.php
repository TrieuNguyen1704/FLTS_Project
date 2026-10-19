<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreCourseRequest;
use App\Models\Course;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class CourseController
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $request->validate(['page' => ['sometimes', 'integer', 'min:1']]);

        if ($user->role === 'student') {
            $query = Course::query()->whereHas('students', fn ($q) => $q->where('users.id', $user->id));
        } else {
            $query = $user->courses();
        }

        $page = $query->with('lecturer:id,name')->orderByDesc('id')->paginate(20);
        return response()->json(['courses' => $page->items(), 'meta' => [
            'current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total(),
        ]]);
    }

    public function store(StoreCourseRequest $request): JsonResponse
    {
        $course = DB::transaction(function () use ($request) {
            $course = $request->user()->courses()->create($request->validated());
            $course->lecturers()->attach($request->user()->id);
            return $course;
        });
        return response()->json(['course' => $course], 201);
    }

    public function show(Request $request, Course $course): JsonResponse
    {
        abort_unless($course->lecturer_id === $request->user()->id || $course->students()->where('users.id', $request->user()->id)->exists(), 403);
        return response()->json(['course' => $course->load('lecturer:id,name')->loadCount('documents')]);
    }

    public function update(Request $request, Course $course): JsonResponse
    {
        abort_unless($course->lecturer_id === $request->user()->id, 403);
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:120'],
            'description' => ['nullable', 'string', 'max:2000'],
        ]);
        $course->update($data);
        return response()->json(['course' => $course->fresh()->load('lecturer:id,name')]);
    }

    public function enroll(Request $request, Course $course): JsonResponse
    {
        abort_unless($course->lecturer_id === $request->user()->id, 403);
        $data = $request->validate([
            'student_id' => ['required', 'exists:users,id'],
        ]);
        $student = User::where('id', $data['student_id'])->where('role', 'student')->firstOrFail();
        $course->students()->syncWithoutDetaching([$student->id]);
        return response()->json(['message' => 'Student enrolled successfully.']);
    }
}
