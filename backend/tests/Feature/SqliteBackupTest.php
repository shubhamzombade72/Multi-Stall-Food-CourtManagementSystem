<?php

namespace Tests\Feature;

use App\Models\User;
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

    /** A second database standing in for the data as it was before the restore. Returns its path. */
    private function previousData(array $tokens): string
    {
        $file = $this->dir . DIRECTORY_SEPARATOR . 'previous-' . bin2hex(random_bytes(3)) . '.sqlite';
        touch($file);
        Config::set('database.connections.fc_prev', ['driver' => 'sqlite', 'database' => $file, 'prefix' => '', 'foreign_key_constraints' => true]);
        DB::purge('fc_prev');
        Artisan::call('migrate', ['--database' => 'fc_prev', '--force' => true]);
        DB::connection('fc_prev')->table('personal_access_tokens')->insert($tokens);
        DB::purge('fc_prev');

        return $file;
    }

    private function token(int $id, string $hash, int $userId = 1): array
    {
        return ['id' => $id, 'tokenable_type' => (new User())->getMorphClass(), 'tokenable_id' => $userId, 'name' => 'auth-token', 'token' => hash('sha256', $hash), 'abilities' => '["owner"]', 'created_at' => now(), 'updated_at' => now()];
    }

    private function restoredTokens(): \Illuminate\Support\Collection
    {
        return DB::connection('fc_live')->table('personal_access_tokens')->orderBy('id')->get();
    }

    public function test_keeping_the_session_copies_it_in_with_its_id_and_drops_the_older_tokens(): void
    {
        DB::connection('fc_live')->table('personal_access_tokens')->insert([$this->token(3, 'old-revoked'), $this->token(4, 'someone-else', 2)]);
        $from = $this->previousData([$this->token(9, 'current')]);

        $report = SqliteBackup::keepSession($from, 1, 'O@example.com', 'owner', 'fc_live');

        $this->assertTrue($report['kept'], json_encode($report));
        $this->assertSame([4, 9], $this->restoredTokens()->pluck('id')->all(), 'the old token is gone, another account keeps its session');
        $this->assertSame(hash('sha256', 'current'), $this->restoredTokens()->firstWhere('id', 9)->token);
    }

    public function test_a_session_id_already_used_in_the_backup_is_replaced(): void
    {
        DB::connection('fc_live')->table('personal_access_tokens')->insert($this->token(9, 'someone-else', 2));
        $from = $this->previousData([$this->token(9, 'current')]);

        $this->assertTrue(SqliteBackup::keepSession($from, 1, 'o@example.com', 'owner', 'fc_live')['kept']);
        $this->assertSame(hash('sha256', 'current'), $this->restoredTokens()->firstWhere('id', 9)->token);
        $this->assertSame(1, $this->restoredTokens()->count());
    }

    public function test_the_next_token_id_stays_above_a_copied_one(): void
    {
        $from = $this->previousData([$this->token(50, 'current')]);
        SqliteBackup::keepSession($from, 1, 'o@example.com', 'owner', 'fc_live');

        $row = $this->token(0, 'next', 2);
        unset($row['id']);
        $next = DB::connection('fc_live')->table('personal_access_tokens')->insertGetId($row);

        $this->assertGreaterThan(50, $next);
    }

    public function test_the_pin_is_not_kept_for_a_different_or_blocked_account(): void
    {
        $from = $this->previousData([$this->token(9, 'current')]);

        $this->assertSame('account_not_in_backup', SqliteBackup::keepSession($from, 77, 'o@example.com', 'owner', 'fc_live')['reason']);
        $this->assertSame('account_not_in_backup', SqliteBackup::keepSession($from, 1, 'other@example.com', 'owner', 'fc_live')['reason']);
        $this->assertSame('role_changed', SqliteBackup::keepSession($from, 1, 'o@example.com', 'cashier', 'fc_live')['reason']);

        DB::connection('fc_live')->table('users')->where('id', 1)->update(['is_active' => false]);
        $this->assertSame('account_inactive', SqliteBackup::keepSession($from, 1, 'o@example.com', 'owner', 'fc_live')['reason']);
        $this->assertCount(0, $this->restoredTokens(), 'nothing is copied when the PIN is not kept');
    }

    public function test_without_previous_data_the_session_is_kept_only_if_the_backup_has_one(): void
    {
        $missing = $this->dir . DIRECTORY_SEPARATOR . 'never-made.sqlite';
        $this->assertSame('no_session', SqliteBackup::keepSession($missing, 1, 'o@example.com', 'owner', 'fc_live')['reason']);

        DB::connection('fc_live')->table('personal_access_tokens')->insert($this->token(3, 'from-backup'));
        $this->assertTrue(SqliteBackup::keepSession($missing, 1, 'o@example.com', 'owner', 'fc_live')['kept']);
        $this->assertSame([3], $this->restoredTokens()->pluck('id')->all());
    }

    public function test_the_keep_session_command_prints_one_line_without_the_token(): void
    {
        $from = $this->previousData([$this->token(9, 'current')]);

        $code = Artisan::call('foodcourt:keep-session', ['from' => $from, '--user-id' => 1, '--email' => 'o@example.com', '--role' => 'owner', '--connection' => 'fc_live']);
        $output = trim(Artisan::output());

        $this->assertSame(0, $code);
        $this->assertSame(['ok' => true, 'kept' => true, 'reason' => null], json_decode($output, true));
    }

    public function test_a_shared_server_database_is_refused(): void
    {
        $code = Artisan::call('foodcourt:backup', ['file' => $this->dir . DIRECTORY_SEPARATOR . 'x.sqlite', '--connection' => 'pgsql']);

        $this->assertSame(1, $code);
        $this->assertFileDoesNotExist($this->dir . DIRECTORY_SEPARATOR . 'x.sqlite');
    }
}
