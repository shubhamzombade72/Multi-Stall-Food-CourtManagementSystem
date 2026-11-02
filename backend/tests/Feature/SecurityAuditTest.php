<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\DiningTable;
use App\Models\MenuItem;
use App\Models\Order;
use App\Models\Payment;
use App\Models\Stall;
use App\Models\User;
use Tests\TestCase;

class SecurityAuditTest extends TestCase
{
    /**
     * REMEDIATED: Insecure Direct Object Reference (IDOR) & Sensitive Data Exposure
     * Sequential integer ID lookup must return 404 (route removed).
     * Only cryptographically secure tracking token (trk_...) is allowed.
     * Returned tracking data masks customer phone and omits PII/credentials.
     */
    public function test_idor_remediated_sequential_id_rejected_and_tracking_token_masks_pii(): void
    {
        $order = Order::first();
        $this->assertNotNull($order, "An order must exist from previous tests");

        // 1. Sequential integer lookup fails with 404
        $idorResponse = $this->getJson("/api/public/orders/{$order->id}");
        $idorResponse->assertStatus(404);

        // 2. Cryptographic tracking token works
        $this->assertNotNull($order->tracking_token);
        $trackResponse = $this->getJson("/api/public/orders/track/{$order->tracking_token}");
        $trackResponse->assertStatus(200);

        $data = $trackResponse->json('data');
        $this->assertEquals($order->tracking_token, $data['tracking_token']);
        $this->assertEquals($order->order_number, $data['order_number']);

        // 3. Customer PII is protected (customer_phone is masked e.g. '******1234' or not raw)
        if (!empty($order->customer_phone) && !empty($data['customer_phone'])) {
            $this->assertStringContainsString('*', $data['customer_phone']);
        }

        // 4. Invalid or tampered tracking token returns 404
        $invalidResponse = $this->getJson("/api/public/orders/track/invalid_token_999999");
        $invalidResponse->assertStatus(404);
    }

    /**
     * REMEDIATED: Channel Spoofing via Public Order Endpoint
     * Public unauthenticated order requests are strictly forced to 'qr_customer'.
     */
    public function test_public_order_blocks_channel_spoofing_and_forces_qr_customer(): void
    {
        $table = DiningTable::first();
        $menuItem = MenuItem::first();

        $response = $this->postJson('/api/public/orders', [
            'table_id' => $table->id,
            'qr_token' => $table->qr_token,
            'order_type' => 'dine_in',
            'order_channel' => 'cashier_pos', // Attacker attempts to spoof cashier channel
            'customer_name' => 'Spoofed Cashier Attacker',
            'items' => [
                ['menu_item_id' => $menuItem->id, 'quantity' => 1]
            ]
        ]);

        $response->assertStatus(201);
        // Must be forced to qr_customer
        $this->assertEquals('qr_customer', $response->json('data.order_channel'));
    }

    /**
     * REMEDIATED: Privilege Escalation - Kitchen staff blocked from modifying menu items/prices
     */
    public function test_kitchen_staff_blocked_from_modifying_menu_prices(): void
    {
        $kitchenStaff = User::where('role', 'kitchen_staff')->whereNotNull('stall_id')->first();
        $this->assertNotNull($kitchenStaff);

        $stallMenuItem = MenuItem::where('stall_id', $kitchenStaff->stall_id)->first();
        $this->assertNotNull($stallMenuItem);

        // Kitchen staff attempts to modify price
        $response = $this->actingAs($kitchenStaff, 'sanctum')->putJson("/api/menu/{$stallMenuItem->id}", [
            'name' => 'Tampered Dish Name',
            'price' => 1.00,
        ]);

        $response->assertStatus(403);
    }

    /**
     * REMEDIATED: Authorization Bypass on Payment Settlement
     * Waiters and non-cashiers are strictly blocked from recording payments.
     */
    public function test_waiter_blocked_from_executing_payments(): void
    {
        $waiter = User::where('role', 'waiter')->first();
        $this->assertNotNull($waiter);

        $table = DiningTable::first();
        $menuItem = MenuItem::first();
        $order = Order::create([
            'table_id' => $table->id,
            'order_type' => 'dine_in',
            'order_channel' => 'waiter_app',
            'status' => 'confirmed',
            'subtotal' => 100,
            'tax_amount' => 5,
            'total_amount' => 105,
            'payment_status' => 'unpaid'
        ]);

        // Waiter attempts to process payment -> must be rejected with 403 Forbidden
        $response = $this->actingAs($waiter, 'sanctum')->postJson('/api/billing/pay', [
            'order_id' => $order->id,
            'payment_method' => 'cash',
            'amount' => $order->total_amount,
            'cash_tendered' => $order->total_amount,
        ]);

        $response->assertStatus(403);
    }

