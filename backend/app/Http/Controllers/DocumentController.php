<?php

namespace App\Http\Controllers;

use App\Http\Requests\UploadDocumentRequest;
use App\Models\Course;
use App\Models\TeachingDocument;
use App\Services\RagService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Throwable;

class DocumentController
{
    public function index(Request $request, Course $course): JsonResponse
    {
        abort_unless($course->lecturer_id === $request->user()->id, 403);
        $request->validate([
            'page' => ['sometimes', 'integer', 'min:1'],
            'q' => ['nullable', 'string', 'max:120'],
        ]);
        $query = trim((string) ($request->input('q') ?? ''));

        $page = $course->documents()
            ->when($query !== '', fn ($documents) => $documents->where('original_name', 'like', "%{$query}%"))
            ->orderByDesc('id')
            ->paginate(20);

        return response()->json(['documents' => $page->items(), 'meta' => [
            'current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total(),
        ]]);
    }

    public function store(UploadDocumentRequest $request, Course $course): JsonResponse
    {
        $file = $request->file('document');
        $name = Str::uuid().'.'.strtolower($file->getClientOriginalExtension());
        // storeAs streams the upload to disk instead of reading the whole file into PHP RAM.
        $path = $file->storeAs('documents/'.$course->id, $name, 'local');
        abort_if($path === false, 503, 'Không thể lưu tài liệu.');
        try {
            $document = TeachingDocument::create([
                'course_id' => $course->id,
                'uploaded_by' => $request->user()->id,
                'file_name' => $name,
                'original_name' => $file->getClientOriginalName(),
                'file_path' => $path,
                'stored_path' => $path,
                'file_size' => $file->getSize(),
                'size_bytes' => $file->getSize(),
                'mime_type' => $file->getMimeType() ?: 'application/octet-stream',
                'extension' => strtolower($file->getClientOriginalExtension()),
                'processing_status' => 'uploaded_pending_processing',
            ]);
        } catch (Throwable $exception) {
            Storage::disk('local')->delete($path);
            throw $exception;
        }
        return response()->json(['document' => $document], 201);
    }

    public function download(Request $request, Course $course, TeachingDocument $document): BinaryFileResponse
    {
        abort_unless($course->lecturer_id === $request->user()->id, 403);
        abort_unless($document->course_id === $course->id, 404);
        $path = $document->file_path ?? $document->stored_path;
        return Storage::disk('local')->download($path, $document->original_name);
    }

    public function destroy(Request $request, Course $course, TeachingDocument $document, RagService $rag): JsonResponse
    {
        abort_unless($course->lecturer_id === $request->user()->id, 403);
        abort_unless($document->course_id === $course->id, 404);

        if ($document->processing_status === 'processing') {
            return response()->json(['message' => 'This document is currently being processed and cannot be deleted yet.'], 409);
        }

        if (in_array($document->processing_status, ['processed', 'failed'], true)) {
            try {
                $rag->deleteDocumentVectors($document);
            } catch (\RuntimeException $exception) {
                return response()->json(['message' => 'Document deletion is paused because vector cleanup is unavailable.'], 503);
            }
        }

        $path = $document->file_path ?? $document->stored_path;
        if ($path) {
            Storage::disk('local')->delete($path);
        }
        $document->delete();
        return response()->json(['message' => 'Document deleted.']);
    }
}
