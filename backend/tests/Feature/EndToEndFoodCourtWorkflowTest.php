<?php

namespace Tests\Feature;

use App\Models\DailyClosing;
use App\Models\DiningTable;
use App\Models\Order;
use App\Models\Stall;
use App\Models\User;
use Tests\TestCase;

class EndToEndFoodCourtWorkflowTest extends TestCase
{
    public function test_complete_food_court_multi_stall_lifecycle(): void
    {
        // 1. Setup participants from seeded database
        $stalls = Stall::with('menuItems')->take(2)->get();
        $this->assertCount(2, $stalls);

        $stall1 = $stalls[0];
        $stall2 = $stalls[1];

        $stall1Item = $stall1->menuItems->first();
        $stall2Item = $stall2->menuItems->first();

        $table = DiningTable::first();

        $kitchenUser1 = User::where('role', 'kitchen_staff')->where('stall_id', $stall1->id)->first();
        $kitchenUser2 = User::where('role', 'kitchen_staff')->where('stall_id', $stall2->id)->first();
        $waiter = User::where('role', 'waiter')->first();
        $cashier = User::where('role', 'cashier')->first();
        $owner = User::where('role', 'owner')->first();

        $this->assertNotNull($kitchenUser1, "Kitchen user 1 must exist");
        $this->assertNotNull($kitchenUser2, "Kitchen user 2 must exist");
        $this->assertNotNull($waiter, "Waiter must exist");
        $this->assertNotNull($cashier, "Cashier must exist");
        $this->assertNotNull($owner, "Owner must exist");

        // -------------------------------------------------------------
        // STEP 1: Customer Scans QR Code & Places Multi-Stall Order
        // -------------------------------------------------------------
        $orderPayload = [
            'table_id' => $table->id,
            'qr_token' => $table->qr_token,
            'order_type' => 'dine_in',
            'order_channel' => 'qr_customer',
            'customer_name' => 'Vikram Malhotra',
            'customer_phone' => '+91 9123456780',
            'items' => [
                [
                    'menu_item_id' => $stall1Item->id,
                    'quantity' => 2,
                    'special_instructions' => 'Extra spicy',
                ],
                [
                    'menu_item_id' => $stall2Item->id,
                    'quantity' => 1,
                    'special_instructions' => 'No onions',
                ]
            ]
        ];

        $orderResponse = $this->postJson('/api/public/orders', $orderPayload);
        $orderResponse->assertStatus(201);
        $orderId = Order::where('order_number', $orderResponse->json('data.order_number'))->value('id');
        $this->assertNotNull($orderId);

        $order = Order::with(['kitchenTickets'])->find($orderId);
        $this->assertEquals(2, $order->kitchenTickets->count(), "Must split into exactly 2 stall tickets");

        $ticket1 = $order->kitchenTickets->where('stall_id', $stall1->id)->first();
        $ticket2 = $order->kitchenTickets->where('stall_id', $stall2->id)->first();
        $this->assertNotNull($ticket1);
        $this->assertNotNull($ticket2);

        // -------------------------------------------------------------
        // STEP 2: Strict Kitchen Stall Isolation Check
        // -------------------------------------------------------------
        // Kitchen 1 sees only Stall 1's tickets
        $k1Response = $this->actingAs($kitchenUser1, 'sanctum')->getJson('/api/kitchen/tickets');
        $k1Response->assertStatus(200);
        $k1TicketIds = collect($k1Response->json('data'))->pluck('id')->all();
        $this->assertContains($ticket1->id, $k1TicketIds);
        $this->assertNotContains($ticket2->id, $k1TicketIds, "Kitchen 1 must NEVER see Stall 2 tickets");

        // Kitchen 2 sees only Stall 2's tickets
        $k2Response = $this->actingAs($kitchenUser2, 'sanctum')->getJson('/api/kitchen/tickets');
        $k2Response->assertStatus(200);
        $k2TicketIds = collect($k2Response->json('data'))->pluck('id')->all();
        $this->assertContains($ticket2->id, $k2TicketIds);
        $this->assertNotContains($ticket1->id, $k2TicketIds, "Kitchen 2 must NEVER see Stall 1 tickets");

        // -------------------------------------------------------------
        // STEP 3: Kitchen 1 Starts Prep & Marks Items Ready
        // -------------------------------------------------------------
        $this->actingAs($kitchenUser1, 'sanctum')
            ->putJson("/api/kitchen/tickets/{$ticket1->id}/status", ['status' => 'preparing'])
            ->assertStatus(200);

        $this->actingAs($kitchenUser1, 'sanctum')
            ->putJson("/api/kitchen/tickets/{$ticket1->id}/status", ['status' => 'ready'])
            ->assertStatus(200);

        // Verify Partial Readiness: Order MUST NOT be fully ready because Stall 2 is still preparing!
        $order->refresh();
        $this->assertEquals('partially_ready', $order->status, "Multi-stall order must be partially_ready when only one stall completes");

        // -------------------------------------------------------------
        // STEP 4: Kitchen 2 Marks Items Ready -> Full Order Readiness
        // -------------------------------------------------------------
        $this->actingAs($kitchenUser2, 'sanctum')
            ->putJson("/api/kitchen/tickets/{$ticket2->id}/status", ['status' => 'ready'])
            ->assertStatus(200);

        $order->refresh();
        $this->assertEquals('ready', $order->status, "Order must be 'ready' once all stall tickets are marked ready");

        // -------------------------------------------------------------
        // STEP 5: Waiter Checks Ready Items & Serves to Table
        // -------------------------------------------------------------
        $waiterReadyRes = $this->actingAs($waiter, 'sanctum')->getJson('/api/waiter/ready-tickets');
        $waiterReadyRes->assertStatus(200);
        $readyTicketIds = collect($waiterReadyRes->json('data'))->pluck('id')->all();
        $this->assertContains($ticket1->id, $readyTicketIds);
        $this->assertContains($ticket2->id, $readyTicketIds);

        // Waiter serves ticket 1 and ticket 2
        $this->actingAs($waiter, 'sanctum')
            ->postJson("/api/waiter/tickets/{$ticket1->id}/served")
            ->assertStatus(200);

        $this->actingAs($waiter, 'sanctum')
            ->postJson("/api/waiter/tickets/{$ticket2->id}/served")
            ->assertStatus(200);

        $order->refresh();
        $this->assertEquals('served', $order->status, "Order must be 'served' after all tickets are served");

        // -------------------------------------------------------------
        // STEP 6: Cashier Consolidated Billing and Payment Collection
        // -------------------------------------------------------------
        $receiptRes = $this->actingAs($cashier, 'sanctum')->getJson("/api/billing/receipt/{$order->id}");
        $receiptRes->assertStatus(200);
        $totalAmount = (float)$receiptRes->json('data.order.total_amount');
        $this->assertGreaterThan(0, $totalAmount);

        // Cash payment with change calculation
        $tenderedAmount = (float) bcadd((string)$totalAmount, '100', 2);
        $paymentRes = $this->actingAs($cashier, 'sanctum')->postJson('/api/billing/pay', [
            'order_id' => $order->id,
            'payment_method' => 'cash',
            'amount' => $totalAmount,
            'cash_tendered' => $tenderedAmount,
        ]);

        $paymentRes->assertStatus(200);
        $paymentRes->assertJsonPath('success', true);
        $paymentData = $paymentRes->json('data.payment');

        $this->assertEquals('success', $paymentData['status']);
        $this->assertEquals('100.00', $paymentData['change_returned']);

        $order->refresh();
        $this->assertEquals('completed', $order->status);
        $this->assertEquals('paid', $order->payment_status);

        // -------------------------------------------------------------
        // STEP 7: Daily Closing and Stall Settlement Calculation
        // -------------------------------------------------------------
        $summaryRes = $this->actingAs($owner, 'sanctum')->getJson('/api/settlements/daily-summary');
        $summaryRes->assertStatus(200);
        $summaryRes->assertJsonPath('success', true);

        $closeDate = now()->addDays(rand(600, 1500))->toDateString();
        DailyClosing::where('closing_date', $closeDate)->delete();

        $closingRes = $this->actingAs($owner, 'sanctum')->postJson('/api/settlements/close-day', [
            'date' => $closeDate,
            'notes' => 'End of day settlement verified in full e2e lifecycle test',
        ]);

        $closingRes->assertStatus(201);
        $closingRes->assertJsonPath('success', true);
        $this->assertNotNull($closingRes->json('data.id'));
    }
}
