<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\UpdateClient;
use App\Models\UpdateDeployment;
use App\Models\UpdateDeploymentTarget;
use App\Models\UpdateEnrollmentCode;
use App\Models\UpdateEvent;
use App\Models\UpdatePackage;
use App\Models\UpdateRelease;
use App\Services\AuditService;
use App\Services\Update\ManifestVerifier;
use App\Services\Update\UpdateLifecycle;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/** Release, client and deployment management on the update service. Owner only; the routes do not exist on a client. */
class UpdateAdminController extends Controller
{
    private const CHANNELS = ['stable', 'beta', 'testing'];

    private function ownerOnly(Request $request): void
    {
        abort_unless($request->user()->isOwner(), 403, 'Unauthorized. Owner access required.');
    }

    private function notesRules(): array
    {
        return [
            'notes' => 'nullable|array',
            'notes.features' => 'nullable|array',
            'notes.bug_fixes' => 'nullable|array',
            'notes.performance' => 'nullable|array',
            'notes.database_changes' => 'nullable|array',
            'notes.security' => 'nullable|array',
        ];
    }

    // ------------------------------------------------------------------ releases
    public function releases(Request $request)
    {
        $this->ownerOnly($request);
        $query = UpdateRelease::query()->with('packages:id,release_id,package_type,source_version,package_size,uploaded_at')->orderByDesc('id');
        if ($request->filled('channel')) {
            $query->where('channel', $request->query('channel'));
        }

        return response()->json(['success' => true, 'data' => $query->limit(200)->get()]);
    }

    public function createRelease(Request $request)
    {
        $this->ownerOnly($request);
        $data = $request->validate([
            'version' => ['required', 'string', 'regex:' . ManifestVerifier::VERSION_PATTERN, Rule::unique('update_releases', 'version')],
            'channel' => ['required', Rule::in(self::CHANNELS)],
            'min_supported_version' => ['nullable', 'string', 'regex:' . ManifestVerifier::VERSION_PATTERN],
            'required' => 'nullable|boolean',
            'release_date' => 'nullable|date',
            'app_compatibility' => 'nullable|array',
            'database_compatibility' => 'nullable|array',
            ...$this->notesRules(),
        ]);
        $release = UpdateRelease::create([...$data, 'status' => UpdateRelease::CREATED, 'created_by_user_id' => $request->user()->id]);
        AuditService::log('update_release_created', 'UpdateRelease', $release->id, null, null, ['version' => $release->version]);

        return response()->json(['success' => true, 'data' => $release->fresh()], 201);
    }

    public function updateRelease(Request $request, $id)
    {
        $this->ownerOnly($request);
        $release = UpdateRelease::findOrFail($id);
        if ($release->isPublished()) {
            return response()->json(['success' => false, 'code' => 'release_published', 'message' => 'Unpublish this release before changing it.'], 409);
        }
        $data = $request->validate([
            'channel' => ['sometimes', Rule::in(self::CHANNELS)],
            'min_supported_version' => ['sometimes', 'nullable', 'string', 'regex:' . ManifestVerifier::VERSION_PATTERN],
            'required' => 'sometimes|boolean',
            'release_date' => 'sometimes|nullable|date',
            'app_compatibility' => 'sometimes|nullable|array',
            'database_compatibility' => 'sometimes|nullable|array',
            ...$this->notesRules(),
        ]);
        $release->update($data);
        AuditService::log('update_release_edited', 'UpdateRelease', $release->id);

        return response()->json(['success' => true, 'data' => $release->fresh()]);
    }

