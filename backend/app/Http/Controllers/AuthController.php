<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Mail\PasswordResetMail;
use App\Mail\WelcomeMail;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

class AuthController
{
    public function register(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
            'role' => ['required', 'in:lecturer,student'],
        ]);

        $user = User::create([
            'name' => $data['name'],
            'email' => strtolower($data['email']),
            'password' => Hash::make($data['password']),
            'role' => $data['role'],
        ]);

        try {
            Mail::to($user->email)->send(new WelcomeMail($user));
        } catch (\Throwable $e) {
            Log::warning('Failed to send welcome email: ' . $e->getMessage());
        }

        return response()->json(['user' => $user], 201);
    }

    public function login(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);
        $user = User::where('email', strtolower($data['email']))->first();

        if (!$user || !Hash::check($data['password'], $user->password)) {
            return response()->json(['message' => 'Invalid email or password.'], 422);
        }
        if ($user->account_status !== 'active') {
            return response()->json(['message' => 'This account is suspended.'], 403);
        }

        $token = Str::random(64);
        // Keep only a hash in MySQL so an accidental database export cannot replay an active bearer token.
        $user->forceFill(['api_token_hash' => hash('sha256', $token)])->save();

        return response()->json(['token' => $token, 'user' => $user]);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json(['user' => $request->user()]);
    }

    public function logout(Request $request): JsonResponse
    {
        // This demo supports one active token per account; clearing it revokes the current session.
        $request->user()->forceFill(['api_token_hash' => null])->save();
        return response()->json(['message' => 'Logged out.']);
    }

    public function requestPasswordReset(Request $request): JsonResponse
    {
        $data = $request->validate(['email' => ['required', 'email']]);
        $email = strtolower($data['email']);
        $user = User::where('email', $email)->first();

        // Keep this response neutral so callers cannot use the endpoint to enumerate registered accounts.
        if ($user && $user->account_status === 'active') {
            $token = Str::random(64);
            DB::table('password_reset_tokens')->updateOrInsert(
                ['email' => $email],
                ['token' => hash('sha256', $token), 'expires_at' => CarbonImmutable::now()->addHour(), 'created_at' => CarbonImmutable::now()]
            );
            Mail::to($user->email)->send(new PasswordResetMail($user->email, $token));
        }

        return response()->json(['message' => 'If an active account matches this email, a password-reset link has been sent.']);
    }

    public function resetPassword(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'token' => ['required', 'string', 'size:64'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ]);
        $email = strtolower($data['email']);
        $record = DB::table('password_reset_tokens')->where('email', $email)->first();

        if (!$record || $record->expires_at < CarbonImmutable::now() || !hash_equals($record->token, hash('sha256', $data['token']))) {
            return response()->json(['message' => 'This password-reset link is invalid or has expired.'], 422);
        }

        DB::transaction(function () use ($email, $data) {
            User::where('email', $email)->update([
                'password' => Hash::make($data['password']),
                'api_token_hash' => null,
                'updated_at' => now(),
            ]);
            DB::table('password_reset_tokens')->where('email', $email)->delete();
        });

        return response()->json(['message' => 'Your password has been reset. Please sign in.']);
    }
}
