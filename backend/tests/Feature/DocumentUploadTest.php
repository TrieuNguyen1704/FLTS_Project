<?php

namespace Tests\Feature;

use App\Models\TeachingDocument;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

class DocumentUploadTest extends CourseDocumentTestCase
{
    public function test_pdf_doc_and_docx_store_files_and_pending_metadata(): void
    {
        $course = $this->course($this->user());
        foreach (['pdf' => 'application/pdf', 'doc' => 'application/msword', 'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] as $extension => $mime) {
            $response = $this->withToken('owner')->post('/api/courses/'.$course->id.'/documents', [
                'document' => UploadedFile::fake()->create('lecture.'.$extension, 10, $mime),
            ])->assertCreated()->assertJsonPath('document.processing_status', 'uploaded_pending_processing')
                ->assertJsonPath('document.status', 'uploaded_pending_processing')->assertJsonMissingPath('document.file_path');
            $document = TeachingDocument::findOrFail($response->json('document.id'));
            Storage::disk('local')->assertExists($document->file_path);
            $this->assertSame(10240, $document->file_size);
            $this->assertSame($course->id, $document->course->id);
            $this->assertStringStartsWith('documents/'.$course->id.'/', $document->file_path);
        }
    }

    public function test_exe_spoofed_mime_and_missing_file_are_rejected(): void
    {
        $course = $this->course($this->user());
        $url = '/api/courses/'.$course->id.'/documents';
        $this->withToken('owner')->post($url)->assertUnprocessable();
        foreach ([
            UploadedFile::fake()->create('bad.exe', 10, 'application/x-msdownload'),
            UploadedFile::fake()->create('bad.pdf', 10, 'text/plain'),
            UploadedFile::fake()->create('bad.exe', 10, 'application/pdf'),
        ] as $file) $this->post($url, ['document' => $file])->assertUnprocessable();
        $this->assertDatabaseCount('teaching_documents', 0);
        $this->assertSame([], Storage::disk('local')->allFiles());
    }

    public function test_exact_twenty_mb_allowed_and_one_kb_over_rejected(): void
    {
        $course = $this->course($this->user());
        $url = '/api/courses/'.$course->id.'/documents';
        $this->withToken('owner')->post($url, ['document' => UploadedFile::fake()->create('limit.pdf', 20480, 'application/pdf')])->assertCreated();
        $this->post($url, ['document' => UploadedFile::fake()->create('large.pdf', 20481, 'application/pdf')])->assertUnprocessable();
        $this->assertDatabaseCount('teaching_documents', 1);
    }

    public function test_non_owner_student_and_anonymous_cannot_upload(): void
    {
        $course = $this->course($this->user());
        $this->user('other');
        $this->user('student', 'student');
        $url = '/api/courses/'.$course->id.'/documents';
        foreach (['other', 'student'] as $token) {
            $this->withToken($token)->post($url, ['document' => UploadedFile::fake()->create('lecture.pdf', 10, 'application/pdf')])->assertForbidden();
        }
        $this->withHeader('Authorization', '')->post($url)->assertUnauthorized();
        $this->assertDatabaseCount('teaching_documents', 0);
        $this->assertSame([], Storage::disk('local')->allFiles());
    }

    public function test_same_filename_never_overwrites_existing_file(): void
    {
        $course = $this->course($this->user());
        for ($i = 0; $i < 2; $i++) {
            $this->withToken('owner')->post('/api/courses/'.$course->id.'/documents', [
                'document' => UploadedFile::fake()->create('same.pdf', 10, 'application/pdf'),
            ])->assertCreated();
        }
        $this->assertCount(2, array_unique(TeachingDocument::pluck('file_path')->all()));
        $this->assertCount(2, Storage::disk('local')->allFiles());
    }

    public function test_document_list_is_paginated_and_owner_only(): void
    {
        $course = $this->course($this->user());
        $this->user('other');
        for ($i = 0; $i < 21; $i++) {
            $course->documents()->create(['file_name' => 'f'.$i, 'original_name' => 'f'.$i.'.pdf', 'file_path' => 'documents/f'.$i, 'mime_type' => 'application/pdf', 'file_size' => 100]);
        }
        $this->withToken('owner')->getJson('/api/courses/'.$course->id.'/documents')->assertOk()->assertJsonCount(20, 'documents');
        $this->getJson('/api/courses/'.$course->id.'/documents?page=2')->assertOk()->assertJsonCount(1, 'documents');
        $this->withToken('other')->getJson('/api/courses/'.$course->id.'/documents')->assertForbidden();
    }
}
