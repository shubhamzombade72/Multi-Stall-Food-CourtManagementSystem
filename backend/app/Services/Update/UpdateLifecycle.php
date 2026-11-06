<?php

namespace App\Services\Update;

use App\Models\UpdateClient;
use App\Models\UpdateDeploymentTarget;
use App\Models\UpdateEvent;
use App\Services\AuditService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * The one writer of a deployment target's status. A client reports what it did; the server decides whether that is
 * possible. A status that does not follow from the current one, a download that never happened, or a completion whose
 * facts do not match the signed release is refused and recorded, never stored as true.
 */
class UpdateLifecycle
{
    public const AVAILABLE = 'UPDATE_AVAILABLE';
    public const APPROVED = 'CLIENT_APPROVED';
    public const DOWNLOADING = 'DOWNLOADING';
    public const VERIFYING = 'VERIFYING';
    public const BACKUP = 'BACKUP_IN_PROGRESS';
    public const MIGRATING = 'MIGRATING';
    public const INSTALLING = 'INSTALLING';
    public const HEALTH = 'HEALTH_CHECK';
    public const COMPLETED = 'COMPLETED';
    public const FAILED = 'FAILED';
    public const RECOVERING = 'RECOVERY_IN_PROGRESS';
    public const RECOVERED = 'RECOVERED';

    public const STATUSES = [self::AVAILABLE, self::APPROVED, self::DOWNLOADING, self::VERIFYING, self::BACKUP, self::MIGRATING, self::INSTALLING, self::HEALTH, self::COMPLETED, self::FAILED, self::RECOVERING, self::RECOVERED];

    /** Forward path. FAILED and RECOVERY_IN_PROGRESS are reachable from any status that is not final (see next()). */
    private const FORWARD = [
        self::AVAILABLE => [self::APPROVED],
        self::APPROVED => [self::DOWNLOADING],
        self::DOWNLOADING => [self::VERIFYING],
        self::VERIFYING => [self::BACKUP, self::DOWNLOADING],
        self::BACKUP => [self::MIGRATING, self::INSTALLING],
        self::MIGRATING => [self::INSTALLING],
        self::INSTALLING => [self::HEALTH],
        self::HEALTH => [self::COMPLETED],
        self::FAILED => [self::RECOVERING, self::RECOVERED, self::APPROVED],
        self::RECOVERING => [self::RECOVERED, self::FAILED],
        self::RECOVERED => [self::APPROVED],
        self::COMPLETED => [],
    ];

    public static function next(string $from): array
    {
        $next = self::FORWARD[$from] ?? [];
        if (!in_array($from, [self::COMPLETED, self::FAILED, self::RECOVERING, self::RECOVERED], true)) {
            $next = [...$next, self::FAILED, self::RECOVERING];
        }

        return $next;
    }

    /**
     * Applies a reported status. Returns ['ok' => bool, 'status' => current, 'code' => refusal code on failure].
     * Reporting the current status again is accepted without any change, so an offline outbox may safely retry.
     */
    public static function report(UpdateDeploymentTarget $target, string $status, array $input): array
    {
        return DB::transaction(function () use ($target, $status, $input) {
            $locked = UpdateDeploymentTarget::query()->lockForUpdate()->findOrFail($target->id);
            $client = UpdateClient::findOrFail($locked->client_id);

            if ($locked->status === $status) {
                return ['ok' => true, 'status' => $status, 'idempotent' => true];
            }
            // A paired terminal has no local database, so it goes from verifying straight to installing
            $terminalSkip = $locked->status === self::VERIFYING && $status === self::INSTALLING && $client->mode === 'remote';
            if (!$terminalSkip && !in_array($status, self::next($locked->status), true)) {
                return self::refuse($locked, $client, $status, 'illegal_transition', "Cannot move from {$locked->status} to {$status}.");
            }
            if ($status === self::VERIFYING && !self::downloadHappened($locked)) {
                return self::refuse($locked, $client, $status, 'no_download', 'No download of this package was recorded for this device.');
            }

            $extra = [];
            if ($status === self::COMPLETED) {
                $problem = self::completionProblem($locked, $client, $input);
                if ($problem) {
                    return self::refuse($locked, $client, $status, 'completion_rejected', $problem);
                }
                $extra['completed_at'] = now();
                $client->forceFill([
                    'verified_app_version' => $locked->release->version,
                    'verified_schema_fingerprint' => $input['schema_fingerprint'] ?? null,
                    'reported_app_version' => $locked->release->version,
                    'last_success_at' => now(),
                ])->save();
                AuditService::log('update_completed', 'UpdateDeploymentTarget', $locked->id, null, null, ['client' => $client->id, 'version' => $locked->release->version]);
            }
            if ($status === self::FAILED) {
                $client->forceFill(['last_failure_at' => now()])->save();
                $extra['last_error'] = mb_substr((string) ($input['message'] ?? 'The update failed.'), 0, 1000);
            }
            if ($status === self::DOWNLOADING && !$locked->download_started_at) {
                $extra['download_started_at'] = now();
            }

            $locked->forceFill(['status' => $status, ...$extra])->save();
            self::event($client, $locked, $input['category'] ?? self::categoryOf($status), $status, $status === self::FAILED, $input['message'] ?? null, $input['details'] ?? null, $input['client_time'] ?? null);

            return ['ok' => true, 'status' => $status];
        });
    }

