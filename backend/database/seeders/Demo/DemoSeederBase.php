<?php

namespace Database\Seeders\Demo;

use Database\Seeders\Demo\Data\DemoCatalog;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Ramsey\Uuid\Uuid;

/** Shared helpers: every demo seeder runs the guard, works in one transaction and creates only what is missing. */
abstract class DemoSeederBase extends Seeder
{
    public const DEMO_STAFF_PASSWORD = 'DemoStaff#2026';
    public const DEMO_OWNER_PASSWORD = 'DemoOwner#2026';

    /** Implemented by each seeder; returns how many records it created this run. */
    abstract protected function seed(): int;

    public function run(): void
    {
        DemoGuard::assertSafe();
        $started = microtime(true);
        $created = DB::transaction(fn () => $this->seed());
        $this->command?->getOutput()->writeln(sprintf('  %-26s +%d new  (%.1fs)', class_basename($this), $created, microtime(true) - $started));
    }

    protected static function uuid(string $key): string
    {
        return Uuid::uuid5(Uuid::NAMESPACE_URL, 'urn:foodcourt-demo:' . $key)->toString();
    }

    protected static function stallCode(int $no): string
    {
        return sprintf('%s%03d', DemoCatalog::STALL_PREFIX, $no);
    }

    /** @return array<string, int> stall code => id */
    protected static function stallIds(): array
    {
        return DB::table('stalls')->where('code', 'like', DemoCatalog::STALL_PREFIX . '%')->orderBy('code')->pluck('id', 'code')->all();
    }

    /** Deterministic pseudo-random int in [$min, $max] from a string key (independent of global RNG state). */
    protected static function pick(string $key, int $min, int $max): int
    {
        return $min + (int) (hexdec(substr(md5($key), 0, 8)) % ($max - $min + 1));
    }

    protected static function fictionalPhone(int $n): string
    {
        // "+91 5..." is not an allocated Indian mobile range (mobiles start with 6-9), so these can never reach a real person
        return '+915' . sprintf('%09d', 100000 + $n);
    }
}
