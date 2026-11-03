<?php

namespace Tests\Feature;

use App\Models\PairedDevice;
use App\Models\Setting;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\TestCase;

/**
 * Multi-PC mode: terminals are paired to the host with a one-time code and then carry a device token.
 * Pairing exists only on a shared server (never on a PC's built-in server).
 */
class DevicePairingTest extends TestCase
{
    use DatabaseTransactions;

    private function owner(): User
    {
        return User::where('email', 'owner@foodcourt.com')->firstOrFail();
    }

    private function issueCode(): array
    {
        config(['foodcourt.embedded' => false]);

        return $this->actingAs($this->owner())->postJson('/api/pairing/codes')->assertCreated()->json('data');
    }

    public function test_owner_issues_a_one_time_code_that_carries_the_host_address(): void
    {
        $data = $this->issueCode();

        $this->assertMatchesRegularExpression('/^[A-Z2-7]{4}-[A-Z2-7]{4}$/', $data['code']);
        $this->assertStringStartsWith('FCPAIR1.', $data['pairing_string']);
        $decoded = json_decode(base64_decode(strtr(substr($data['pairing_string'], 8), '-_', '+/')), true);
        $this->assertSame($data['code'], $decoded['c']);
        $this->assertStringEndsWith('/api', $decoded['u']);
        $this->assertStringNotContainsString($data['code'], json_encode(Setting::getValue('pairing_code')), 'only a hash is stored');
    }

    public function test_the_administrator_can_create_the_first_code_on_the_host(): void
    {
        config(['foodcourt.embedded' => false]);

        $this->artisan('foodcourt:pairing-code', ['--url' => 'https://host.lan/api'])->expectsOutputToContain('FCPAIR1.')->assertSuccessful();
        $this->artisan('foodcourt:pairing-code', ['--url' => 'not a url'])->assertFailed();

        config(['foodcourt.embedded' => true]);
        $this->artisan('foodcourt:pairing-code', ['--url' => 'https://host.lan/api'])->assertFailed();
    }

    public function test_the_host_administrator_can_create_the_first_owner_only_once(): void
    {
        config(['foodcourt.embedded' => false]);
        \Illuminate\Support\Facades\Schema::withoutForeignKeyConstraints(fn () => User::query()->delete());

        $this->artisan('foodcourt:create-owner', ['email' => 'Boss@Example.com', 'name' => 'The Boss'])
            ->expectsQuestion('Password (at least 8 characters, letters and numbers)', 'weak')
            ->expectsQuestion('Repeat the password', 'weak')
            ->assertFailed();
        $this->assertDatabaseCount('users', 0);

        $this->artisan('foodcourt:create-owner', ['email' => 'Boss@Example.com', 'name' => 'The Boss'])
            ->expectsQuestion('Password (at least 8 characters, letters and numbers)', 'Str0ngPass99')
            ->expectsQuestion('Repeat the password', 'Str0ngPass99')
            ->assertSuccessful();
        $this->assertDatabaseHas('users', ['email' => 'boss@example.com', 'role' => 'owner']);
        $this->postJson('/api/auth/login', ['email' => 'boss@example.com', 'password' => 'Str0ngPass99'])->assertOk();

        $this->artisan('foodcourt:create-owner', ['email' => 'second@example.com', 'name' => 'Second'])
            ->expectsQuestion('Password (at least 8 characters, letters and numbers)', 'Str0ngPass99')
            ->expectsQuestion('Repeat the password', 'Str0ngPass99')
            ->assertFailed();
        $this->assertDatabaseMissing('users', ['email' => 'second@example.com']);

        config(['foodcourt.embedded' => true]);
        $this->artisan('foodcourt:create-owner', ['email' => 'x@example.com', 'name' => 'X'])->assertFailed();
    }

    public function test_only_the_owner_can_issue_a_code(): void
    {
        config(['foodcourt.embedded' => false]);
        $cashier = User::where('email', 'cashier@foodcourt.com')->firstOrFail();

        $this->postJson('/api/pairing/codes')->assertStatus(401);
        $this->actingAs($cashier)->postJson('/api/pairing/codes')->assertStatus(403);
    }

