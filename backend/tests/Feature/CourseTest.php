<?php

namespace Tests\Feature;

use App\Models\Course;
use Illuminate\Database\QueryException;

class CourseTest extends CourseDocumentTestCase
{
    public function test_lecturer_creates_course_with_correct_owner_and_lecturer_pivot(): void
    {
        $owner = $this->user();
        $other = $this->user('other');
        $id = $this->withToken('owner')->postJson('/api/courses', [
            'name' => ' Software Engineering ', 'code' => ' CMU-SE 450 ', 'lecturer_id' => $other->id,
        ])->assertCreated()->assertJsonPath('course.lecturer_id', $owner->id)->json('course.id');
        $this->assertDatabaseHas('course_lecturers', ['course_id' => $id, 'lecturer_id' => $owner->id]);
        $this->assertSame($owner->id, Course::findOrFail($id)->lecturer->id);
        $this->assertSame($owner->id, Course::findOrFail($id)->lecturers->first()->id);
    }

    public function test_list_and_detail_do_not_leak_another_lecturers_courses(): void
    {
        $owner = $this->user();
        $own = $this->course($owner);
        $other = $this->course($this->user('other'), 'PRIVATE');
        $this->withToken('owner')->getJson('/api/courses')->assertOk()->assertJsonCount(1, 'courses');
        $this->getJson('/api/courses/'.$own->id)->assertOk()->assertJsonPath('course.id', $own->id);
        $this->getJson('/api/courses/'.$other->id)->assertForbidden();
    }

    public function test_invalid_and_duplicate_course_data_are_rejected(): void
    {
        $this->course($this->user());
        $this->withToken('owner')->postJson('/api/courses', ['name' => 'Duplicate', 'code' => 'CMU-SE 450'])
            ->assertUnprocessable()->assertJsonValidationErrors('code');
        $this->postJson('/api/courses', ['name' => ' ', 'code' => ' '])
            ->assertUnprocessable()->assertJsonValidationErrors(['name', 'code']);
    }

    public function test_student_and_anonymous_user_cannot_create_courses(): void
    {
        $this->user('student', 'student');
        $this->withToken('student')->postJson('/api/courses', ['name' => 'Denied', 'code' => 'DENIED'])->assertForbidden();
        $this->withHeader('Authorization', '')->postJson('/api/courses', [])->assertUnauthorized();
    }

    public function test_courses_are_paginated_in_bounded_pages(): void
    {
        $owner = $this->user();
        for ($i = 0; $i < 21; $i++) $this->course($owner, 'COURSE-'.$i);
        $this->withToken('owner')->getJson('/api/courses')->assertOk()->assertJsonCount(20, 'courses')->assertJsonPath('meta.total', 21);
        $this->getJson('/api/courses?page=2')->assertOk()->assertJsonCount(1, 'courses');
        $this->getJson('/api/courses?page=0')->assertUnprocessable();
    }

    public function test_unique_code_is_enforced_by_database(): void
    {
        $owner = $this->user();
        $this->course($owner);
        $this->expectException(QueryException::class);
        $this->course($owner);
    }
}