    private static function downloadHappened(UpdateDeploymentTarget $target): bool
    {
        return \App\Models\UpdateDownloadToken::query()->where('target_id', $target->id)->whereNotNull('first_used_at')->exists();
    }

    /** Null when the reported completion agrees with what the server itself knows about this release and device. */
    private static function completionProblem(UpdateDeploymentTarget $target, UpdateClient $client, array $input): ?string
    {
        $release = $target->release;
        $package = $target->package;
        if (!$package || !$package->uploaded_at) {
            return 'No package was assigned to this update.';
        }
        if (!self::downloadHappened($target)) {
            return 'No download of this package was recorded for this device.';
        }
        if (($input['app_version'] ?? null) !== $release->version) {
            return 'The running version reported does not match the release.';
        }
        if (!hash_equals($package->manifest_sha256, (string) ($input['manifest_sha256'] ?? ''))) {
            return 'The installed manifest does not match the published one.';
        }
        $health = $input['health'] ?? [];
        foreach (['startup', 'database', 'migrations_current', 'schema_compatible'] as $key) {
            if (($health[$key] ?? null) !== true) {
                return "The health report is missing or failed: {$key}.";
            }
        }
        $expected = $package->manifest()['database']['schema_fingerprint'] ?? null;
        if ($client->mode !== 'remote' && $expected && !hash_equals($expected, (string) ($input['schema_fingerprint'] ?? ''))) {
            return 'The database schema reported does not match this release.';
        }
        $proof = self::proof($client->token_hash, $target, $package->manifest_sha256, (string) ($input['schema_fingerprint'] ?? ''));
        if (!$target->proof_nonce || !hash_equals($proof, (string) ($input['proof'] ?? ''))) {
            return 'The completion proof is not valid.';
        }

        return null;
    }

    /** Keyed with the SHA-256 of the device token: only the device and this server can produce it. */
    public static function proof(string $tokenHash, UpdateDeploymentTarget $target, string $manifestSha256, string $schemaFingerprint): string
    {
        return hash_hmac('sha256', implode('|', [$target->id, $target->proof_nonce, $target->release->version, $manifestSha256, $schemaFingerprint]), $tokenHash);
    }

    private static function refuse(UpdateDeploymentTarget $target, UpdateClient $client, string $status, string $code, string $message): array
    {
        self::event($client, $target, 'security', $status, true, "Refused: {$message}", ['code' => $code]);

        return ['ok' => false, 'status' => $target->status, 'code' => $code, 'message' => $message];
    }

    public static function event(?UpdateClient $client, ?UpdateDeploymentTarget $target, string $category, ?string $status, bool $isError, ?string $message, ?array $details = null, ?string $clientTime = null): void
    {
        UpdateEvent::create([
            'client_id' => $client?->id,
            'target_id' => $target?->id,
            'release_id' => $target?->release_id,
            'category' => $category,
            'status' => $status,
            'is_error' => $isError,
            'message' => $message === null ? null : mb_substr($message, 0, 1000),
            'details' => $details,
            'client_time' => $clientTime ? self::parseTime($clientTime) : null,
        ]);
    }

    private static function parseTime(string $value): ?Carbon
    {
        try {
            return Carbon::parse($value);
        } catch (\Throwable) {
            return null;
        }
    }

    private static function categoryOf(string $status): string
    {
        return match ($status) {
            self::DOWNLOADING, self::VERIFYING => 'download',
            self::MIGRATING => 'migration',
            self::INSTALLING => 'install',
            self::HEALTH => 'health',
            self::RECOVERING, self::RECOVERED => 'recovery',
            default => 'lifecycle',
        };
    }
}
