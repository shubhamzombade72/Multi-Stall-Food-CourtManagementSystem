<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Customer;
use App\Models\DiningTable;
use App\Models\MenuItem;
use App\Models\Order;
use App\Models\Payment;
use App\Models\Stall;
use App\Models\StallKitchenTicket;
use App\Models\Supplier;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Concerns\ServesOrders;
use Tests\TestCase;

/**
 * Master PRD modules: settings, tables, customers, suppliers, order management,
 * reports, notifications, login history and denied-access auditing.
 */
class MasterModulesTest extends TestCase
{
    use DatabaseTransactions;
    use ServesOrders;

    private function user(string $role, ?int $stallId = null): User
    {
        $q = User::where('role', $role)->where('is_active', true);
        if ($stallId) {
            $q->where('stall_id', $stallId);
        }

        return $q->firstOrFail();
    }

    private function availableItem(?int $stallId = null): MenuItem
    {
        return MenuItem::where('is_available', true)
            ->whereHas('stall', fn ($q) => $q->where('is_active', true))
            ->when($stallId, fn ($q) => $q->where('stall_id', $stallId))
            ->firstOrFail();
    }

    private function placeOrder(User $as, array $extra = []): array
    {
        $res = $this->actingAs($as, 'sanctum')->postJson('/api/orders', array_merge([
            'order_type' => 'takeaway',
            'items' => [['menu_item_id' => $this->availableItem()->id, 'quantity' => 1]],
        ], $extra));
        $res->assertStatus(201);

        return $res->json('data');
    }

    // ------------------------------------------------------------- settings

    public function test_settings_are_readable_by_staff_and_writable_by_owner_only_with_audit(): void
    {
        $owner = $this->user('owner');
        $cashier = $this->user('cashier');

        $this->actingAs($cashier, 'sanctum')->getJson('/api/settings')
            ->assertStatus(200)
            ->assertJsonPath('data.tax.editable', true)
            ->assertJsonPath('data.payment_methods.available', ['cash', 'upi_qr', 'card']);

        $this->actingAs($cashier, 'sanctum')->putJson('/api/settings/business_profile', ['name' => 'Hacked'])->assertStatus(403);

        $this->actingAs($owner, 'sanctum')->putJson('/api/settings/business_profile', [
            'name' => 'Test Food Court', 'gstin' => 'not-a-gstin',
        ])->assertStatus(422)->assertJsonValidationErrors('gstin');

        $this->actingAs($owner, 'sanctum')->putJson('/api/settings/business_profile', [
            'name' => 'Test Food Court', 'opening_time' => '09:00', 'closing_time' => '23:00',
        ])->assertStatus(200)->assertJsonPath('data.name', 'Test Food Court');
        $this->assertNotNull(AuditLog::where('action', 'settings_updated')->where('entity_id', 'business_profile')->first());

        // GST is owner-configurable now (details in GstConfigurationTest); the old ad-hoc 'rate' body is not a valid payload
        $this->actingAs($owner, 'sanctum')->putJson('/api/settings/tax', ['rate' => 18])->assertStatus(422);
        $this->actingAs($cashier, 'sanctum')->putJson('/api/settings/tax', ['enabled' => true, 'rate_percent' => 18, 'mode' => 'exclusive', 'apply_to' => 'all'])->assertStatus(403);
    }

    public function test_disabled_payment_method_is_refused_at_billing(): void
    {
        $owner = $this->user('owner');
        $cashier = $this->user('cashier');
        $this->actingAs($owner, 'sanctum')->putJson('/api/settings/payment_methods', ['enabled' => ['cash']])->assertStatus(200);
        $this->actingAs($owner, 'sanctum')->putJson('/api/settings/payment_methods', ['enabled' => ['bitcoin']])->assertStatus(422);

        $order = $this->placeOrder($cashier);
        $this->serveAllItems($order['id']);
        $this->actingAs($cashier, 'sanctum')->postJson('/api/billing/pay', [
            'order_id' => $order['id'], 'payment_method' => 'card', 'amount' => $order['total_amount'],
        ])->assertStatus(422)->assertJsonValidationErrors('payment_method');
        $this->actingAs($cashier, 'sanctum')->postJson('/api/billing/pay', [
            'order_id' => $order['id'], 'payment_method' => 'cash', 'amount' => $order['total_amount'], 'cash_tendered' => 1000,
        ])->assertStatus(200);
    }

