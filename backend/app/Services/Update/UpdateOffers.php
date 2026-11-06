<?php

namespace App\Services\Update;

use App\Models\UpdateClient;
use App\Models\UpdateDeployment;
use App\Models\UpdateDeploymentTarget;
use App\Models\UpdatePackage;
use App\Models\UpdateRelease;

/**
 * Decides what a device is offered. The device's claimed version is only one input: it is compared with the version
 * the server last verified, and a disagreement means the install is treated as unknown (full recovery package only).
 */
class UpdateOffers
{
    /** Targets for "all clients" deployments are created when the device first asks, so later enrollments are covered. */
    public static function materialize(UpdateClient $client): void
    {
        $deployments = UpdateDeployment::query()->where('status', 'active')->where('scope', 'all')->with('release')->get();
        foreach ($deployments as $deployment) {
            if (in_array($client->id, $deployment->excluded_client_ids ?? [], true)) {
                continue;
            }
            if ($deployment->release->channel !== $client->channel) {
                continue;
            }
            UpdateDeploymentTarget::firstOrCreate(
                ['deployment_id' => $deployment->id, 'client_id' => $client->id],
                ['release_id' => $deployment->release_id, 'status' => UpdateLifecycle::AVAILABLE]
            );
        }
    }

    /** The newest assigned, published release above the device's version. */
    public static function current(UpdateClient $client): ?UpdateDeploymentTarget
    {
        self::materialize($client);
        $base = self::baseVersion($client);

        return UpdateDeploymentTarget::query()
            ->where('client_id', $client->id)
            ->whereHas('deployment', fn ($q) => $q->where('status', 'active'))
            ->whereHas('release', fn ($q) => $q->where('status', UpdateRelease::PUBLISHED))
            ->where('status', '!=', UpdateLifecycle::COMPLETED)
            ->with(['release', 'deployment'])
            ->get()
            ->filter(fn ($t) => $base === null || version_compare($t->release->version, $base, '>'))
            ->sortByDesc(fn ($t) => array_map('intval', explode('.', $t->release->version)))
            ->first();
    }

    public static function baseVersion(UpdateClient $client): ?string
    {
        return $client->verified_app_version ?: $client->reported_app_version;
    }

    /** True when what the device claims differs from what the server verified last. */
    public static function installIsUnknown(UpdateClient $client): bool
    {
        return $client->verified_app_version !== null && $client->reported_app_version !== $client->verified_app_version;
    }

    /** Below the release's minimum supported version nothing is offered: a developer has to look at that install. */
    public static function belowMinimum(UpdateClient $client, UpdateRelease $release): bool
    {
        $base = self::baseVersion($client);

        return $release->min_supported_version && ($base === null || version_compare($base, $release->min_supported_version, '<'));
    }

    /** Incremental only from the exact verified source version; everything else gets the full recovery package. */
    public static function choosePackage(UpdateClient $client, UpdateRelease $release, bool $forceFull = false): ?UpdatePackage
    {
        $query = UpdatePackage::query()->where('release_id', $release->id)->whereNotNull('uploaded_at');
        if (!$forceFull && !self::installIsUnknown($client)) {
            $incremental = (clone $query)->where('package_type', 'incremental')->where('source_version', self::baseVersion($client))->first();
            if ($incremental) {
                return $incremental;
            }
        }

        return $query->where('package_type', 'full')->first();
    }
}
