<?php

namespace Tests\Feature;

use App\Models\Setting;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Sign-in and first-run behaviour that the Windows desktop app depends on: email matching, the one-time
 * setup marker, owner recovery and the readiness report. Each test is rolled back, so emptying `users`
 * never touches the shared test database.
 */
class DesktopLifecycleTest extends TestCase
{
    use DatabaseTransactions;

    private const STRONG = 'Str0ngPass99';

    private function embedded(): void
    {
        config(['foodcourt.embedded' => true]);
    }

    private function emptySystem(): void
    {
        Schema::withoutForeignKeyConstraints(function () {
            User::query()->delete();
            Setting::query()->where('key', 'system_setup')->delete();
        });
    }

    private function runSetup(string $email = 'asha@example.com'): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api/setup/owner', ['name' => 'Asha Patil', 'email' => $email, 'password' => self::STRONG]);
    }

    // ---------------------------------------------------------------- email matching

    public function test_sign_in_ignores_email_capitalisation_and_spaces(): void
    {
        User::create(['name' => 'Mixed', 'email' => 'Shop.Owner@Gmail.com', 'password' => self::STRONG, 'role' => 'cashier', 'is_active' => true]);

        $this->postJson('/api/auth/login', ['email' => 'shop.owner@gmail.com', 'password' => self::STRONG])->assertOk();
        $this->postJson('/api/auth/login', ['email' => 'SHOP.OWNER@GMAIL.COM', 'password' => self::STRONG])->assertOk();
    }

    public function test_an_account_stored_with_capitals_before_this_fix_can_still_sign_in(): void
    {
        // Rows written by older versions kept the capitalisation the owner typed
        \DB::table('users')->insert([
            'name' => 'Legacy', 'email' => 'Legacy.Owner@Example.com', 'password' => Hash::make(self::STRONG),
            'role' => 'cashier', 'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
        ]);

        $this->postJson('/api/auth/login', ['email' => 'legacy.owner@example.com', 'password' => self::STRONG])->assertOk();
    }

    public function test_wrong_password_and_unknown_email_stay_indistinguishable(): void
    {
        $this->embedded();
        $wrong = $this->postJson('/api/auth/login', ['email' => 'owner@foodcourt.com', 'password' => 'definitely-wrong-1']);
        $unknown = $this->postJson('/api/auth/login', ['email' => 'nobody@nowhere.example', 'password' => 'definitely-wrong-1']);

        $wrong->assertStatus(422);
        $unknown->assertStatus(422);
        $this->assertSame($wrong->json('errors.email'), $unknown->json('errors.email'));
        $this->assertNull($wrong->json('code'));
    }

    public function test_staff_email_uniqueness_ignores_capitalisation(): void
    {
        $owner = User::where('email', 'owner@foodcourt.com')->firstOrFail();
        $payload = ['name' => 'Dup', 'email' => 'OWNER@FoodCourt.com', 'password' => self::STRONG, 'role' => 'cashier'];

        $this->actingAs($owner)->postJson('/api/staff', $payload)->assertStatus(422)->assertJsonValidationErrors('email');
    }

    public function test_emails_are_stored_normalised(): void
    {
        $this->embedded();
        $this->emptySystem();

        $this->runSetup('  Asha@Example.COM ')->assertStatus(201);
        $this->assertDatabaseHas('users', ['email' => 'asha@example.com']);
    }

    // ---------------------------------------------------------------- distinct failure: no accounts yet

    public function test_sign_in_on_a_fresh_install_says_setup_is_required(): void
    {
        $this->embedded();
        $this->emptySystem();

        $res = $this->postJson('/api/auth/login', ['email' => 'owner@foodcourt.com', 'password' => 'password123']);
        $res->assertStatus(422)->assertJsonPath('code', 'setup_required');
        $this->assertStringNotContainsStringIgnoringCase('sql', $res->getContent());
    }

    // ---------------------------------------------------------------- one-time setup marker

    public function test_setup_records_completion_and_returns_a_recovery_key_once(): void
    {
        $this->embedded();
        $this->emptySystem();

        $res = $this->runSetup()->assertStatus(201);
        $key = $res->json('data.recovery_key');
        $this->assertMatchesRegularExpression('/^[A-Z2-7]{4}(-[A-Z2-7]{4}){4}$/', $key);

        $stored = Setting::getValue('system_setup');
        $this->assertNotEmpty($stored['completed_at']);
        $this->assertTrue(Hash::check($key, $stored['recovery_key_hash']));
        $this->assertStringNotContainsString($key, json_encode($stored), 'the key itself must never be stored');
    }

    public function test_deleted_owner_is_not_silently_recreated(): void
    {
        $this->embedded();
        $this->emptySystem();
        $this->runSetup()->assertStatus(201);

        Schema::withoutForeignKeyConstraints(fn () => User::query()->delete());

        $this->getJson('/api/setup/status')->assertOk()
            ->assertJsonPath('data.needs_setup', false)
            ->assertJsonPath('data.recovery_required', true);
        $this->runSetup('intruder@example.com')->assertStatus(409);
        $this->assertDatabaseCount('users', 0);

        $res = $this->postJson('/api/auth/login', ['email' => 'asha@example.com', 'password' => self::STRONG]);
        $res->assertStatus(422)->assertJsonPath('code', 'owner_missing');
    }

    public function test_existing_installation_without_a_marker_is_never_offered_setup(): void
    {
        $this->embedded();
        Setting::query()->where('key', 'system_setup')->delete();

        $this->getJson('/api/setup/status')->assertOk()->assertJsonPath('data.needs_setup', false);
        $this->assertNotNull(Setting::getValue('system_setup'), 'the marker is back-filled for an installation that already has users');
        $this->runSetup('intruder@example.com')->assertStatus(409);
    }

    // ---------------------------------------------------------------- recovery

    public function test_recovery_key_resets_the_owner_password_and_rotates_itself(): void
    {
        $this->embedded();
        $this->emptySystem();
        $key = $this->runSetup()->json('data.recovery_key');

        $res = $this->postJson('/api/setup/recover', ['email' => 'asha@example.com', 'recovery_key' => strtolower(str_replace('-', ' ', $key)), 'password' => 'N3wPassword77']);
        $res->assertOk();
        $newKey = $res->json('data.recovery_key');
        $this->assertNotSame($key, $newKey);

        $this->postJson('/api/auth/login', ['email' => 'asha@example.com', 'password' => 'N3wPassword77'])->assertOk();
        $this->postJson('/api/auth/login', ['email' => 'asha@example.com', 'password' => self::STRONG])->assertStatus(422);
        $this->postJson('/api/setup/recover', ['email' => 'asha@example.com', 'recovery_key' => $key, 'password' => 'An0therPass12'])->assertStatus(422);
        $this->assertDatabaseHas('audit_logs', ['action' => 'owner_password_recovered']);
    }

    public function test_polling_setup_status_and_signing_up_never_lock_out_recovery(): void
    {
        $this->embedded();
        $this->emptySystem();
        for ($i = 0; $i < 12; $i++) {
            $this->getJson('/api/setup/status')->assertOk();
        }
        $key = $this->runSetup()->assertStatus(201)->json('data.recovery_key');
        $this->runSetup('intruder@example.com')->assertStatus(409);

        // Five wrong guesses are allowed per minute, then it stops: protection against guessing the key
        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/setup/recover', ['email' => 'asha@example.com', 'recovery_key' => 'AAAA-BBBB-CCCC-DDDD-EEE' . $i, 'password' => 'N3wPassword77'])->assertStatus(422);
        }
        $this->postJson('/api/setup/recover', ['email' => 'asha@example.com', 'recovery_key' => $key, 'password' => 'N3wPassword77'])->assertStatus(429);
    }

    public function test_recovery_with_a_wrong_key_changes_nothing(): void
    {
        $this->embedded();
        $this->emptySystem();
        $this->runSetup()->assertStatus(201);

        $this->postJson('/api/setup/recover', ['email' => 'asha@example.com', 'recovery_key' => 'AAAA-BBBB-CCCC-DDDD-EEEE', 'password' => 'N3wPassword77'])->assertStatus(422);
        $this->postJson('/api/auth/login', ['email' => 'asha@example.com', 'password' => self::STRONG])->assertOk();
    }

    public function test_recovery_can_restore_a_deleted_owner_only_with_the_key(): void
    {
        $this->embedded();
        $this->emptySystem();
        $key = $this->runSetup()->json('data.recovery_key');
        Schema::withoutForeignKeyConstraints(fn () => User::query()->delete());

        $this->postJson('/api/setup/recover', ['email' => 'new@example.com', 'name' => 'New Owner', 'recovery_key' => 'AAAA-BBBB-CCCC-DDDD-EEEE', 'password' => 'N3wPassword77'])->assertStatus(422);
        $this->assertDatabaseCount('users', 0);

        $this->postJson('/api/setup/recover', ['email' => 'new@example.com', 'name' => 'New Owner', 'recovery_key' => $key, 'password' => 'N3wPassword77'])->assertOk();
        $this->assertDatabaseHas('users', ['email' => 'new@example.com', 'role' => 'owner']);
    }

    public function test_recovery_does_not_exist_outside_embedded_mode(): void
    {
        config(['foodcourt.embedded' => false]);
        $this->postJson('/api/setup/recover', ['email' => 'owner@foodcourt.com', 'recovery_key' => 'AAAA-BBBB-CCCC-DDDD-EEEE', 'password' => 'N3wPassword77'])->assertStatus(404);
    }

    public function test_signed_in_owner_can_issue_a_new_recovery_key_with_their_password(): void
    {
        $this->embedded();
        $this->emptySystem();
        $this->runSetup()->assertStatus(201);
        $owner = User::where('email', 'asha@example.com')->firstOrFail();

        $this->actingAs($owner)->postJson('/api/setup/recovery-key', ['password' => 'wrong-password-1'])->assertStatus(422);
        $res = $this->actingAs($owner)->postJson('/api/setup/recovery-key', ['password' => self::STRONG])->assertOk();
        $this->assertTrue(Hash::check($res->json('data.recovery_key'), Setting::getValue('system_setup')['recovery_key_hash']));
    }

    public function test_only_an_owner_can_issue_a_recovery_key(): void
    {
        $this->embedded();
        $cashier = User::where('email', 'cashier@foodcourt.com')->firstOrFail();

        $this->actingAs($cashier)->postJson('/api/setup/recovery-key', ['password' => 'password123'])->assertStatus(403);
    }

    // ---------------------------------------------------------------- readiness / sessions

    public function test_readiness_report_is_minimal_and_truthful(): void
    {
        $this->embedded();
        $res = $this->getJson('/api/system/ready')->assertOk();

        $res->assertJsonPath('data.database', true)->assertJsonPath('data.migrations_current', true)->assertJsonPath('data.ready', true);
        $body = $res->getContent();
        foreach (['password', 'DB_', 'storage', 'sqlite', 'pgsql', 'C:\\\\', 'vendor'] as $leak) {
            $this->assertStringNotContainsStringIgnoringCase($leak, $body);
        }
    }

    public function test_readiness_tells_a_fresh_install_it_needs_setup(): void
    {
        $this->embedded();
        $this->emptySystem();

        $this->getJson('/api/system/ready')->assertOk()->assertJsonPath('data.setup', 'needed');
    }

    public function test_a_revoked_token_is_rejected_with_401(): void
    {
        $owner = User::where('email', 'owner@foodcourt.com')->firstOrFail();
        $token = $owner->createToken('t')->plainTextToken;
        $this->withToken($token)->getJson('/api/auth/me')->assertOk();

        $owner->tokens()->delete();
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/auth/me')->assertStatus(401);
    }
}
