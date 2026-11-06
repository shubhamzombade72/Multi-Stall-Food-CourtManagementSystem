<?php

namespace App\Services;

use App\Services\Update\LocalMigrationEngine;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * What /api/system/ready reports. Booleans only: no driver names, paths, SQL or credentials ever leave here.
 */
class SystemHealth
{
    public static function databaseReachable(): bool
    {
        try {
            DB::select('select 1');

            return true;
        } catch (\Throwable) {
            return false;
        }
    }

    public static function migrationsCurrent(): bool
    {
        try {
            $migrator = app('migrator');
            $repository = $migrator->getRepository();
            if (!$repository->repositoryExists()) {
                return false;
            }
            $files = array_keys($migrator->getMigrationFiles(array_merge($migrator->paths(), [database_path('migrations')])));

            return array_diff($files, $repository->getRan()) === [];
        } catch (\Throwable) {
            return false;
        }
    }

    /**
     * False when this database was moved forward by a release that this program version must not run against
     * (recorded by the update engine). Databases the update engine never touched have no record and are compatible.
     */
    public static function schemaCompatible(): bool
    {
        try {
            $appVersion = config('foodcourt.app_version');
            if (!$appVersion || !Schema::hasTable(LocalMigrationEngine::STATE_TABLE)) {
                return true;
            }
            $minimum = DB::table(LocalMigrationEngine::STATE_TABLE)->where('key', 'min_app_version')->value('value');

            return !$minimum || version_compare($appVersion, $minimum, '>=');
        } catch (\Throwable) {
            return false;
        }
    }
}
