<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The same codebase runs on every client, so update management answers 404 unless this deployment was explicitly made
 * the update service. A PC's built-in server can never be one, whatever its environment says.
 */
class EnsureUpdateService
{
    public function handle(Request $request, Closure $next): Response
    {
        abort_unless(config('foodcourt.updates.service') && !config('foodcourt.embedded'), 404);

        return $next($request);
    }
}