    public function addPackage(Request $request, $id)
    {
        $this->ownerOnly($request);
        $release = UpdateRelease::findOrFail($id);
        $data = $request->validate([
            'manifest' => 'required|string|max:50000000',
            'signature' => 'required|string|max:200',
            'signing_key_id' => 'required|string|max:40',
        ]);
        if ($release->isPublished()) {
            return response()->json(['success' => false, 'code' => 'release_published', 'message' => 'Unpublish this release before changing it.'], 409);
        }
        [$manifest, $problem] = ManifestVerifier::verify($data['manifest'], $data['signature'], $data['signing_key_id']);
        if (!$manifest) {
            UpdateLifecycle::event(null, null, 'security', null, true, "Package refused for {$release->version}: {$problem}");

            return response()->json(['success' => false, 'code' => 'manifest_rejected', 'message' => $problem], 422);
        }
        if ($manifest['version'] !== $release->version) {
            return response()->json(['success' => false, 'code' => 'manifest_rejected', 'message' => 'The manifest is for a different version.'], 422);
        }
        if (($manifest['channel'] ?? null) !== $release->channel) {
            return response()->json(['success' => false, 'code' => 'manifest_rejected', 'message' => 'The manifest is for a different channel.'], 422);
        }

        $source = $manifest['package_type'] === 'incremental' ? $manifest['source_version'] : null;
        $package = UpdatePackage::query()->where('release_id', $release->id)->where('package_type', $manifest['package_type'])->where('source_version', $source)->first() ?? new UpdatePackage(['release_id' => $release->id, 'package_type' => $manifest['package_type'], 'source_version' => $source]);
        $package->fill([
            'manifest_raw' => $data['manifest'],
            'manifest_sha256' => hash('sha256', $data['manifest']),
            'signature' => $data['signature'],
            'signing_key_id' => $data['signing_key_id'],
            'package_sha256' => $manifest['payload_sha256'],
            'package_size' => (int) $manifest['payload_size'],
            'uploaded_at' => null,
        ])->save();

        // What clients see is taken from the signed manifest, so it cannot differ from what they will verify
        $release->update([
            'notes' => $manifest['notes'] ?? $release->notes,
            'min_supported_version' => $manifest['min_supported_version'] ?? $release->min_supported_version,
            'app_compatibility' => $manifest['compatibility'] ?? $release->app_compatibility,
            'database_compatibility' => isset($manifest['database']) ? array_diff_key($manifest['database'], ['schema' => 1, 'migrations' => 1]) : $release->database_compatibility,
        ]);

        return response()->json(['success' => true, 'data' => ['package_id' => $package->id, 'package_type' => $package->package_type, 'source_version' => $package->source_version]], 201);
    }

    /** Raw request body, streamed to disk and hashed as it arrives. It is kept only if it matches the signed manifest. */
    public function uploadPayload(Request $request, $id, $packageId)
    {
        $this->ownerOnly($request);
        $release = UpdateRelease::findOrFail($id);
        $package = UpdatePackage::query()->where('release_id', $release->id)->findOrFail($packageId);
        if ($release->isPublished()) {
            return response()->json(['success' => false, 'code' => 'release_published', 'message' => 'Unpublish this release before changing it.'], 409);
        }

        $dir = rtrim((string) config('foodcourt.updates.storage_path'), '/\\');
        if (!is_dir($dir) && !mkdir($dir, 0700, true) && !is_dir($dir)) {
            return response()->json(['success' => false, 'message' => 'The package store is not writable.'], 500);
        }
        $name = 'pkg-' . $package->id . '-' . $package->package_sha256 . '.fcpkg';
        $tmp = $dir . DIRECTORY_SEPARATOR . $name . '.' . bin2hex(random_bytes(4)) . '.part';
        $in = fopen('php://input', 'rb');
        $out = fopen($tmp, 'wb');
        $hash = hash_init('sha256');
        $size = 0;
        while (!feof($in)) {
            $chunk = fread($in, 1048576);
            if ($chunk === false) {
                break;
            }
            hash_update($hash, $chunk);
            fwrite($out, $chunk);
            $size += strlen($chunk);
        }
        fclose($in);
        fclose($out);
        $sha = hash_final($hash);
        if ($size !== (int) $package->package_size || !hash_equals($package->package_sha256, $sha)) {
            @unlink($tmp);

            return response()->json(['success' => false, 'code' => 'payload_mismatch', 'message' => 'The uploaded package does not match its signed manifest.'], 422);
        }
        $final = $dir . DIRECTORY_SEPARATOR . $name;
        @unlink($final);
        rename($tmp, $final);
        $package->forceFill(['storage_name' => $name, 'uploaded_at' => now()])->save();

        return response()->json(['success' => true, 'data' => ['package_id' => $package->id, 'sha256' => $sha, 'size' => $size]]);
    }

