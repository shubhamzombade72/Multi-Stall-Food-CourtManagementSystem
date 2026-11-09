<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\UpdateClient;
use App\Models\UpdateDeploymentTarget;
use App\Models\UpdateDownloadToken;
use App\Models\UpdateEnrollmentCode;
use App\Models\UpdateEvent;
use App\Models\UpdateRelease;
use App\Services\AuditService;
use App\Services\Update\ManifestVerifier;
use App\Services\Update\UpdateLifecycle;
use App\Services\Update\UpdateOffers;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * The API a desktop update agent uses. A device only ever sees its own targets, gets 404 for anyone else's, and its
 * reports are validated by UpdateLifecycle rather than stored as facts.
 */
class UpdateClientController extends Controller
{
    private function client(Request $request): UpdateClient
    {
        return $request->attributes->get('update_client');
    }

    /** Own target only. A different device's id is simply not found. */
    private function target(Request $request, $id): UpdateDeploymentTarget
    {
        return UpdateDeploymentTarget::query()->where('client_id', $this->client($request)->id)->with(['release', 'package'])->findOrFail($id);
    }

    public function enroll(Request $request)
    {
        $data = $request->validate([
            'code' => 'required|string|max:40',
            'device_id' => 'required|string|regex:/^[A-Za-z0-9-]{16,64}$/',
            'name' => 'required|string|max:100',
            'machine_fingerprint' => 'nullable|string|regex:/^[a-f0-9]{64}$/',
            'app_version' => ['nullable', 'string', 'regex:' . ManifestVerifier::VERSION_PATTERN],
        ]);

        return DB::transaction(function () use ($data) {
            $code = UpdateEnrollmentCode::query()->where('code_hash', hash('sha256', strtoupper(trim($data['code']))))->lockForUpdate()->first();
            if (!$code || $code->used_at || now()->gte($code->expires_at)) {
                UpdateLifecycle::event(null, null, 'security', null, true, 'A device tried an enrollment code that is not valid.');
                throw ValidationException::withMessages(['code' => ['That update code is not valid or has expired.']]);
            }
            if (UpdateClient::query()->where('device_id', $data['device_id'])->exists()) {
                throw ValidationException::withMessages(['device_id' => ['This computer is already registered. Ask for it to be reset.']]);
            }

            $token = Str::random(64);
            $client = UpdateClient::create([
                'device_id' => $data['device_id'],
                'name' => $data['name'],
                'customer_label' => $code->customer_label,
                'token_hash' => UpdateClient::hashToken($token),
                'machine_fingerprint' => $data['machine_fingerprint'] ?? null,
                'status' => 'authorized',
                'channel' => $code->channel,
                'reported_app_version' => $data['app_version'] ?? null,
            ]);
            $code->forceFill(['used_at' => now(), 'client_id' => $client->id])->save();
            AuditService::log('update_device_enrolled', 'UpdateClient', $client->id, null, null, ['name' => $client->name]);

            return response()->json(['success' => true, 'data' => ['client_id' => $client->id, 'token' => $token, 'channel' => $client->channel]], 201);
        });
    }

