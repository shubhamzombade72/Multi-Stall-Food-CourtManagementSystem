<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * First-run owner setup for the desktop app's built-in server. Every test runs in a transaction that is
 * rolled back, so emptying `users` here never touches the shared test database.
 */
class EmbeddedSetupTest extends TestCase
{
    use DatabaseTransactions;

    private function emptySystem(): void
    {
        // A fresh install has neither accounts nor the "setup completed" marker
        Schema::withoutForeignKeyConstraints(function () {
            User::query()->delete();
            \App\Models\Setting::query()->where('key', 'system_setup')->delete();
        });
    }

    public function test_setup_routes_do_not_exist_outside_embedded_mode(): void
    {
        config(['foodcourt.embedded' => false]);
        $this->emptySystem();

        $this->getJson('/api/setup/status')->assertStatus(404);
        $this->postJson('/api/setup/owner', ['name' => 'X', 'email' => 'x@example.com', 'password' => 'Passw0rdOK'])->assertStatus(404);
        $this->assertDatabaseCount('users', 0);
    }

    public function test_status_reports_whether_setup_is_needed(): void
    {
        config(['foodcourt.embedded' => true]);
        $this->getJson('/api/setup/status')->assertOk()->assertJsonPath('data.needs_setup', false);

        $this->emptySystem();
        $this->getJson('/api/setup/status')->assertOk()->assertJsonPath('data.needs_setup', true);
    }

    public function test_first_run_creates_an_owner_who_can_sign_in(): void
    {
        config(['foodcourt.embedded' => true]);
        $this->emptySystem();

        $res = $this->postJson('/api/setup/owner', ['name' => 'Asha Patil', 'email' => 'asha@example.com', 'password' => 'Str0ngPass99']);
        $res->assertStatus(201)->assertJsonPath('data.user.role', 'owner');
        $this->assertNotEmpty($res->json('data.token'));
        $this->assertDatabaseHas('users', ['email' => 'asha@example.com', 'role' => 'owner', 'is_active' => true]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'owner_setup']);

        $this->postJson('/api/auth/login', ['email' => 'asha@example.com', 'password' => 'Str0ngPass99'])->assertOk();
    }

    public function test_setup_cannot_run_twice(): void
    {
        config(['foodcourt.embedded' => true]);
        $this->emptySystem();
        $payload = ['name' => 'First Owner', 'email' => 'first@example.com', 'password' => 'Str0ngPass99'];

        $this->postJson('/api/setup/owner', $payload)->assertStatus(201);
        $this->postJson('/api/setup/owner', ['name' => 'Intruder', 'email' => 'intruder@example.com', 'password' => 'Str0ngPass99'])->assertStatus(409);
        $this->assertDatabaseMissing('users', ['email' => 'intruder@example.com']);
    }

    public function test_weak_or_invalid_input_is_rejected(): void
    {
        config(['foodcourt.embedded' => true]);
        $this->emptySystem();

        $this->postJson('/api/setup/owner', ['name' => 'A', 'email' => 'a@example.com', 'password' => 'short1'])->assertStatus(422);
        $this->postJson('/api/setup/owner', ['name' => 'A', 'email' => 'a@example.com', 'password' => 'onlyletters'])->assertStatus(422);
        $this->postJson('/api/setup/owner', ['name' => 'A', 'email' => 'not-an-email', 'password' => 'Str0ngPass99'])->assertStatus(422);
        $this->assertDatabaseCount('users', 0);
    }
}
