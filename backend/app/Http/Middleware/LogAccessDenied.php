<?php

namespace App\Http\Middleware;

use App\Services\AuditService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Records every API request a signed-in user was refused (HTTP 403) in the audit log, so the owner can see
 * attempts to reach screens or records outside a role or stall.
 */
class LogAccessDenied
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        if ($response->getStatusCode() === 403 && ($user = $request->user('sanctum'))) {
            AuditService::log('access_denied', 'Route', mb_substr($request->method() . ' /' . $request->path(), 0, 190), $user->stall_id, null, [
                'role' => $user->role,
            ], $user->id);
        }

        return $response;
    }
}
