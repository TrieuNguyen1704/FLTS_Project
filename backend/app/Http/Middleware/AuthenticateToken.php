<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class AuthenticateToken
{
    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->bearerToken();
        if (!$token) {
            return response()->json(['message' => 'Authentication token is required.'], 401);
        }

        // Compare a derived value because the raw bearer token is deliberately never persisted.
        $user = User::where('api_token_hash', hash('sha256', $token))->first();
        // A suspended account loses access immediately even when a browser still holds its prior bearer token.
        if ($user && $user->account_status !== 'active') {
            $user->forceFill(['api_token_hash' => null])->save();
            $user = null;
        }
        if (!$user) {
            return response()->json(['message' => 'Authentication token is invalid or expired.'], 401);
        }

        $request->setUserResolver(fn () => $user);
        return $next($request);
    }
}
