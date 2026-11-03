<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    // Token-authenticated clients (desktop, Android) authorize private channels at /api/broadcasting/auth
    ->withBroadcasting(
        __DIR__.'/../routes/channels.php',
        ['prefix' => 'api', 'middleware' => ['api', 'auth:sanctum', 'active']],
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'active' => \App\Http\Middleware\EnsureUserIsActive::class,
        ]);
        $middleware->appendToGroup('api', \App\Http\Middleware\RequirePairedDevice::class);
        $middleware->appendToGroup('api', \App\Http\Middleware\LogAccessDenied::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // Expected fulfilment refusals (403 role, 409 version/key conflict, 422 transition) are normal results of
        // double taps and races; they are rendered to the client and must not flood the error log.
        $exceptions->dontReport(\App\Exceptions\FulfillmentException::class);
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
