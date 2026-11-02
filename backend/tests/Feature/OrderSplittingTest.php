<?php

namespace Tests\Feature;

use App\Models\DiningTable;
use App\Models\MenuItem;
use App\Models\Order;
use App\Models\Stall;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class OrderSplittingTest extends TestCase
{
    public function test_multi_stall_order_creates_parent_order_and_splits_into_stall_tickets(): void
    {
        // Fetch 2 items from Stall 1 and 1 item from Stall 2
        $stalls = Stall::with('menuItems')->take(2)->get();
        $this->assertCount(2, $stalls, "Seeder must provide at least 2 stalls");

        $stall1 = $stalls[0];
        $stall2 = $stalls[1];

        $stall1Item = $stall1->menuItems->first();
        $stall2Item = $stall2->menuItems->first();

        $table = DiningTable::first();

        $orderPayload = [
            'table_id' => $table->id,
            'order_type' => 'dine_in',
            'order_channel' => 'qr_customer',
            'customer_name' => 'Aditya Sharma',
            'customer_phone' => '+91 9988776655',
            'items' => [
                [
                    'menu_item_id' => $stall1Item->id,
                    'quantity' => 2,
                    'special_instructions' => 'Extra crispy',
                ],
                [
                    'menu_item_id' => $stall2Item->id,
                    'quantity' => 1,
                    'special_instructions' => 'Less spicy',
                ]
            ]
        ];

        $response = $this->postJson('/api/public/orders', $orderPayload);

        $response->assertStatus(201);
        $response->assertJsonPath('success', true);

        $orderId = $response->json('data.id');
        $order = Order::with(['kitchenTickets', 'items'])->find($orderId);

        $this->assertNotNull($order);
        $this->assertEquals(2, $order->items->count());

        // CRITICAL CHECK: Exactly 2 stall kitchen tickets must be created (1 for Stall 1, 1 for Stall 2)
        $this->assertEquals(2, $order->kitchenTickets->count());

        $ticketStallIds = $order->kitchenTickets->pluck('stall_id')->all();
        $this->assertContains($stall1->id, $ticketStallIds);
        $this->assertContains($stall2->id, $ticketStallIds);

        // Verify Authoritative Server-side Price Calculation
        $expectedSubtotal = bcmul((string)$stall1Item->price, '2', 2);
        $expectedSubtotal = bcadd($expectedSubtotal, (string)$stall2Item->price, 2);
        $expectedTax = bcmul($expectedSubtotal, '0.05', 2);
        $expectedTotal = bcadd($expectedSubtotal, $expectedTax, 2);

        $this->assertEquals($expectedSubtotal, $order->subtotal);
        $this->assertEquals($expectedTotal, $order->total_amount);

        // Verify Table is marked occupied
        $this->assertEquals('occupied', $table->fresh()->status);
    }
}

