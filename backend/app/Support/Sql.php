<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

class Sql
{
    /**
     * Case-insensitive LIKE operator for the active database: PostgreSQL needs ILIKE, while SQLite's LIKE is
     * already case-insensitive for ASCII (the desktop app's built-in database) and has no ILIKE.
     */
    public static function like(): string
    {
        return DB::connection()->getDriverName() === 'pgsql' ? 'ilike' : 'like';
    }
}
