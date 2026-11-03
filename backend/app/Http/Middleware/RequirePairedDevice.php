<?php

namespace App\Http\Middleware;

use App\Models\PairedDevice;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * On a shared host with FOODCOURT_REQUIRE_PAIRING=true, only paired terminals may sign in or use the API.
 * Customer QR ordering, the readiness report and the pairing hand-shake itself stay open. A PC's built-in
 * server never enforces this.
 */
class RequirePairedDevice
{
    private const OPEN = ['api/pairing/redeem', 'api/public/*', 'api/system/ready'];

    public function handle(Request $request, Closure $next): Response
    {
        if (!config('foodcourt.require_paired_devices') || config('foodcourt.embedded') || $request->is(...self::OPEN)) {
            return $next($request);
        }

        $device = PairedDevice::findActive($request->header('X-Device-Token'));
        if (!$device) {
            return response()->json([
                'success' => false,
                'code' => 'device_not_paired',
                'message' => 'This computer is not connected to the food court. Ask the owner for a connection code.',
            ], 403);
        }

        if (!$device->last_seen_at || $device->last_seen_at->lt(now()->subMinute())) {
            $device->forceFill(['last_seen_at' => now()])->save();
        }

        return $next($request);
    }
}
