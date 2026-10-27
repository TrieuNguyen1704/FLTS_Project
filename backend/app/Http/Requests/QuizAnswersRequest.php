<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class QuizAnswersRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->role === 'student';
    }

    public function rules(): array
    {
        return [
            'draft_version' => ['required', 'integer', 'min:0'],
            'answers' => ['present', 'array', 'max:100'],
            'answers.*' => ['array:question_id,selected_option_id,time_spent_seconds'],
            'answers.*.question_id' => ['required', 'integer', 'min:1', 'distinct'],
            'answers.*.selected_option_id' => ['present', 'nullable', 'integer', 'min:1'],
            'answers.*.time_spent_seconds' => ['sometimes', 'integer', 'min:0', 'max:86400'],
        ];
    }
}