    // ------------------------------------------------------------- tables

    public function test_owner_manages_tables_and_sections(): void
    {
        $owner = $this->user('owner');
        $waiter = $this->user('waiter');
        $number = 'TT-' . random_int(100, 999);

        $created = $this->actingAs($owner, 'sanctum')->postJson('/api/tables', ['table_number' => $number, 'capacity' => 4]);
        $created->assertStatus(201)->assertJsonPath('data.section', 'Main Hall');
        $id = $created->json('data.id');

        $this->actingAs($owner, 'sanctum')->putJson("/api/tables/{$id}", ['section' => 'Terrace', 'capacity' => 6])
            ->assertStatus(200)->assertJsonPath('data.section', 'Terrace');
        $this->assertContains('Terrace', $this->actingAs($owner, 'sanctum')->getJson('/api/tables/sections')->json('data'));
        $this->actingAs($waiter, 'sanctum')->putJson("/api/tables/{$id}", ['capacity' => 2])->assertStatus(403);

        // occupied tables cannot be deactivated; free ones can, and disappear from ordering lists
        DiningTable::where('id', $id)->update(['status' => 'occupied']);
        $this->actingAs($owner, 'sanctum')->putJson("/api/tables/{$id}", ['is_active' => false])->assertStatus(422);
        DiningTable::where('id', $id)->update(['status' => 'available']);
        $this->actingAs($owner, 'sanctum')->putJson("/api/tables/{$id}", ['is_active' => false])->assertStatus(200);
        $this->assertFalse(collect($this->actingAs($waiter, 'sanctum')->getJson('/api/tables')->json('data'))->contains('id', $id));
        $this->assertTrue(collect($this->actingAs($owner, 'sanctum')->getJson('/api/tables?include_inactive=1')->json('data'))->contains('id', $id));
        $this->assertSame(2, AuditLog::where('entity_type', 'DiningTable')->where('entity_id', (string) $id)->where('action', 'table_updated')->count());
    }

    // ------------------------------------------------------------- customers

    public function test_customer_directory_lookup_and_history_by_phone(): void
    {
        $cashier = $this->user('cashier');
        $kitchen = $this->user('kitchen_staff');
        $phone = '98' . random_int(10000000, 99999999);

        $res = $this->actingAs($cashier, 'sanctum')->postJson('/api/customers', ['name' => 'Asha Test', 'phone' => '+91 ' . $phone]);
        $res->assertStatus(201)->assertJsonPath('data.phone', '+91' . $phone);
        $id = $res->json('data.id');
        $this->actingAs($cashier, 'sanctum')->postJson('/api/customers', ['name' => 'Dup', 'phone' => '+91-' . $phone])->assertStatus(422);

        $this->actingAs($cashier, 'sanctum')->getJson('/api/customers/lookup?phone=' . urlencode('+91 ' . $phone))
            ->assertStatus(200)->assertJsonPath('data.id', $id);

        // an order with the phone typed differently lands in the same history
        $order = $this->placeOrder($cashier, ['customer_name' => 'Asha Test', 'customer_phone' => '+91 ' . substr($phone, 0, 5) . ' ' . substr($phone, 5)]);
        $show = $this->actingAs($cashier, 'sanctum')->getJson("/api/customers/{$id}");
        $show->assertStatus(200)->assertJsonPath('data.summary.orders_count', 1);
        $this->assertSame($order['id'], $show->json('data.orders.0.id'));

        $list = $this->actingAs($cashier, 'sanctum')->getJson('/api/customers?search=Asha%20Test');
        $this->assertSame(1, (int) collect($list->json('data.data'))->firstWhere('id', $id)['orders_count']);

        $this->actingAs($kitchen, 'sanctum')->getJson('/api/customers')->assertStatus(403);
        $this->assertNotNull(AuditLog::where('action', 'customer_created')->where('entity_id', (string) $id)->first());
    }

    // ------------------------------------------------------------- suppliers

