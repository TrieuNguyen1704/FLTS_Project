<?php

use App\Http\Middleware\AuthenticateToken;
use App\Http\Middleware\EnsureRole;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(api: __DIR__.'/../routes/api.php', health: '/up')
    ->withMiddleware(function (Middleware $middleware) {
        // Route aliases keep the API's authentication and role boundary explicit in routes/api.php.
        $middleware->alias([
            'auth.token' => AuthenticateToken::class,
            'role' => EnsureRole::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        $exceptions->shouldRenderJsonWhen(fn ($request) => $request->is('api/*'));
    })->create();
