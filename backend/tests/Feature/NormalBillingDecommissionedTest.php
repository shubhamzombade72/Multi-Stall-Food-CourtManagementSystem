<?php

namespace Tests\Feature;

use App\Models\DiningTable;
use App\Models\MenuCategory;
use App\Models\MenuItem;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\OrderSplit;
use App\Models\Payment;
use App\Models\Stall;
use App\Models\UpiPaymentRequest;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class NormalBillingDecommissionedTest extends TestCase
{
    use RefreshDatabase;

    private User $cashier;
    private User $owner;
    private Stall $stall;
    private MenuCategory $category;
    private DiningTable $table;

    protected function setUp(): void
    {
        parent::setUp();

        $this->cashier = User::where('role', 'cashier')->first() ?? User::create([
            'name' => 'Cashier User',
            'email' => 'cashier@test.com',
            'password' => bcrypt('password'),
            'role' => 'cashier',
            'is_active' => true,
        ]);

        $this->owner = User::where('role', 'owner')->first() ?? User::create([
            'name' => 'Owner User',
            'email' => 'owner@test.com',
            'password' => bcrypt('password'),
            'role' => 'owner',
            'is_active' => true,
        ]);

        $this->stall = Stall::first() ?? Stall::create([
            'name' => 'Stall 1',
            'code' => 'ST1',
            'is_active' => true,
        ]);

        $this->category = MenuCategory::first() ?? MenuCategory::create([
            'stall_id' => $this->stall->id,
            'name' => 'Main Course',
        ]);

        $this->table = DiningTable::first() ?? DiningTable::create([
            'table_number' => '1',
            'capacity' => 4,
            'status' => 'available',
        ]);
    }

    private function createTestOrder(string $amount = '300.00', bool $dineIn = true): Order
    {
        $table = $dineIn ? $this->table : null;
        if ($table) {
            $table->update(['status' => 'occupied']);
        }

        $order = Order::create([
            'order_number' => 'TEST-ORD-' . uniqid(),
            'order_type' => $dineIn ? 'dine_in' : 'takeaway',
            'order_channel' => 'cashier_pos',
            'table_id' => $table?->id,
            'status' => 'confirmed',
            'payment_status' => 'unpaid',
            'total_amount' => $amount,
            'customer_name' => 'Test Customer',
        ]);

        $item = MenuItem::first() ?? MenuItem::create([
            'stall_id' => $this->stall->id,
            'category_id' => $this->category->id,
            'name' => 'Test Dish',
            'price' => $amount,
            'is_veg' => true,
            'is_available' => true,
        ]);

        OrderItem::create([
            'order_id' => $order->id,
            'menu_item_id' => $item->id,
            'stall_id' => $item->stall_id,
            'item_name' => $item->name,
            'unit_price' => $amount,
            'quantity' => 1,
            'subtotal' => $amount,
            'status' => 'served',
        ]);

        return $order;
    }

    public function test_1_split_bill_endpoints_are_completely_removed(): void
    {
        $order = $this->createTestOrder('200.00');

        // POST /api/billing/split -> Route must not exist (404)
        $this->actingAs($this->cashier, 'sanctum')
            ->postJson('/api/billing/split', [
                'order_id' => $order->id,
                'split_type' => 'equal',
                'splits_count' => 2,
            ])
            ->assertStatus(404);

        // DELETE /api/billing/split/{id} -> Route must not exist (404)
        $this->actingAs($this->cashier, 'sanctum')
            ->deleteJson("/api/billing/split/{$order->id}")
            ->assertStatus(404);

        // GET /api/billing/split/{id} -> Route must not exist (404)
        $this->actingAs($this->cashier, 'sanctum')
            ->getJson("/api/billing/split/{$order->id}")
            ->assertStatus(404);
    }

    public function test_2_settings_do_not_contain_split_payment_method(): void
    {
        $res = $this->actingAs($this->cashier, 'sanctum')
            ->getJson('/api/settings')
            ->assertStatus(200);

        $available = $res->json('data.payment_methods.available');
        $this->assertIsArray($available);
        $this->assertNotContains('split', $available);
        $this->assertEquals(['cash', 'upi_qr', 'card'], $available);
    }

    public function test_3_normal_order_creation_and_full_cash_settlement(): void
    {
        $order = $this->createTestOrder('500.00', true);
        $tableId = $order->table_id;

        $this->assertSame('unpaid', $order->payment_status);
        $this->assertSame('500.00', $order->remainingBalance());

        $res = $this->actingAs($this->cashier, 'sanctum')
            ->postJson('/api/billing/pay', [
                'order_id' => $order->id,
                'payment_method' => 'cash',
                'amount' => 500.00,
                'cash_tendered' => 600.00,
            ])
            ->assertStatus(200);

        $res->assertJsonPath('success', true);
        $res->assertJsonPath('data.change_returned', '100.00');
        $res->assertJsonPath('data.is_fully_paid', true);
        $res->assertJsonPath('data.remaining_balance', '0.00');

        $order->refresh();
        $this->assertSame('paid', $order->payment_status);
        $this->assertSame('completed', $order->status);
        $this->assertSame('0.00', $order->remainingBalance());
        $this->assertSame('500.00', $order->totalPaid());

        // Table must be released
        if ($tableId) {
            $this->assertSame('available', DiningTable::find($tableId)->status);
        }

        // Verify payment record
        $payment = Payment::where('order_id', $order->id)->first();
        $this->assertNotNull($payment);
        $this->assertSame('success', $payment->status);
        $this->assertSame('cash', $payment->payment_method);
        $this->assertSame('500.00', (string) $payment->amount);
    }

    public function test_4_normal_partial_payment_and_subsequent_settlement(): void
    {
        $order = $this->createTestOrder('400.00', false);

        // 1. Partial payment: Pay Rs 150 of Rs 400
        $res1 = $this->actingAs($this->cashier, 'sanctum')
            ->postJson('/api/billing/pay', [
                'order_id' => $order->id,
                'payment_method' => 'card',
                'amount' => 150.00,
                'transaction_reference' => 'TXN-CARD-150',
            ])
            ->assertStatus(200);

        $res1->assertJsonPath('data.is_fully_paid', false);
        $res1->assertJsonPath('data.remaining_balance', '250.00');

        $order->refresh();
        $this->assertSame('partially_paid', $order->payment_status);
        $this->assertSame('150.00', $order->totalPaid());
        $this->assertSame('250.00', $order->remainingBalance());

        // 2. Overpayment attempt: Tender Rs 300 when remaining is Rs 250 -> 422
        $this->actingAs($this->cashier, 'sanctum')
            ->postJson('/api/billing/pay', [
                'order_id' => $order->id,
                'payment_method' => 'cash',
                'amount' => 300.00,
            ])
            ->assertStatus(422);

        // 3. Complete remaining balance: Pay Rs 250
        $res2 = $this->actingAs($this->cashier, 'sanctum')
            ->postJson('/api/billing/pay', [
                'order_id' => $order->id,
                'payment_method' => 'cash',
                'amount' => 250.00,
                'cash_tendered' => 250.00,
            ])
            ->assertStatus(200);

        $res2->assertJsonPath('data.is_fully_paid', true);
        $res2->assertJsonPath('data.remaining_balance', '0.00');

        $order->refresh();
        $this->assertSame('paid', $order->payment_status);
        $this->assertSame('completed', $order->status);
        $this->assertSame('400.00', $order->totalPaid());
        $this->assertSame('0.00', $order->remainingBalance());

        // 4. Repeated payment attempt after full payment -> 422
        $this->actingAs($this->cashier, 'sanctum')
            ->postJson('/api/billing/pay', [
                'order_id' => $order->id,
                'payment_method' => 'cash',
                'amount' => 50.00,
            ])
            ->assertStatus(422);
    }

    public function test_5_pending_bills_queue_flow(): void
    {
        $order = $this->createTestOrder('250.00', true);

        // Check it appears in pending bills
        $pending = $this->actingAs($this->cashier, 'sanctum')
            ->getJson('/api/billing/pending')
            ->assertStatus(200);

        $found = collect($pending->json('data'))->firstWhere('id', $order->id);
        $this->assertNotNull($found);
        $this->assertEquals('250.00', $found['remaining_balance']);
        $this->assertArrayNotHasKey('splits', $found);

        // Pay partially (Rs 100)
        $this->actingAs($this->cashier, 'sanctum')
            ->postJson('/api/billing/pay', [
                'order_id' => $order->id,
                'payment_method' => 'cash',
                'amount' => 100.00,
                'cash_tendered' => 100.00,
            ])
            ->assertStatus(200);

        // Check still appears in pending bills with updated remaining balance (Rs 150)
        $pendingAfterPart = $this->actingAs($this->cashier, 'sanctum')
            ->getJson('/api/billing/pending')
            ->assertStatus(200);

        $foundAfterPart = collect($pendingAfterPart->json('data'))->firstWhere('id', $order->id);
        $this->assertNotNull($foundAfterPart);
        $this->assertEquals('150.00', $foundAfterPart['remaining_balance']);
        $this->assertEquals('100.00', $foundAfterPart['total_paid']);

        // Settle full remaining Rs 150
        $this->actingAs($this->cashier, 'sanctum')
            ->postJson('/api/billing/pay', [
                'order_id' => $order->id,
                'payment_method' => 'cash',
                'amount' => 150.00,
                'cash_tendered' => 150.00,
            ])
            ->assertStatus(200);

        // Verify order disappears from pending list
        $pendingAfterFull = $this->actingAs($this->cashier, 'sanctum')
            ->getJson('/api/billing/pending')
            ->assertStatus(200);

        $foundAfterFull = collect($pendingAfterFull->json('data'))->firstWhere('id', $order->id);
        $this->assertNull($foundAfterFull);
    }

    public function test_6_receipt_generation_for_normal_orders(): void
    {
        $order = $this->createTestOrder('350.00', false);

        $this->actingAs($this->cashier, 'sanctum')
            ->postJson('/api/billing/pay', [
                'order_id' => $order->id,
                'payment_method' => 'cash',
                'amount' => 350.00,
                'cash_tendered' => 400.00,
            ])
            ->assertStatus(200);

        $receipt = $this->actingAs($this->cashier, 'sanctum')
            ->getJson("/api/billing/receipt/{$order->id}")
            ->assertStatus(200);

        $receipt->assertJsonPath('success', true);
        $receipt->assertJsonPath('data.order.id', $order->id);
        $receipt->assertJsonPath('data.total_paid', '350.00');
        $receipt->assertJsonPath('data.remaining_balance', '0.00');
        $this->assertArrayNotHasKey('split', $receipt->json('data'));
        $this->assertArrayNotHasKey('is_split', $receipt->json('data'));
    }

    public function test_7_historical_successful_payment_cannot_be_deleted(): void
    {
        $order = $this->createTestOrder('100.00', false);
        $payment = Payment::create([
            'order_id' => $order->id,
            'cashier_id' => $this->cashier->id,
            'payment_method' => 'cash',
            'amount' => '100.00',
            'status' => 'success',
        ]);

        $this->expectException(\RuntimeException::class);
        $payment->delete();
    }

    public function test_8_cannot_settle_cancelled_order(): void
    {
        $order = $this->createTestOrder('100.00', false);
        $order->update(['status' => 'cancelled']);

        $this->actingAs($this->cashier, 'sanctum')
            ->postJson('/api/billing/pay', [
                'order_id' => $order->id,
                'payment_method' => 'cash',
                'amount' => 100.00,
            ])
            ->assertStatus(422);
    }

    public function test_9_historical_order_splits_remain_queryable_read_only(): void
    {
        $order = $this->createTestOrder('200.00', false);

        // Manually create a historical split record to simulate existing DB state
        $split = OrderSplit::create([
            'order_id' => $order->id,
            'split_number' => 1,
            'split_code' => $order->order_number . '-S1',
            'split_type' => 'equal',
            'subtotal' => '100.00',
            'tax_amount' => '0.00',
            'discount_amount' => '0.00',
            'total_amount' => '100.00',
            'paid_amount' => '100.00',
            'payment_status' => 'paid',
        ]);

        $this->assertTrue($order->splits()->exists());
        $this->assertEquals(1, $order->splits()->count());
        $this->assertEquals('100.00', $order->splits->first()->total_amount);

        // Historical split cannot be hard-deleted if paid
        $this->expectException(\RuntimeException::class);
        $split->delete();
    }

    public function test_10_payment_history_shows_normal_payments_with_read_only_split_references(): void
    {
        $order = $this->createTestOrder('100.00', false);
        $payment = Payment::create([
            'order_id' => $order->id,
            'cashier_id' => $this->cashier->id,
            'payment_method' => 'cash',
            'amount' => '100.00',
            'status' => 'success',
        ]);

        $res = $this->actingAs($this->cashier, 'sanctum')
            ->getJson('/api/billing/payments')
            ->assertStatus(200);

        $res->assertJsonPath('success', true);
        $found = collect($res->json('data.data'))->firstWhere('id', $payment->id);
        $this->assertNotNull($found);
        $this->assertEquals('100.00', $found['amount']);
        $this->assertEquals('cash', $found['payment_method']);
    }
}
