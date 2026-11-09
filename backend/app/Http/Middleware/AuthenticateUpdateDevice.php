<?php

namespace App\Http\Middleware;

use App\Models\UpdateClient;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Every device operation proves the device: bearer token, matching device id, and a client that is still authorized. */
class AuthenticateUpdateDevice
{
    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->bearerToken();
        $client = $token ? UpdateClient::query()->where('token_hash', UpdateClient::hashToken($token))->first() : null;
        if (!$client || !hash_equals($client->device_id, (string) $request->header('X-Update-Device'))) {
            return response()->json(['success' => false, 'code' => 'device_unknown', 'message' => 'This computer is not registered for updates.'], 401);
        }
        if ($client->status !== 'authorized') {
            return response()->json(['success' => false, 'code' => 'device_not_authorized', 'message' => 'This computer is not authorized for updates.'], 403);
        }
        $request->attributes->set('update_client', $client);

        return $next($request);
    }
}