    public function check(Request $request)
    {
        $data = $request->validate([
            'app_version' => ['required', 'string', 'regex:' . ManifestVerifier::VERSION_PATTERN],
            'schema_fingerprint' => 'nullable|string|regex:/^[a-f0-9]{64}$/',
            'mode' => 'nullable|in:embedded,remote',
            'machine_fingerprint' => 'nullable|string|regex:/^[a-f0-9]{64}$/',
            'health' => 'nullable|array',
        ]);
        $client = $this->client($request);

        if ($client->machine_fingerprint && !empty($data['machine_fingerprint']) && !hash_equals($client->machine_fingerprint, $data['machine_fingerprint'])) {
            UpdateLifecycle::event($client, null, 'security', null, true, 'The registered device identity was presented by a different machine.');

            return response()->json(['success' => false, 'code' => 'device_mismatch', 'message' => 'This computer does not match its registration.'], 403);
        }

        $client->forceFill([
            'reported_app_version' => $data['app_version'],
            'reported_schema_fingerprint' => $data['schema_fingerprint'] ?? $client->reported_schema_fingerprint,
            'mode' => $data['mode'] ?? $client->mode,
            'last_health' => $data['health'] ?? $client->last_health,
            'last_check_at' => now(),
        ])->save();

        $statementFile = config('foodcourt.updates.trust_statement');
        $statement = $statementFile && is_file($statementFile) ? json_decode((string) file_get_contents($statementFile), true) : null;

        $target = UpdateOffers::current($client);
        if (!$target) {
            return response()->json(['success' => true, 'data' => ['update' => null, 'trust_statement' => $statement, 'install_unknown' => UpdateOffers::installIsUnknown($client)]]);
        }

        $release = $target->release;
        if (UpdateOffers::belowMinimum($client, $release)) {
            UpdateLifecycle::event($client, $target, 'lifecycle', null, true, 'The installed version is below the minimum this release supports.');

            return response()->json(['success' => true, 'data' => ['update' => null, 'blocked' => 'below_minimum_version', 'min_supported_version' => $release->min_supported_version]]);
        }
        $package = UpdateOffers::choosePackage($client, $release);
        if (!$package) {
            return response()->json(['success' => true, 'data' => ['update' => null, 'blocked' => 'no_package']]);
        }

        return response()->json(['success' => true, 'data' => [
            'install_unknown' => UpdateOffers::installIsUnknown($client),
            'trust_statement' => $statement,
            'update' => [
                'target_id' => $target->id,
                'status' => $target->status,
                'decision' => $target->decision,
                'version' => $release->version,
                'channel' => $release->channel,
                'required' => $release->required,
                'release_date' => $release->release_date?->toIso8601String(),
                'package_type' => $package->package_type,
                'package_size' => $package->package_size,
                'notes' => $release->notes,
            ],
        ]]);
    }

    public function release(Request $request, $targetId)
    {
        $target = $this->target($request, $targetId);
        abort_unless($target->release->isPublished(), 404);

        return response()->json(['success' => true, 'data' => [
            'version' => $target->release->version,
            'channel' => $target->release->channel,
            'notes' => $target->release->notes,
            'release_date' => $target->release->release_date?->toIso8601String(),
            'min_supported_version' => $target->release->min_supported_version,
            'required' => $target->release->required,
            'app_compatibility' => $target->release->app_compatibility,
            'database_compatibility' => $target->release->database_compatibility,
        ]]);
    }

    public function decide(Request $request, $targetId)
    {
        $data = $request->validate(['decision' => ['required', Rule::in(['approve', 'reject'])], 'source' => 'nullable|string|in:owner approval,silent policy']);
        $target = $this->target($request, $targetId);
        abort_unless($target->release->isPublished(), 404);

        if ($data['decision'] === 'reject') {
            $target->forceFill(['decision' => 'rejected'])->save();
            UpdateLifecycle::event($this->client($request), $target, 'lifecycle', $target->status, false, 'The client declined this update.');

            return response()->json(['success' => true, 'data' => ['status' => $target->status, 'decision' => 'rejected']]);
        }

        $result = UpdateLifecycle::report($target, UpdateLifecycle::APPROVED, ['message' => 'Approved on the device: ' . ($data['source'] ?? 'owner approval') . '.']);
        if (!$result['ok']) {
            return response()->json(['success' => false, 'code' => $result['code'], 'message' => $result['message']], 409);
        }
        $target->forceFill(['decision' => 'approved', 'approved_at' => $target->approved_at ?? now()])->save();

        return response()->json(['success' => true, 'data' => ['status' => $result['status'], 'decision' => 'approved']]);
    }