    /**
     * REMEDIATED: Idempotency Protection on Order Creation
     * Retrying with the same idempotency_key returns HTTP 200 with the existing order,
     * preventing duplicate orders, duplicate tickets, and duplicate billing.
     */
    public function test_idempotent_order_submission_prevents_duplicate_orders(): void
    {
        $table = DiningTable::first();
        $menuItem = MenuItem::first();
        $idempotencyKey = 'idem-test-' . uniqid();

        $payload = [
            'table_id' => $table->id,
            'qr_token' => $table->qr_token,
            'idempotency_key' => $idempotencyKey,
            'order_type' => 'dine_in',
            'order_channel' => 'qr_customer',
            'customer_name' => 'Idempotent Customer',
            'items' => [
                ['menu_item_id' => $menuItem->id, 'quantity' => 1]
            ]
        ];

        // First attempt creates order
        $res1 = $this->postJson('/api/public/orders', $payload);
        $res1->assertStatus(201);
        $orderNumber1 = $res1->json('data.order_number');

        // Second attempt (retry) returns existing order without creating duplicate
        $res2 = $this->postJson('/api/public/orders', $payload);
        $res2->assertStatus(200);
        $orderNumber2 = $res2->json('data.order_number');

        // Public responses use the sanitized view (no internal ids); compare by order number
        $this->assertNotNull($orderNumber1);
        $this->assertEquals($orderNumber1, $orderNumber2);
        $this->assertEquals(1, Order::where('idempotency_key', $idempotencyKey)->count());
        $this->assertStringContainsString('existing idempotency record', $res2->json('message'));
    }

    /**
     * REMEDIATED: Order Cancellation Authorization & Paid Order Protection
     */
    public function test_order_cancellation_restricted_and_blocks_paid_orders(): void
    {
        $cashier = User::where('role', 'cashier')->first();
        $waiter = User::where('role', 'waiter')->first();
        $table = DiningTable::first();
        $menuItem = MenuItem::first();

        // 1. Create unpaid order
        $order = Order::create([
            'table_id' => $table->id,
            'order_type' => 'dine_in',
            'order_channel' => 'cashier_pos',
            'status' => 'confirmed',
            'subtotal' => 100,
            'tax_amount' => 5,
            'total_amount' => 105,
            'payment_status' => 'unpaid'
        ]);

        // 2. Waiter cannot cancel (403)
        $waiterRes = $this->actingAs($waiter, 'sanctum')->postJson("/api/orders/{$order->id}/cancel", [
            'reason' => 'Waiter try'
        ]);
        $waiterRes->assertStatus(403);

        // 3. Cashier can cancel unpaid order
        $cashierRes = $this->actingAs($cashier, 'sanctum')->postJson("/api/orders/{$order->id}/cancel", [
            'reason' => 'Customer changed mind'
        ]);
        $cashierRes->assertStatus(200);

        // 4. Create paid order -> cannot be cancelled
        $paidOrder = Order::create([
            'table_id' => $table->id,
            'order_type' => 'dine_in',
            'order_channel' => 'cashier_pos',
            'status' => 'confirmed',
            'subtotal' => 100,
            'tax_amount' => 5,
            'total_amount' => 105,
            'payment_status' => 'paid'
        ]);

        $cancelPaidRes = $this->actingAs($cashier, 'sanctum')->postJson("/api/orders/{$paidOrder->id}/cancel", [
            'reason' => 'Refund test'
        ]);
        $cancelPaidRes->assertStatus(422);
    }

    /**
     * VERIFIED: Automated Audit Logging on Critical Operations
     */
    public function test_automated_audit_logs_record_lifecycle_events(): void
    {
        $cashier = User::where('role', 'cashier')->first();
        $owner = User::where('role', 'owner')->first();
        $menuItem = MenuItem::first();

        // Check if audit logs exist for order creation
        $orderLog = AuditLog::where('action', 'order_created')->first();
        $this->assertNotNull($orderLog, 'Audit log must record order creation');

        // Update menu price by owner
        $oldPrice = $menuItem->price;
        $newPrice = $oldPrice + 10.00;
        $this->actingAs($owner, 'sanctum')->putJson("/api/menu/{$menuItem->id}", [
            'price' => $newPrice,
        ]);

        // Verify audit log for menu price change
        $priceLog = AuditLog::where('action', 'menu_item_price_changed')
            ->where('entity_id', (string) $menuItem->id)
            ->latest('id')
            ->first();

        $this->assertNotNull($priceLog, 'Audit log must record menu price change');
    }
}
