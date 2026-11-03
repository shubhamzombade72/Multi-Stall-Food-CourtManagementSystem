<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\SetupState;
use App\Services\SystemHealth;

class SystemController extends Controller
{
    /**
     * Readiness report used by the desktop app (and any monitor) after /up answers: can the API reach its
     * database, are the migrations current, and (built-in server only) has the owner been set up.
     */
    public function ready()
    {
        $database = SystemHealth::databaseReachable();
        $migrations = $database && SystemHealth::migrationsCurrent();
        $ready = $database && $migrations;

        return response()->json([
            'success' => $ready,
            'data' => [
                'ready' => $ready,
                'database' => $database,
                'migrations_current' => $migrations,
                'setup' => $ready && config('foodcourt.embedded') ? SetupState::state() : null,
            ],
        ], $ready ? 200 : 503);
    }
}