    public function test_supplier_edit_deactivate_history_and_stall_isolation(): void
    {
        $stalls = Stall::orderBy('id')->take(2)->get();
        $owner = $this->user('owner');
        $managerA = $this->user('stall_manager', $stalls[0]->id);
        $supplier = Supplier::create(['stall_id' => $stalls[0]->id, 'name' => 'Test Veg Supplier', 'is_active' => true]);
        $foreign = Supplier::create(['stall_id' => $stalls[1]->id, 'name' => 'Other Stall Supplier', 'is_active' => true]);

        $this->actingAs($managerA, 'sanctum')->putJson("/api/suppliers/{$supplier->id}", ['phone' => '9000000001'])->assertStatus(200);
        $this->actingAs($managerA, 'sanctum')->putJson("/api/suppliers/{$foreign->id}", ['name' => 'x'])->assertStatus(403);
        $this->actingAs($managerA, 'sanctum')->getJson("/api/suppliers/{$foreign->id}")->assertStatus(403);
        $this->actingAs($owner, 'sanctum')->getJson("/api/suppliers/{$supplier->id}")->assertStatus(200)->assertJsonPath('data.summary.purchase_orders', 0);

        $this->actingAs($managerA, 'sanctum')->putJson("/api/suppliers/{$supplier->id}", ['is_active' => false])->assertStatus(200);
        $this->assertFalse(collect($this->actingAs($managerA, 'sanctum')->getJson('/api/suppliers')->json('data'))->contains('id', $supplier->id));
        $this->assertTrue(collect($this->actingAs($managerA, 'sanctum')->getJson('/api/suppliers?include_inactive=1')->json('data'))->contains('id', $supplier->id));

        // an inactive supplier cannot be used for a new purchase order
        $item = \App\Models\InventoryItem::create(['stall_id' => $stalls[0]->id, 'name' => 'Test Onion', 'unit' => 'kg']);
        $this->actingAs($managerA, 'sanctum')->postJson('/api/purchases', [
            'stall_id' => $stalls[0]->id, 'supplier_id' => $supplier->id, 'order_date' => now()->toDateString(),
            'items' => [['inventory_item_id' => $item->id, 'quantity' => 1, 'unit_price' => 10]],
        ])->assertStatus(422);
        $this->assertSame(2, AuditLog::where('action', 'supplier_updated')->where('entity_id', (string) $supplier->id)->count());
    }

    // ------------------------------------------------------------- order management

    public function test_order_search_filters_and_cancellation_with_reason(): void
    {
        $cashier = $this->user('cashier');
        $order = $this->placeOrder($cashier, ['customer_name' => 'Ravi Filter', 'customer_phone' => '9123400000']);

        $found = $this->actingAs($cashier, 'sanctum')->getJson('/api/orders?search=Ravi%20Filter&date_from=' . now()->toDateString());
        $found->assertStatus(200);
        $this->assertSame($order['id'], $found->json('data.data.0.id'));
        $this->actingAs($cashier, 'sanctum')->getJson('/api/orders?date_from=2026-02-01&date_to=2026-01-01')->assertStatus(422);

        $this->actingAs($cashier, 'sanctum')->postJson("/api/orders/{$order['id']}/cancel", [])->assertStatus(422)->assertJsonValidationErrors('reason');
        $this->actingAs($cashier, 'sanctum')->postJson("/api/orders/{$order['id']}/cancel", ['reason' => 'Customer left'])->assertStatus(200);
        $this->actingAs($cashier, 'sanctum')->postJson("/api/orders/{$order['id']}/cancel", ['reason' => 'Again'])->assertStatus(422);

        $fresh = Order::find($order['id']);
        $this->assertSame('cancelled', $fresh->status);
        $this->assertStringContainsString('Customer left', $fresh->notes);
        $this->assertSame(0, StallKitchenTicket::where('order_id', $order['id'])->where('status', '!=', 'cancelled')->count());
        $audit = AuditLog::where('action', 'order_cancelled')->where('entity_id', (string) $order['id'])->first();
        $this->assertSame('Customer left', $audit->new_values['reason']);
    }

