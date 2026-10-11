<?php

namespace Tests\Feature;

use Illuminate\Http\UploadedFile;

class CourseAndDocumentTest extends CourseDocumentTestCase
{
    public function test_lecturer_creates_course_then_uploads_pdf_and_rejects_exe_and_oversize(): void
    {
        $this->user();
        $id = $this->withToken('owner')->postJson('/api/courses', ['name' => 'Capstone', 'code' => 'CMU-SE 450'])
            ->assertCreated()->json('course.id');
        $this->getJson('/api/courses/'.$id)->assertOk();
        $url = '/api/courses/'.$id.'/documents';
        $this->post($url, ['document' => UploadedFile::fake()->create('lecture.pdf', 10, 'application/pdf')])
            ->assertCreated()->assertJsonPath('document.processing_status', 'uploaded_pending_processing');
        $this->post($url, ['document' => UploadedFile::fake()->create('bad.exe', 10, 'application/x-msdownload')])->assertUnprocessable();
        $this->post($url, ['document' => UploadedFile::fake()->create('large.pdf', 20481, 'application/pdf')])->assertUnprocessable();
    }
}
