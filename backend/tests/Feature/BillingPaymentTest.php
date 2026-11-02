<?php

namespace Tests\Feature;

use App\Models\DiningTable;
use App\Models\MenuItem;
use App\Models\Order;
use App\Models\User;
use Tests\TestCase;

class BillingPaymentTest extends TestCase
{
    public function test_cashier_can_settle_consolidated_bill_and_free_table(): void
    {
        $cashier = User::where('email', 'cashier@foodcourt.com')->first();
        $this->assertNotNull($cashier);

        $table = DiningTable::first();
        $item = MenuItem::first();

        // Create an order
        $orderResponse = $this->postJson('/api/public/orders', [
            'table_id' => $table->id,
            'qr_token' => $table->qr_token,
            'order_type' => 'dine_in',
            'order_channel' => 'qr_customer',
            'items' => [
                ['menu_item_id' => $item->id, 'quantity' => 2],
            ]
        ])->assertStatus(201);

        $orderId = Order::where('order_number', $orderResponse->json('data.order_number'))->value('id');
        $totalAmount = $orderResponse->json('data.total_amount');

        // Cashier records payment
        $paymentResponse = $this->actingAs($cashier)
            ->postJson('/api/billing/pay', [
                'order_id' => $orderId,
                'payment_method' => 'cash',
                'amount' => $totalAmount,
                'cash_tendered' => $totalAmount + 100, // customer gave extra cash
            ]);

        $paymentResponse->assertStatus(200);
        $paymentResponse->assertJsonPath('success', true);
        $this->assertEquals(100, $paymentResponse->json('data.change_returned'));

        $order = Order::find($orderId);
        $this->assertEquals('paid', $order->payment_status);
        $this->assertEquals('completed', $order->status);

        // Table must be freed and available again!
        $this->assertEquals('available', $table->fresh()->status);
    }
}