    public function test_cancelling_one_order_keeps_table_occupied_while_another_is_open(): void
    {
        $cashier = $this->user('cashier');
        $table = DiningTable::where('is_active', true)->firstOrFail();
        $first = $this->placeOrder($cashier, ['order_type' => 'dine_in', 'table_id' => $table->id]);
        $this->placeOrder($cashier, ['order_type' => 'dine_in', 'table_id' => $table->id]);

        $this->actingAs($cashier, 'sanctum')->postJson("/api/orders/{$first['id']}/cancel", ['reason' => 'Duplicate'])->assertStatus(200);
        $this->assertSame('occupied', $table->fresh()->status);
    }

    // ------------------------------------------------------------- reports

    public function test_new_reports_are_owner_only_and_reflect_payments(): void
    {
        $owner = $this->user('owner');
        $cashier = $this->user('cashier');
        $today = now()->toDateString();
        $paidBefore = (string) Payment::where('status', 'success')->whereDate('created_at', $today)->sum('amount');

        $order = $this->placeOrder($cashier);
        $this->serveAllItems($order['id']);
        $this->actingAs($cashier, 'sanctum')->postJson('/api/billing/pay', [
            'order_id' => $order['id'], 'payment_method' => 'upi_qr', 'amount' => $order['total_amount'],
        ])->assertStatus(200);

        $q = "?start_date={$today}&end_date={$today}";
        foreach (['sales-summary', 'payment-summary', 'purchases', 'inventory', 'staff-activity'] as $r) {
            $this->actingAs($cashier, 'sanctum')->getJson("/api/reports/{$r}{$q}")->assertStatus(403);
            $this->actingAs($owner, 'sanctum')->getJson("/api/reports/{$r}{$q}")->assertStatus(200);
        }

        $days = $this->actingAs($owner, 'sanctum')->getJson("/api/reports/payment-summary{$q}")->json('data.by_day');
        $this->assertSame(0, bccomp(bcadd($paidBefore, (string) $order['total_amount'], 2), (string) $days[0]['total_amount'], 2));
        $inventory = $this->actingAs($owner, 'sanctum')->getJson('/api/reports/inventory')->json('data');
        $this->assertArrayHasKey('total_value', $inventory);
        $this->actingAs($owner, 'sanctum')->getJson('/api/reports/audit-logs?action=order_created&date_from=' . $today)
            ->assertStatus(200)->assertJsonPath('data.data.0.action', 'order_created');
    }

    // ------------------------------------------------------------- notifications

    public function test_notifications_are_filtered_by_role_and_stall(): void
    {
        $cashier = $this->user('cashier');
        $order = $this->placeOrder($cashier);
        $ticket = StallKitchenTicket::where('order_id', $order['id'])->firstOrFail();
        $ownKitchen = User::where('role', 'kitchen_staff')->where('stall_id', $ticket->stall_id)->where('is_active', true)->first();
        $otherKitchen = User::where('role', 'kitchen_staff')->where('stall_id', '!=', $ticket->stall_id)->where('is_active', true)->first();

        $ids = fn (User $u) => collect($this->actingAs($u, 'sanctum')->getJson('/api/notifications')->assertStatus(200)->json('data.items'))->pluck('id');

        $this->assertTrue($ids($cashier)->contains("order:{$order['id']}"));
        if ($ownKitchen) {
            $this->assertTrue($ids($ownKitchen)->contains("ticket:{$ticket->id}"));
        }
        if ($otherKitchen) {
            $this->assertFalse($ids($otherKitchen)->contains("ticket:{$ticket->id}"));
            $this->assertFalse($ids($otherKitchen)->contains("order:{$order['id']}"));
        }
    }

    // ------------------------------------------------------------- login history & denied access

    public function test_logins_and_denied_requests_are_audited(): void
    {
        $owner = $this->user('owner');
        $kitchen = $this->user('kitchen_staff');
        $email = $owner->email;

        $this->postJson('/api/auth/login', ['email' => $email, 'password' => 'definitely-wrong'])->assertStatus(422);
        $failed = AuditLog::where('action', 'login_failed')->latest('id')->first();
        $this->assertSame($email, $failed->new_values['email']);
        $this->assertArrayNotHasKey('password', $failed->new_values);

        $this->actingAs($kitchen, 'sanctum')->getJson('/api/billing/pending')->assertStatus(403);
        $denied = AuditLog::where('action', 'access_denied')->where('user_id', $kitchen->id)->latest('id')->first();
        $this->assertSame('GET /api/billing/pending', $denied->entity_id);
    }
}
