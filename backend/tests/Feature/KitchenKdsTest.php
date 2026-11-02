<?php

namespace Tests\Feature;

use App\Models\MenuItem;
use App\Models\Stall;
use App\Models\User;
use Tests\TestCase;

class KitchenKdsTest extends TestCase
{
    public function test_kitchen_staff_only_sees_their_own_stall_tickets(): void
    {
        $pizzaKitchenUser = User::where('email', 'kitchen.pizza@foodcourt.com')->first();
        $burgerKitchenUser = User::where('email', 'kitchen.burger@foodcourt.com')->first();

        $this->assertNotNull($pizzaKitchenUser);
        $this->assertNotNull($burgerKitchenUser);

        // Place an order containing items from both stalls
        $pizzaItem = MenuItem::where('stall_id', $pizzaKitchenUser->stall_id)->first();
        $burgerItem = MenuItem::where('stall_id', $burgerKitchenUser->stall_id)->first();

        $this->postJson('/api/public/orders', [
            'order_type' => 'takeaway',
            'order_channel' => 'qr_customer',
            'items' => [
                ['menu_item_id' => $pizzaItem->id, 'quantity' => 1],
                ['menu_item_id' => $burgerItem->id, 'quantity' => 1],
            ]
        ])->assertStatus(201);

        // Authenticate as Pizza Kitchen Staff
        $response = $this->actingAs($pizzaKitchenUser)
            ->getJson('/api/kitchen/tickets');

        $response->assertStatus(200);
        $tickets = $response->json('data');

        // Every ticket returned MUST belong to Pizza Stall!
        foreach ($tickets as $t) {
            $this->assertEquals($pizzaKitchenUser->stall_id, $t['stall_id'], "Kitchen staff saw a ticket from another stall!");
        }
    }
}

