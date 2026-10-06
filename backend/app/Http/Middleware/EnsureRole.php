<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureRole
{
    public function handle(Request $request, Closure $next, string ...$roles): Response
    {
        // This is a backend gate; hiding a Vue navigation link is only a usability measure.
        if (!$request->user() || !in_array($request->user()->role, $roles, true)) {
            return response()->json(['message' => 'You are not authorized for this action.'], 403);
        }

        return $next($request);
    }
}
