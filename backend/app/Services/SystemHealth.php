<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

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
}
