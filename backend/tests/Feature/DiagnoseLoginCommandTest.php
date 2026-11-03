<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Setting;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/** Support tool: why can this person not sign in? Reads state, never prints secrets. */
class DiagnoseLoginCommandTest extends TestCase
{
    use DatabaseTransactions;

    private function run_(string $email, array $extra = []): array
    {
        Artisan::call('foodcourt:diagnose-login', ['email' => $email] + $extra);

        return json_decode(trim(Artisan::output()), true);
    }

    public function test_reports_a_matching_account_even_when_only_the_capitalisation_differs(): void
    {
        \DB::table('users')->insert([
            'name' => 'Legacy', 'email' => 'Shop.Owner@Gmail.com', 'password' => Hash::make('Str0ngPass99'),
            'role' => 'owner', 'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
        ]);

        $r = $this->run_('shop.owner@gmail.com');
        $this->assertTrue($r['account_found']);
        $this->assertSame('owner', $r['role']);
        $this->assertTrue($r['is_active']);
        $this->assertTrue($r['email_differs_only_by_case_from_stored']);
        $this->assertArrayNotHasKey('password', $r);
        $this->assertStringNotContainsString('Str0ngPass99', json_encode($r));
        $this->assertStringNotContainsString('$2y$', json_encode($r), 'no hash in the output');
    }

    public function test_reports_that_no_account_exists_and_what_the_failed_attempts_said(): void
    {
        AuditLog::create([
            'user_id' => null, 'action' => 'login_failed', 'entity_type' => 'User', 'entity_id' => '-', 'ip_address' => '127.0.0.1',
            'new_values' => ['email' => 'nobody@nowhere.example', 'reason' => 'unknown_email'], 'created_at' => now(),
        ]);

        $r = $this->run_('nobody@nowhere.example');
        $this->assertFalse($r['account_found']);
        $this->assertSame(['unknown_email' => 1], $r['failed_attempts_by_reason']);
        $this->assertGreaterThan(0, $r['accounts_in_system']);
    }

    public function test_says_when_the_system_has_no_accounts_at_all(): void
    {
        Schema::withoutForeignKeyConstraints(function () {
            User::query()->delete();
            Setting::query()->where('key', 'system_setup')->delete();
        });

        $r = $this->run_('owner@foodcourt.com');
        $this->assertSame(0, $r['accounts_in_system']);
        $this->assertFalse($r['account_found']);
        $this->assertFalse($r['setup_completed']);
    }

    public function test_can_verify_a_password_and_token_creation_without_changing_anything(): void
    {
        $user = User::where('email', 'owner@foodcourt.com')->firstOrFail();
        $tokensBefore = $user->tokens()->count();
        putenv('FOODCOURT_DIAG_PASSWORD=password123');

        $good = $this->run_('owner@foodcourt.com', ['--check-password' => true]);
        $this->assertTrue($good['password_matches']);
        $this->assertTrue($good['token_can_be_created']);

        putenv('FOODCOURT_DIAG_PASSWORD=not-the-password');
        $bad = $this->run_('owner@foodcourt.com', ['--check-password' => true]);
        putenv('FOODCOURT_DIAG_PASSWORD');

        $this->assertFalse($bad['password_matches']);
        $this->assertSame($tokensBefore, $user->tokens()->count(), 'the token test is rolled back');
    }
}
