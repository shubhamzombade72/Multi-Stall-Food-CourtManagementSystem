<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\InventoryItem;
use App\Models\Stall;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\TestCase;

/**
 * Security checks for the master PRD endpoints: authentication, role escalation, cross-stall access,
 * injection-shaped input and stored script payloads.
 */
class MasterSecurityTest extends TestCase
{
    use DatabaseTransactions;

    private function user(string $role, ?int $stallId = null): User
    {
        return User::where('role', $role)->where('is_active', true)
            ->when($stallId, fn ($q) => $q->where('stall_id', $stallId))
            ->firstOrFail();
    }

    public function test_new_endpoints_require_authentication(): void
    {
        $endpoints = [
            ['GET', '/api/settings'], ['PUT', '/api/settings/business_profile'], ['GET', '/api/customers'],
            ['POST', '/api/customers'], ['GET', '/api/customers/lookup?phone=999999'], ['GET', '/api/notifications'],
            ['GET', '/api/cashier-closings'], ['POST', '/api/cashier-closings'], ['GET', '/api/reports/sales-summary'],
            ['GET', '/api/reports/inventory'], ['GET', '/api/reports/staff-activity'], ['PUT', '/api/tables/1'],
            ['GET', '/api/tables/sections'], ['GET', '/api/suppliers/1'], ['PUT', '/api/suppliers/1'],
        ];
        foreach ($endpoints as [$method, $uri]) {
            $this->json($method, $uri)->assertStatus(401);
        }
    }

    public function test_roles_cannot_escalate_into_owner_or_cashier_functions(): void
    {
        $waiter = $this->user('waiter');
        $kitchen = $this->user('kitchen_staff');
        // the seed has no store staff account, so create one for this test
        $store = User::create([
            'name' => 'Test Store Staff', 'email' => 'store.' . uniqid() . '@foodcourt.test', 'password' => 'StrongPass123',
            'role' => 'store_staff', 'stall_id' => Stall::orderBy('id')->value('id'), 'is_active' => true,
        ]);

        foreach ([$waiter, $kitchen, $store] as $u) {
            $this->actingAs($u, 'sanctum')->putJson('/api/settings/payment_methods', ['enabled' => ['cash']])->assertStatus(403);
            $this->actingAs($u, 'sanctum')->getJson('/api/customers')->assertStatus(403);
            $this->actingAs($u, 'sanctum')->postJson('/api/customers', ['name' => 'X', 'phone' => '9876543210'])->assertStatus(403);
            $this->actingAs($u, 'sanctum')->getJson('/api/cashier-closings')->assertStatus(403);
            $this->actingAs($u, 'sanctum')->getJson('/api/reports/sales-summary')->assertStatus(403);
            $this->actingAs($u, 'sanctum')->getJson('/api/reports/audit-logs')->assertStatus(403);
            $this->actingAs($u, 'sanctum')->postJson('/api/tables', ['table_number' => 'HACK', 'capacity' => 2])->assertStatus(403);
        }

        // A cashier cannot change settings, read owner reports or close another cashier
        $cashier = $this->user('cashier');
        $this->actingAs($cashier, 'sanctum')->putJson('/api/settings/receipt', ['show_gstin' => true])->assertStatus(403);
        $this->actingAs($cashier, 'sanctum')->getJson('/api/reports/staff-activity')->assertStatus(403);
        $this->actingAs($cashier, 'sanctum')->getJson('/api/cashier-closings/preview?date=' . now()->toDateString() . '&cashier_id=' . $this->user('owner')->id)->assertStatus(403);
    }

    public function test_stall_staff_cannot_reach_other_stalls_through_new_endpoints(): void
    {
        $stalls = Stall::orderBy('id')->take(2)->get();
        $managerA = $this->user('stall_manager', $stalls[0]->id);
        $storeA = User::where('role', 'store_staff')->where('stall_id', $stalls[0]->id)->first();
        $lowB = InventoryItem::create(['stall_id' => $stalls[1]->id, 'name' => 'Other stall flour', 'unit' => 'kg', 'current_stock' => 0, 'minimum_alert_stock' => 5]);

        // stall_id query parameters are ignored for non-owners
        $movements = $this->actingAs($managerA, 'sanctum')->getJson("/api/inventory/movements?stall_id={$stalls[1]->id}")->assertStatus(200)->json('data.data');
        $this->assertTrue(collect($movements)->every(fn ($m) => $m['stall_id'] === $stalls[0]->id));
        $suppliers = $this->actingAs($managerA, 'sanctum')->getJson("/api/suppliers?include_inactive=1&stall_id={$stalls[1]->id}")->json('data');
        $this->assertTrue(collect($suppliers)->every(fn ($s) => $s['stall_id'] === $stalls[0]->id));

        foreach (array_filter([$managerA, $storeA]) as $u) {
            $ids = collect($this->actingAs($u, 'sanctum')->getJson('/api/notifications')->json('data.items'))->pluck('id');
            $this->assertFalse($ids->contains(fn ($id) => str_starts_with($id, "low:{$lowB->id}:")), 'Low-stock alert leaked to another stall');
        }
    }

    public function test_injection_shaped_search_input_is_treated_as_text(): void
    {
        $owner = $this->user('owner');
        $cashier = $this->user('cashier');
        Customer::create(['name' => 'Plain Customer', 'phone' => '7000000001']);

        foreach (["' OR 1=1 --", '%', '_', "\\", '"; DROP TABLE orders; --'] as $term) {
            $res = $this->actingAs($cashier, 'sanctum')->getJson('/api/customers?search=' . urlencode($term));
            $res->assertStatus(200);
            $this->assertSame(0, $res->json('data.total'), "Search '{$term}' matched rows it should not");
            $this->actingAs($cashier, 'sanctum')->getJson('/api/orders?search=' . urlencode($term))->assertStatus(200);
            $this->actingAs($owner, 'sanctum')->getJson('/api/suppliers?search=' . urlencode($term))->assertStatus(200);
        }
        $this->assertTrue(\Illuminate\Support\Facades\Schema::hasTable('orders'));

        // invalid filter values are rejected, not passed to SQL
        $this->actingAs($cashier, 'sanctum')->getJson('/api/orders?payment_status=paid%27%20OR%201=1')->assertStatus(422);
        $this->actingAs($cashier, 'sanctum')->getJson('/api/orders?per_page=100000')->assertStatus(422);
    }

    public function test_script_payloads_are_stored_as_plain_text(): void
    {
        $owner = $this->user('owner');
        $payload = '<img src=x onerror=alert(1)>';

        $this->actingAs($owner, 'sanctum')->putJson('/api/settings/receipt', ['header' => $payload, 'footer' => 'ok', 'show_gstin' => false])->assertStatus(200);
        $this->actingAs($owner, 'sanctum')->getJson('/api/settings')->assertJsonPath('data.receipt.header', $payload);

        $res = $this->actingAs($owner, 'sanctum')->postJson('/api/customers', ['name' => $payload, 'phone' => '7000000002']);
        $res->assertStatus(201)->assertJsonPath('data.name', $payload);
        // JSON API: the value comes back verbatim with an application/json content type; the desktop renders it as text
        $this->assertStringStartsWith('application/json', $res->headers->get('Content-Type'));
    }
}
