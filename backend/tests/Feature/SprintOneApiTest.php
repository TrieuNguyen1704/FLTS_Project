<?php

namespace Tests\Feature;

use App\Models\User;
use App\Mail\WelcomeMail;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class SprintOneApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_registration_creates_a_lecturer_or_student_and_rejects_invalid_input(): void
    {
        Mail::fake();

        $this->postJson('/api/auth/register', [
            'name' => 'New Student', 'email' => 'new@student.test', 'role' => 'student',
            'password' => 'Password123!', 'password_confirmation' => 'Password123!',
        ])->assertCreated()->assertJsonPath('user.email', 'new@student.test')->assertJsonPath('user.role', 'student');

        $this->assertDatabaseHas('users', ['email' => 'new@student.test', 'role' => 'student', 'account_status' => 'active']);
        Mail::assertSent(WelcomeMail::class, function (WelcomeMail $mail) {
            return $mail->hasTo('new@student.test');
        });

        $this->postJson('/api/auth/register', [
            'name' => '', 'email' => 'not-an-email', 'role' => 'admin', 'password' => 'short', 'password_confirmation' => 'different',
        ])->assertUnprocessable()->assertJsonValidationErrors(['name', 'email', 'role', 'password']);
    }

    public function test_login_logout_invalidates_token(): void
    {
        User::create(['name' => 'Lecturer', 'email' => 'l@test.dev', 'password' => Hash::make('Password123!'), 'role' => 'lecturer']);
        $token = $this->postJson('/api/auth/login', ['email' => 'l@test.dev', 'password' => 'Password123!'])->assertOk()->json('token');
        $this->withToken($token)->postJson('/api/auth/logout')->assertOk();
        $this->withToken($token)->getJson('/api/auth/me')->assertUnauthorized();
    }
}