    public function test_a_code_pairs_one_terminal_once(): void
    {
        $data = $this->issueCode();

        $res = $this->postJson('/api/pairing/redeem', ['code' => strtolower($data['code']), 'device_name' => 'COUNTER-2'])->assertOk();
        $this->assertNotEmpty($res->json('data.device_token'));
        $this->assertNotEmpty($res->json('data.food_court_name'));
        $this->assertDatabaseHas('paired_devices', ['name' => 'COUNTER-2']);

        $this->postJson('/api/pairing/redeem', ['code' => $data['code'], 'device_name' => 'COUNTER-3'])->assertStatus(422);
        $this->assertDatabaseMissing('paired_devices', ['name' => 'COUNTER-3']);
    }

    public function test_wrong_and_expired_codes_are_refused(): void
    {
        $data = $this->issueCode();
        $this->postJson('/api/pairing/redeem', ['code' => 'AAAA-BBBB', 'device_name' => 'X'])->assertStatus(422);

        $stored = Setting::getValue('pairing_code');
        $stored['expires_at'] = now()->subMinute()->toIso8601String();
        Setting::where('key', 'pairing_code')->update(['value' => json_encode($stored)]);
        $this->postJson('/api/pairing/redeem', ['code' => $data['code'], 'device_name' => 'X'])->assertStatus(422);
        $this->assertDatabaseCount('paired_devices', 0);
    }

    public function test_pairing_does_not_exist_on_a_pcs_built_in_server(): void
    {
        config(['foodcourt.embedded' => true]);

        $this->actingAs($this->owner())->postJson('/api/pairing/codes')->assertStatus(404);
        $this->postJson('/api/pairing/redeem', ['code' => 'AAAA-BBBB', 'device_name' => 'X'])->assertStatus(404);
    }

    public function test_when_required_an_unpaired_terminal_cannot_sign_in_or_call_the_api(): void
    {
        $data = $this->issueCode();
        $token = $this->postJson('/api/pairing/redeem', ['code' => $data['code'], 'device_name' => 'COUNTER-2'])->json('data.device_token');
        config(['foodcourt.require_paired_devices' => true]);
        $creds = ['email' => 'owner@foodcourt.com', 'password' => 'password123'];

        $this->postJson('/api/auth/login', $creds)->assertStatus(403)->assertJsonPath('code', 'device_not_paired');
        $this->withHeader('X-Device-Token', 'not-a-real-token')->postJson('/api/auth/login', $creds)->assertStatus(403);
        $this->withHeader('X-Device-Token', $token)->postJson('/api/auth/login', $creds)->assertOk();
    }

    public function test_a_revoked_terminal_is_locked_out_at_once(): void
    {
        $data = $this->issueCode();
        $res = $this->postJson('/api/pairing/redeem', ['code' => $data['code'], 'device_name' => 'COUNTER-2']);
        $token = $res->json('data.device_token');
        $id = $res->json('data.device_id');
        config(['foodcourt.require_paired_devices' => true]);
        $creds = ['email' => 'owner@foodcourt.com', 'password' => 'password123'];
        $this->withHeader('X-Device-Token', $token)->postJson('/api/auth/login', $creds)->assertOk();

        $this->actingAs($this->owner())->withHeader('X-Device-Token', $token)->deleteJson("/api/pairing/devices/{$id}")->assertOk();
        $this->assertNotNull(PairedDevice::find($id)->revoked_at);

        $this->withHeader('X-Device-Token', $token)->postJson('/api/auth/login', $creds)->assertStatus(403);
    }

    public function test_public_ordering_and_readiness_stay_open_when_pairing_is_required(): void
    {
        config(['foodcourt.require_paired_devices' => true, 'foodcourt.embedded' => false]);

        $this->getJson('/api/public/stalls')->assertOk();
        $this->getJson('/api/system/ready')->assertOk();
    }

    public function test_the_token_is_stored_only_as_a_hash_and_listed_without_it(): void
    {
        $data = $this->issueCode();
        $token = $this->postJson('/api/pairing/redeem', ['code' => $data['code'], 'device_name' => 'COUNTER-2'])->json('data.device_token');

        $this->assertDatabaseMissing('paired_devices', ['token_hash' => $token]);
        $list = $this->actingAs($this->owner())->getJson('/api/pairing/devices')->assertOk();
        $this->assertStringNotContainsString($token, $list->getContent());
        $this->assertStringNotContainsString('token_hash', $list->getContent());
    }
}
