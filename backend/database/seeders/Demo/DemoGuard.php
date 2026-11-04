<?php

namespace Database\Seeders\Demo;

use Illuminate\Support\Facades\DB;

/**
 * Safety gate for every demo seeder. The Indian demo dataset may only be written to a database that is explicitly a demo
 * or test database: APP_ENV must not be production and the database name must contain "demo" or "test".
 * The default development database (foodcourt_db) therefore refuses, and so does any production database.
 */
final class DemoGuard
{
    /** @return array{connection:string,driver:string,database:string} */
    public static function assertSafe(): array
    {
        if (app()->environment('production')) {
            throw new \RuntimeException('Refusing to run: APP_ENV is production. The demo dataset is for demo/testing databases only.');
        }

        $connection = (string) config('database.default');
        $config = (array) config("database.connections.{$connection}");
        $driver = (string) ($config['driver'] ?? '');
        $database = (string) ($config['database'] ?? '');
        $name = $driver === 'sqlite' ? basename($database) : $database;

        if ($name === '' || !preg_match('/(demo|test)/i', $name)) {
            throw new \RuntimeException(
                "Refusing to run: database '{$name}' ({$driver}) is not a demo/test database. "
                . "Point DB_DATABASE at an isolated database whose name contains 'demo' or 'test' (for example foodcourt_demo_db)."
            );
        }

        DB::select('select 1'); // fail early if the connection does not work

        return ['connection' => $connection, 'driver' => $driver, 'database' => $name];
    }
}
