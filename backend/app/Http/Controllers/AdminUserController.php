<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AdminUserController
{
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate(['q' => ['nullable', 'string', 'max:120']]);
        $query = trim((string) ($data['q'] ?? ''));

        $users = User::query()
            ->select(['id', 'name', 'email', 'role', 'account_status', 'created_at'])
            ->when($query !== '', fn ($builder) => $builder->where(function ($matching) use ($query) {
                $matching->where('name', 'like', "%{$query}%")->orWhere('email', 'like', "%{$query}%");
            }))
            ->orderBy('id')
            ->get();

        return response()->json(['users' => $users]);
    }

    public function update(Request $request, User $user): JsonResponse
    {
        $data = $request->validate([
            'role' => ['sometimes', 'required', 'in:'.implode(',', User::ROLES)],
            'account_status' => ['sometimes', 'required', 'in:active,suspended'],
        ]);

        abort_if($data === [], 422, 'Provide a role or account status to update.');
        $actor = $request->user();

        // Prevent an accidental self-lockout while still allowing an Admin to manage every other account.
        abort_if($actor->id === $user->id, 422, 'You cannot change your own role or account status.');

        $nextRole = $data['role'] ?? $user->role;
        $nextStatus = $data['account_status'] ?? $user->account_status;
        if ($user->role === 'admin' && $user->account_status === 'active'
            && ($nextRole !== 'admin' || $nextStatus !== 'active')) {
            $otherActiveAdmins = User::query()->where('role', 'admin')->where('account_status', 'active')->whereKeyNot($user->id)->exists();
            abort_unless($otherActiveAdmins, 422, 'At least one active Administrator account must remain.');
        }

        $user->update($data);
        if ($user->account_status === 'suspended') {
            // Suspension must revoke the active demo token immediately rather than waiting for its next request.
            $user->forceFill(['api_token_hash' => null])->save();
        }

        return response()->json(['user' => $user->only(['id', 'name', 'email', 'role', 'account_status', 'created_at'])]);
    }
}
