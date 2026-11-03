<?php

namespace Tests\Feature;

use App\Services\SqliteBackup;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Backup creation and verification against a throw-away SQLite database built with the real migrations.
 * Independent of the default (PostgreSQL) test connection.
 */
class SqliteBackupTest extends TestCase
{
    private string $dir;
    private string $live;

    protected function setUp(): void
    {
        parent::setUp();
        $this->dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'fc-backup-' . bin2hex(random_bytes(4));
        mkdir($this->dir);
        $this->live = $this->dir . DIRECTORY_SEPARATOR . 'live.sqlite';
        touch($this->live);
        Config::set('database.connections.fc_live', ['driver' => 'sqlite', 'database' => $this->live, 'prefix' => '', 'foreign_key_constraints' => true]);
        DB::purge('fc_live');
        Artisan::call('migrate', ['--database' => 'fc_live', '--force' => true]);
        DB::connection('fc_live')->table('users')->insert([
            'name' => 'Owner', 'email' => 'o@example.com', 'password' => 'x', 'role' => 'owner', 'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    protected function tearDown(): void
    {
        DB::purge('fc_live');
        foreach (glob($this->dir . DIRECTORY_SEPARATOR . '*') ?: [] as $f) {
            @unlink($f);
        }
        @rmdir($this->dir);
        parent::tearDown();
    }

    public function test_a_backup_is_created_and_proven_restorable(): void
    {
        $target = $this->dir . DIRECTORY_SEPARATOR . 'copy.sqlite';
        $report = SqliteBackup::create($target, 'fc_live');

        $this->assertTrue($report['ok'], json_encode($report));
        $this->assertSame('ok', $report['integrity']);
        $this->assertTrue($report['migrations_current']);
        $this->assertSame(1, $report['users']);
        $this->assertFileExists($target);

        // Independent proof: the copy opened on its own still holds the account
        Config::set('database.connections.fc_copy', ['driver' => 'sqlite', 'database' => $target, 'prefix' => '', 'foreign_key_constraints' => true]);
        $this->assertSame('o@example.com', DB::connection('fc_copy')->table('users')->value('email'));
        DB::purge('fc_copy');
    }

    public function test_a_damaged_backup_is_rejected(): void
    {
        $bad = $this->dir . DIRECTORY_SEPARATOR . 'bad.sqlite';
        file_put_contents($bad, str_repeat('not a database', 200));

        $report = SqliteBackup::verify($bad);
        $this->assertFalse($report['ok']);
        $this->assertNotEmpty($report['problems']);
    }

    public function test_empty_and_missing_files_are_rejected(): void
    {
        $empty = $this->dir . DIRECTORY_SEPARATOR . 'empty.sqlite';
        touch($empty);
        $this->assertFalse(SqliteBackup::verify($empty)['ok']);
        $this->assertFalse(SqliteBackup::verify($this->dir . DIRECTORY_SEPARATOR . 'missing.sqlite')['ok']);
    }

    public function test_an_existing_backup_file_is_never_overwritten(): void
    {
        $target = $this->dir . DIRECTORY_SEPARATOR . 'copy.sqlite';
        file_put_contents($target, 'keep me');

        $this->expectException(\RuntimeException::class);
        try {
            SqliteBackup::create($target, 'fc_live');
        } finally {
            $this->assertSame('keep me', file_get_contents($target));
        }
    }

    public function test_the_command_prints_one_json_line(): void
    {
        $target = $this->dir . DIRECTORY_SEPARATOR . 'cmd.sqlite';
        $code = Artisan::call('foodcourt:backup', ['file' => $target, '--connection' => 'fc_live']);
        $json = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $code);
        $this->assertTrue($json['ok']);
        $this->assertSame(0, Artisan::call('foodcourt:backup', ['file' => $target, '--verify' => true]));
    }

    public function test_a_shared_server_database_is_refused(): void
    {
        $code = Artisan::call('foodcourt:backup', ['file' => $this->dir . DIRECTORY_SEPARATOR . 'x.sqlite', '--connection' => 'pgsql']);

        $this->assertSame(1, $code);
        $this->assertFileDoesNotExist($this->dir . DIRECTORY_SEPARATOR . 'x.sqlite');
    }
}
