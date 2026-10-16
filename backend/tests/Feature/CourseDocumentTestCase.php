<?php

namespace Tests\Feature;

use App\Models\Course;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

abstract class CourseDocumentTestCase extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void { parent::setUp(); Storage::fake('local'); }
    protected function user(string $name = 'owner', string $role = 'lecturer'): User
    {
        return User::create([
            'name' => $name, 'email' => $name.'@example.test', 'password' => 'not-used-for-token-tests',
            'role' => $role, 'api_token_hash' => hash('sha256', $name),
        ]);
    }
    protected function course(User $owner, string $code = 'CMU-SE 450'): Course
    {
        return $owner->courses()->create(['name' => 'Software Engineering', 'code' => $code]);
    }
}
