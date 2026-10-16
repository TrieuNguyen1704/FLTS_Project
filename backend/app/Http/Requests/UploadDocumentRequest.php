<?php

namespace App\Http\Requests;

use App\Models\Course;
use Illuminate\Foundation\Http\FormRequest;

class UploadDocumentRequest extends FormRequest
{
    public function authorize(): bool
    {
        $course = $this->route('course');
        return $course instanceof Course && $this->user()?->role === 'lecturer'
            && $course->lecturer_id === $this->user()->id;
    }
    public function rules(): array
    {
        return ['document' => ['bail', 'required', 'file', 'mimes:pdf,doc,docx', 'extensions:pdf,doc,docx', 'max:20480']];
    }
    public function messages(): array
    {
        return [
            'document.required' => 'Vui lòng chọn tài liệu.',
            'document.mimes' => 'Chỉ chấp nhận PDF, DOC hoặc DOCX.',
            'document.extensions' => 'Tên tài liệu phải có đuôi PDF, DOC hoặc DOCX.',
            'document.max' => 'Tài liệu vượt quá giới hạn 20 MB.',
        ];
    }
}
