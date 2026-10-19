<?php

use App\Http\Controllers\AdminUserController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\CourseController;
use App\Http\Controllers\DocumentController;
use Illuminate\Support\Facades\Route;

Route::get('/health', fn () => response()->json(['status' => 'ok', 'service' => 'laravel-api']));
Route::post('/auth/register', [AuthController::class, 'register']);
Route::post('/auth/login', [AuthController::class, 'login']);

// Password reset & recovery endpoints
Route::post('/auth/password-reset/request', [AuthController::class, 'requestPasswordReset']);
Route::post('/auth/password-recovery/request', [AuthController::class, 'requestPasswordReset']);
Route::post('/auth/password-reset', [AuthController::class, 'resetPassword']);
Route::post('/auth/password-recovery/reset', [AuthController::class, 'resetPassword']);

// Every product route below resolves the bearer token before a controller can trust $request->user().
Route::middleware('auth.token')->group(function () {
    Route::get('/auth/me', [AuthController::class, 'me']);
    Route::post('/auth/logout', [AuthController::class, 'logout']);

    // Admin user management (PB09)
    Route::get('/admin/users', [AdminUserController::class, 'index'])->middleware('role:admin');
    Route::patch('/admin/users/{user}', [AdminUserController::class, 'update'])->middleware('role:admin');

    // Courses (accessible to lecturer, student, admin)
    Route::get('/courses', [CourseController::class, 'index']);
    Route::get('/courses/{course}', [CourseController::class, 'show']);

    Route::middleware('role:lecturer')->group(function () {
        Route::post('/courses', [CourseController::class, 'store']);
        Route::patch('/courses/{course}', [CourseController::class, 'update']);
        Route::post('/courses/{course}/enrollments', [CourseController::class, 'enroll']);

        Route::get('/courses/{course}/documents', [DocumentController::class, 'index']);
        Route::post('/courses/{course}/documents', [DocumentController::class, 'store']);
        Route::get('/courses/{course}/documents/{document}/download', [DocumentController::class, 'download']);
        Route::delete('/courses/{course}/documents/{document}', [DocumentController::class, 'destroy']);
    });
});