    public function publish(Request $request, $id)
    {
        $this->ownerOnly($request);
        $release = UpdateRelease::with('packages')->findOrFail($id);
        $full = $release->packages->first(fn ($p) => $p->package_type === 'full' && $p->uploaded_at);
        if (!$full) {
            return response()->json(['success' => false, 'code' => 'no_full_package', 'message' => 'A release needs a verified full recovery package before it can be published.'], 409);
        }
        foreach ($release->packages as $package) {
            [$manifest, $problem] = ManifestVerifier::verify($package->manifest_raw, $package->signature, $package->signing_key_id);
            if (!$manifest || !$package->uploaded_at) {
                return response()->json(['success' => false, 'code' => 'package_invalid', 'message' => $problem ?: "The {$package->package_type} package was not uploaded."], 409);
            }
        }
        $newer = UpdateRelease::query()->where('channel', $release->channel)->where('status', UpdateRelease::PUBLISHED)->get()
            ->first(fn ($r) => version_compare($r->version, $release->version, '>'));
        if ($newer) {
            return response()->json(['success' => false, 'code' => 'downgrade', 'message' => "Version {$newer->version} is already published on this channel."], 409);
        }
        $release->update(['status' => UpdateRelease::PUBLISHED, 'published_at' => now(), 'unpublished_at' => null, 'release_date' => $release->release_date ?? now()]);
        AuditService::log('update_release_published', 'UpdateRelease', $release->id, null, null, ['version' => $release->version]);

        return response()->json(['success' => true, 'data' => $release->fresh()]);
    }

    public function unpublish(Request $request, $id)
    {
        $this->ownerOnly($request);
        $release = UpdateRelease::findOrFail($id);
        $release->update(['status' => UpdateRelease::CREATED, 'unpublished_at' => now()]);
        AuditService::log('update_release_unpublished', 'UpdateRelease', $release->id, null, null, ['version' => $release->version]);

        return response()->json(['success' => true, 'data' => $release->fresh()]);
    }

    // ------------------------------------------------------------------ clients
    public function clients(Request $request)
    {
        $this->ownerOnly($request);
        $clients = UpdateClient::query()->orderByDesc('id')->limit(500)->get();
        $pending = UpdateDeploymentTarget::query()->whereNotIn('status', [UpdateLifecycle::COMPLETED, UpdateLifecycle::RECOVERED, UpdateLifecycle::FAILED])->selectRaw('client_id, count(*) as n')->groupBy('client_id')->pluck('n', 'client_id');
        $failed = UpdateDeploymentTarget::query()->where('status', UpdateLifecycle::FAILED)->selectRaw('client_id, count(*) as n')->groupBy('client_id')->pluck('n', 'client_id');

        return response()->json(['success' => true, 'data' => $clients->map(fn ($c) => [...$c->toArray(), 'pending_updates' => (int) ($pending[$c->id] ?? 0), 'failed_updates' => (int) ($failed[$c->id] ?? 0)])]);
    }

    /** One-time code the owner of the service hands to a client PC. Only the hash is kept. */
    public function createEnrollmentCode(Request $request)
    {
        $this->ownerOnly($request);
        $data = $request->validate(['customer_label' => 'nullable|string|max:120', 'channel' => ['nullable', Rule::in(self::CHANNELS)], 'valid_minutes' => 'nullable|integer|min:5|max:10080']);
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        $plain = '';
        for ($i = 0; $i < 20; $i++) {
            $plain .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }
        $plain = implode('-', str_split($plain, 5));
        $row = UpdateEnrollmentCode::create([
            'code_hash' => hash('sha256', $plain),
            'customer_label' => $data['customer_label'] ?? null,
            'channel' => $data['channel'] ?? 'stable',
            'expires_at' => now()->addMinutes($data['valid_minutes'] ?? 1440),
            'created_by_user_id' => $request->user()->id,
        ]);
        AuditService::log('update_enrollment_code_created', 'UpdateEnrollmentCode', $row->id);

        return response()->json(['success' => true, 'data' => ['code' => $plain, 'expires_at' => $row->expires_at->toIso8601String()]], 201);
    }

    public function updateClient(Request $request, $id)
    {
        $this->ownerOnly($request);
        $client = UpdateClient::findOrFail($id);
        $data = $request->validate([
            'status' => ['sometimes', Rule::in(['authorized', 'suspended', 'revoked'])],
            'channel' => ['sometimes', Rule::in(self::CHANNELS)],
            'customer_label' => 'sometimes|nullable|string|max:120',
            'name' => 'sometimes|string|max:100',
        ]);
        if ($client->status === 'revoked' && ($data['status'] ?? 'revoked') !== 'revoked') {
            return response()->json(['success' => false, 'code' => 'client_revoked', 'message' => 'A revoked computer has to be registered again.'], 409);
        }
        $client->update($data);
        AuditService::log('update_client_changed', 'UpdateClient', $client->id, null, null, $data);

        return response()->json(['success' => true, 'data' => $client->fresh()]);
    }

