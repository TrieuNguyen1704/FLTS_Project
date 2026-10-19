<?php

namespace Tests\Feature;

use App\Models\Course;
use App\Models\User;
use App\Mail\PasswordResetMail;
use App\Mail\WelcomeMail;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
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

    public function test_password_reset_link_expires_and_can_only_be_used_once(): void
    {
        Mail::fake();
        $user = User::create(['name' => 'Reset User', 'email' => 'reset@test.dev', 'password' => Hash::make('OldPass123!'), 'role' => 'student']);

        $this->postJson('/api/auth/password-reset/request', ['email' => $user->email])->assertOk();
        $token = '';
        Mail::assertSent(PasswordResetMail::class, function (PasswordResetMail $mail) use (&$token, $user) {
            $token = $mail->token;
            return $mail->hasTo($user->email);
        });

        $this->postJson('/api/auth/password-reset', [
            'email' => $user->email, 'token' => $token, 'password' => 'NewPass123!', 'password_confirmation' => 'NewPass123!',
        ])->assertOk();
        $this->assertTrue(Hash::check('NewPass123!', $user->fresh()->password));
        $this->postJson('/api/auth/password-reset', [
            'email' => $user->email, 'token' => $token, 'password' => 'Another123!', 'password_confirmation' => 'Another123!',
        ])->assertUnprocessable();

        $this->postJson('/api/auth/password-reset/request', ['email' => $user->email])->assertOk();
        $expiredToken = '';
        Mail::assertSent(PasswordResetMail::class, function (PasswordResetMail $mail) use (&$expiredToken) { $expiredToken = $mail->token; return true; });
        DB::table('password_reset_tokens')->where('email', $user->email)->update(['expires_at' => now()->subMinute()]);
        $this->postJson('/api/auth/password-reset', [
            'email' => $user->email, 'token' => $expiredToken, 'password' => 'Another123!', 'password_confirmation' => 'Another123!',
        ])->assertUnprocessable();
    }

    public function test_admin_can_manage_other_accounts_and_suspension_revokes_access(): void
    {
        $admin = User::create(['name' => 'Admin', 'email' => 'admin@test.dev', 'password' => Hash::make('Password123!'), 'role' => 'admin']);
        $target = User::create(['name' => 'Target', 'email' => 'target@test.dev', 'password' => Hash::make('Password123!'), 'role' => 'student']);
        $member = User::create(['name' => 'Member', 'email' => 'member@test.dev', 'password' => Hash::make('Password123!'), 'role' => 'lecturer']);
        $adminToken = 'admin-token'; $admin->update(['api_token_hash' => hash('sha256', $adminToken)]);
        $memberToken = 'member-token'; $member->update(['api_token_hash' => hash('sha256', $memberToken)]);
        $targetToken = 'target-token'; $target->update(['api_token_hash' => hash('sha256', $targetToken)]);

        $this->withToken($memberToken)->getJson('/api/admin/users')->assertForbidden();
        $this->withToken($adminToken)->getJson('/api/admin/users?q=target')->assertOk()->assertJsonCount(1, 'users');
        $this->withToken($adminToken)->patchJson('/api/admin/users/'.$target->id, ['role' => 'lecturer', 'account_status' => 'suspended'])
            ->assertOk()->assertJsonPath('user.role', 'lecturer')->assertJsonPath('user.account_status', 'suspended');
        $this->assertDatabaseHas('users', ['id' => $target->id, 'role' => 'lecturer', 'account_status' => 'suspended', 'api_token_hash' => null]);
        $this->withToken($targetToken)->getJson('/api/auth/me')->assertUnauthorized();
        $this->withToken($adminToken)->patchJson('/api/admin/users/'.$admin->id, ['account_status' => 'suspended'])->assertUnprocessable();
    }

    public function test_student_cannot_create_or_view_unassigned_course(): void
    {
        $lecturer = User::create(['name' => 'Lecturer', 'email' => 'l@test.dev', 'password' => Hash::make('Password123!'), 'role' => 'lecturer']);
        $student = User::create(['name' => 'Student', 'email' => 's@test.dev', 'password' => Hash::make('Password123!'), 'role' => 'student']);
        $course = Course::create(['lecturer_id' => $lecturer->id, 'name' => 'Private', 'code' => 'P1']);
        $token = 'student-token'; $student->update(['api_token_hash' => hash('sha256', $token)]);
        $this->withToken($token)->postJson('/api/courses', ['name' => 'Nope', 'code' => 'N1'])->assertForbidden();
        $this->withToken($token)->getJson('/api/courses/'.$course->id)->assertForbidden();
    }

    public function test_lecturer_can_create_course_and_grant_student_access(): void
    {
        $lecturer = User::create(['name' => 'Lecturer', 'email' => 'l@test.dev', 'password' => Hash::make('Password123!'), 'role' => 'lecturer']);
        $student = User::create(['name' => 'Student', 'email' => 's@test.dev', 'password' => Hash::make('Password123!'), 'role' => 'student']);
        $lecturerToken = 'lecturer-token'; $lecturer->update(['api_token_hash' => hash('sha256', $lecturerToken)]);
        $studentToken = 'student-token'; $student->update(['api_token_hash' => hash('sha256', $studentToken)]);

        $courseId = $this->withToken($lecturerToken)->postJson('/api/courses', [
            'name' => 'Foundations', 'code' => 'FLIP-101', 'description' => 'Demo course',
        ])->assertCreated()->json('course.id');

        $this->withToken($lecturerToken)->patchJson('/api/courses/'.$courseId, ['name' => 'Updated Foundations'])
            ->assertOk()->assertJsonPath('course.name', 'Updated Foundations');

        $this->withToken($lecturerToken)->postJson('/api/courses/'.$courseId.'/enrollments', ['student_id' => $student->id])->assertOk();
        $this->withToken($studentToken)->getJson('/api/courses')->assertOk()->assertJsonCount(1, 'courses');
        $this->withToken($studentToken)->getJson('/api/courses/'.$courseId)->assertOk()->assertJsonPath('course.code', 'FLIP-101');
    }

    public function test_only_course_owner_can_upload_allowed_document(): void
    {
        $lecturer = User::create(['name' => 'Lecturer', 'email' => 'l@test.dev', 'password' => Hash::make('Password123!'), 'role' => 'lecturer']);
        $other = User::create(['name' => 'Other', 'email' => 'o@test.dev', 'password' => Hash::make('Password123!'), 'role' => 'lecturer']);
        $course = Course::create(['lecturer_id' => $lecturer->id, 'name' => 'Course', 'code' => 'C1']);
        $ownerToken = 'owner'; $lecturer->update(['api_token_hash' => hash('sha256', $ownerToken)]);
        $otherToken = 'other'; $other->update(['api_token_hash' => hash('sha256', $otherToken)]);
        $this->withToken($otherToken)->post('/api/courses/'.$course->id.'/documents', ['document' => UploadedFile::fake()->create('note.pdf', 10, 'application/pdf')])->assertForbidden();
        $this->withToken($ownerToken)->post('/api/courses/'.$course->id.'/documents', ['document' => UploadedFile::fake()->create('chapter-one.pdf', 10, 'application/pdf')])->assertCreated()->assertJsonPath('document.processing_status', 'uploaded_pending_processing');
        $this->withToken($ownerToken)->post('/api/courses/'.$course->id.'/documents', ['document' => UploadedFile::fake()->create('note.txt', 10, 'text/plain')])->assertUnprocessable();
        $this->withToken($ownerToken)->post('/api/courses/'.$course->id.'/documents', ['document' => UploadedFile::fake()->create('large.pdf', 20481, 'application/pdf')])->assertUnprocessable();
        $documentId = $this->withToken($ownerToken)->getJson('/api/courses/'.$course->id.'/documents?q=chapter')->assertOk()->assertJsonCount(1, 'documents')->json('documents.0.id');
        $this->withToken($otherToken)->get('/api/courses/'.$course->id.'/documents/'.$documentId.'/download')->assertForbidden();
        $this->withToken($ownerToken)->deleteJson('/api/courses/'.$course->id.'/documents/'.$documentId)->assertOk();
    }
}