    /**
     * Short-lived, single-device, single-package authorization. `full=true` is what a device asks for when its install fails
     * verification. Downloading needs no approval, because it changes nothing: only an explicit rejection stops it.
     */
    public function downloadToken(Request $request, $targetId)
    {
        $data = $request->validate(['full' => 'nullable|boolean']);
        $target = $this->target($request, $targetId);
        $client = $this->client($request);
        abort_unless($target->release->isPublished(), 404);

        if ($target->decision === 'rejected') {
            return response()->json(['success' => false, 'code' => 'rejected', 'message' => 'This update was declined on this computer.'], 409);
        }
        if (!in_array($target->status, [UpdateLifecycle::AVAILABLE, UpdateLifecycle::APPROVED, UpdateLifecycle::DOWNLOADING, UpdateLifecycle::VERIFYING, UpdateLifecycle::FAILED, UpdateLifecycle::RECOVERED], true)) {
            return response()->json(['success' => false, 'code' => 'not_downloadable', 'message' => 'This update is already being installed on this computer.'], 409);
        }
        $package = UpdateOffers::choosePackage($client, $target->release, (bool) ($data['full'] ?? false));
        if (!$package) {
            return response()->json(['success' => false, 'code' => 'no_package', 'message' => 'No package is available for this computer.'], 409);
        }

        $plain = Str::random(64);
        $expires = now()->addSeconds((int) config('foodcourt.updates.download_ttl_seconds'));
        UpdateDownloadToken::create(['token_hash' => hash('sha256', $plain), 'target_id' => $target->id, 'package_id' => $package->id, 'client_id' => $client->id, 'expires_at' => $expires]);
        $target->forceFill(['package_id' => $package->id, 'proof_nonce' => $target->proof_nonce ?: bin2hex(random_bytes(16))])->save();

        return response()->json(['success' => true, 'data' => [
            'token' => $plain,
            'expires_at' => $expires->toIso8601String(),
            'package_type' => $package->package_type,
            'source_version' => $package->source_version,
            'package_size' => $package->package_size,
            'package_sha256' => $package->package_sha256,
            'manifest' => $package->manifest_raw,
            'signature' => $package->signature,
            'signing_key_id' => $package->signing_key_id,
            'proof_nonce' => $target->proof_nonce,
        ]]);
    }

    public function download(Request $request, string $token)
    {
        $row = UpdateDownloadToken::query()->where('token_hash', hash('sha256', $token))->with('package')->first();
        $client = $this->client($request);
        if (!$row || $row->client_id !== $client->id || now()->gte($row->expires_at)) {
            return response()->json(['success' => false, 'code' => 'download_token_invalid', 'message' => 'This download link has expired.'], 403);
        }
        $path = rtrim((string) config('foodcourt.updates.storage_path'), '/\\') . DIRECTORY_SEPARATOR . $row->package->storage_name;
        abort_unless($row->package->storage_name && is_file($path), 404);
        if (!$row->first_used_at) {
            $row->forceFill(['first_used_at' => now()])->save();
        }

        // BinaryFileResponse honours Range requests, which is what makes a download resumable
        return response()->file($path, ['Content-Type' => 'application/octet-stream', 'X-Package-Sha256' => $row->package->package_sha256]);
    }

    public function status(Request $request, $targetId)
    {
        $data = $request->validate([
            'status' => ['required', Rule::in(UpdateLifecycle::STATUSES)],
            'category' => 'nullable|in:lifecycle,download,migration,install,recovery,health',
            'message' => 'nullable|string|max:1000',
            'details' => 'nullable|array',
            'client_time' => 'nullable|string|max:40',
            'app_version' => 'nullable|string|max:20',
            'manifest_sha256' => 'nullable|string|max:64',
            'schema_fingerprint' => 'nullable|string|max:64',
            'health' => 'nullable|array',
            'proof' => 'nullable|string|max:64',
        ]);
        $target = $this->target($request, $targetId);
        $result = UpdateLifecycle::report($target, $data['status'], $data);
        if (!$result['ok']) {
            return response()->json(['success' => false, 'code' => $result['code'], 'message' => $result['message'], 'data' => ['status' => $result['status']]], 409);
        }

        return response()->json(['success' => true, 'data' => ['status' => $result['status']]]);
    }

    public function history(Request $request)
    {
        $client = $this->client($request);
        $targets = UpdateDeploymentTarget::query()->where('client_id', $client->id)->with('release:id,version,channel')->orderByDesc('id')->limit(50)->get(['id', 'release_id', 'status', 'decision', 'last_error', 'approved_at', 'completed_at', 'updated_at']);
        $events = UpdateEvent::query()->where('client_id', $client->id)->orderByDesc('id')->limit(100)->get(['id', 'target_id', 'category', 'status', 'is_error', 'message', 'created_at']);

        return response()->json(['success' => true, 'data' => ['targets' => $targets, 'events' => $events]]);
    }
}