    // ------------------------------------------------------------------ deployments
    public function deployments(Request $request)
    {
        $this->ownerOnly($request);

        return response()->json(['success' => true, 'data' => UpdateDeployment::query()->with('release:id,version,channel')->withCount('targets')->orderByDesc('id')->limit(200)->get()]);
    }

    public function createDeployment(Request $request)
    {
        $this->ownerOnly($request);
        $data = $request->validate([
            'release_id' => 'required|integer|exists:update_releases,id',
            'scope' => ['required', Rule::in(['all', 'selected'])],
            'client_ids' => 'required_if:scope,selected|array',
            'client_ids.*' => 'integer|exists:update_clients,id',
            'exclude_client_ids' => 'nullable|array',
            'exclude_client_ids.*' => 'integer|exists:update_clients,id',
            'note' => 'nullable|string|max:500',
        ]);
        $release = UpdateRelease::findOrFail($data['release_id']);
        if (!$release->isPublished()) {
            return response()->json(['success' => false, 'code' => 'release_not_published', 'message' => 'Publish the release before deploying it.'], 409);
        }
        $excluded = array_map('intval', $data['exclude_client_ids'] ?? []);

        $deployment = DB::transaction(function () use ($data, $release, $request, $excluded) {
            $deployment = UpdateDeployment::create(['release_id' => $release->id, 'scope' => $data['scope'], 'excluded_client_ids' => $excluded, 'note' => $data['note'] ?? null, 'created_by_user_id' => $request->user()->id]);
            $clients = UpdateClient::query()->where('status', 'authorized')->whereNotIn('id', $excluded);
            if ($data['scope'] === 'selected') {
                $clients->whereIn('id', $data['client_ids']);
                if (UpdateClient::query()->whereIn('id', $data['client_ids'])->where('status', '!=', 'authorized')->exists()) {
                    throw ValidationException::withMessages(['client_ids' => ['Updates can only be assigned to authorized computers.']]);
                }
            } else {
                $clients->where('channel', $release->channel);
            }
            foreach ($clients->get() as $client) {
                UpdateDeploymentTarget::create(['deployment_id' => $deployment->id, 'client_id' => $client->id, 'release_id' => $release->id, 'status' => UpdateLifecycle::AVAILABLE]);
            }

            return $deployment;
        });
        AuditService::log('update_deployment_created', 'UpdateDeployment', $deployment->id, null, null, ['release' => $release->version, 'scope' => $deployment->scope]);

        return response()->json(['success' => true, 'data' => $deployment->load('targets')], 201);
    }

    public function showDeployment(Request $request, $id)
    {
        $this->ownerOnly($request);
        $deployment = UpdateDeployment::with(['release:id,version,channel', 'targets.client:id,name,customer_label,device_id,reported_app_version,verified_app_version'])->findOrFail($id);
        $events = UpdateEvent::query()->whereIn('target_id', $deployment->targets->pluck('id'))->orderBy('id')->limit(1000)->get();

        return response()->json(['success' => true, 'data' => ['deployment' => $deployment, 'events' => $events]]);
    }

    public function cancelDeployment(Request $request, $id)
    {
        $this->ownerOnly($request);
        $deployment = UpdateDeployment::findOrFail($id);
        $deployment->update(['status' => 'cancelled']);
        AuditService::log('update_deployment_cancelled', 'UpdateDeployment', $deployment->id);

        return response()->json(['success' => true, 'data' => $deployment->fresh()]);
    }

    // ------------------------------------------------------------------ monitoring
    public function monitoring(Request $request)
    {
        $this->ownerOnly($request);
        $byStatus = UpdateDeploymentTarget::query()->selectRaw('status, count(*) as n')->groupBy('status')->pluck('n', 'status');
        $errors = UpdateEvent::query()->where('is_error', true)->selectRaw('category, count(*) as n')->groupBy('category')->pluck('n', 'category');
        $query = UpdateEvent::query()->orderByDesc('id')->limit(200);
        if ($request->filled('category')) {
            $query->where('category', $request->query('category'));
        }
        if ($request->boolean('errors_only')) {
            $query->where('is_error', true);
        }

        return response()->json(['success' => true, 'data' => [
            'targets_by_status' => $byStatus,
            'errors_by_category' => $errors,
            'clients_total' => UpdateClient::query()->count(),
            'clients_unhealthy' => UpdateClient::query()->whereNotNull('last_failure_at')->where(fn ($q) => $q->whereNull('last_success_at')->orWhereColumn('last_failure_at', '>', 'last_success_at'))->count(),
            'events' => $query->get(),
        ]]);
    }
}
