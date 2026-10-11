<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreCourseRequest;
use App\Models\Course;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class CourseController
{
    public function index(Request $request): JsonResponse
    {
        $request->validate(['page' => ['sometimes', 'integer', 'min:1']]);
        $page = $request->user()->courses()->with('lecturer:id,name')->orderByDesc('id')->paginate(20);
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
        abort_unless($course->lecturer_id === $request->user()->id, 403);
        return response()->json(['course' => $course->load('lecturer:id,name')->loadCount('documents')]);
    }
}
