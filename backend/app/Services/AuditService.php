<?php

namespace App\Services;

use App\Models\AuditLog;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Request;

class AuditService
{
    /**
     * Record an audit log entry.
     */
    public static function log(
        string $action,
        string $entityType,
        string|int $entityId,
        ?int $stallId = null,
        ?array $oldValues = null,
        ?array $newValues = null,
        ?int $userId = null
    ): ?AuditLog {
        try {
            return AuditLog::create([
                'user_id' => $userId ?? (Auth::check() ? Auth::id() : null),
                'stall_id' => $stallId,
                'action' => $action,
                'entity_type' => $entityType,
                'entity_id' => (string) $entityId,
                'ip_address' => Request::ip() ?? '127.0.0.1',
                'old_values' => $oldValues,
                'new_values' => $newValues,
                'created_at' => now(),
            ]);
        } catch (\Throwable $e) {
            // Audit logging should not crash the primary transaction if non-fatal
            \Illuminate\Support\Facades\Log::error('Failed to write audit log: ' . $e->getMessage());
            return null;
        }
    }
}

