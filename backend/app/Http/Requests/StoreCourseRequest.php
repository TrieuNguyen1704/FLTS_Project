<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreCourseRequest extends FormRequest
{
    public function authorize(): bool { return $this->user()?->role === 'lecturer'; }
    protected function prepareForValidation(): void
    {
        foreach (['name', 'code'] as $field) {
            if (is_string($this->input($field))) $this->merge([$field => trim($this->input($field))]);
        }
    }
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:160'],
            'code' => ['required', 'string', 'max:50', Rule::unique('courses', 'code')],
            'description' => ['nullable', 'string', 'max:2000'],
        ];
    }
    public function messages(): array { return ['code.unique' => 'Mã khóa học đã tồn tại.']; }
}
