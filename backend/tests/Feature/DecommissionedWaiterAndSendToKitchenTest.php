<?php

namespace Tests\Feature;

use App\Models\DiningTable;
use App\Models\MenuCategory;
use App\Models\MenuItem;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Stall;
use App\Models\StallKitchenTicket;
use App\Models\StallTicketItem;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DecommissionedWaiterAndSendToKitchenTest extends TestCase
{
    use RefreshDatabase;

    protected User $owner;
    protected User $cashier;
    protected Stall $stall;
    protected MenuCategory $category;
    protected MenuItem $menuItem1;
    protected MenuItem $menuItem2;
    protected DiningTable $table;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = User::create([
            'name' => 'Owner',
            'email' => 'owner@foodcourt.test',
            'password' => bcrypt('password'),
            'role' => 'owner',
            'is_active' => true,
        ]);

        $this->cashier = User::create([
            'name' => 'Cashier',
            'email' => 'cashier@foodcourt.test',
            'password' => bcrypt('password'),
            'role' => 'cashier',
            'is_active' => true,
        ]);

        $this->stall = Stall::create([
            'name' => 'Stall 1',
            'code' => 'ST1',
            'is_active' => true,
        ]);

        $this->category = MenuCategory::create([
            'stall_id' => $this->stall->id,
            'name' => 'Snacks',
        ]);

        $this->menuItem1 = MenuItem::create([
            'stall_id' => $this->stall->id,
            'category_id' => $this->category->id,
            'name' => 'Vadapav',
            'price' => 30.00,
            'is_available' => true,
        ]);

        $this->menuItem2 = MenuItem::create([
            'stall_id' => $this->stall->id,
            'category_id' => $this->category->id,
            'name' => 'Samosa',
            'price' => 25.00,
            'is_available' => true,
        ]);

        $this->table = DiningTable::create([
            'table_number' => '1',
            'section' => 'Main',
            'capacity' => 4,
            'is_active' => true,
        ]);
    }

    public function test_cashier_pos_normal_order_creation_generates_tickets()
    {
        $payload = [
            'order_type' => 'dine_in',
            'table_id' => $this->table->id,
            'order_channel' => 'cashier_pos',
            'customer_name' => 'Shubham',
            'customer_phone' => '9876543210',
            'items' => [
                [
                    'menu_item_id' => $this->menuItem1->id,
                    'quantity' => 2,
                ],
            ],
        ];

        $response = $this->actingAs($this->cashier, 'sanctum')->postJson('/api/orders', $payload);
        $response->assertStatus(201);
        $response->assertJsonPath('success', true);

        $orderId = $response->json('data.id');
        $this->assertNotNull($orderId);

        $order = Order::with('kitchenTickets.ticketItems')->find($orderId);
        $this->assertCount(1, $order->kitchenTickets);
        $this->assertEquals(60.00, (float) $order->subtotal);
        $this->assertEquals('unpaid', $order->payment_status);
    }

    public function test_order_tracking_quantity_increase_and_decrease()
    {
        $order = Order::create([
            'order_type' => 'dine_in',
            'table_id' => $this->table->id,
            'order_channel' => 'cashier_pos',
            'status' => 'confirmed',
            'payment_status' => 'pending',
            'subtotal' => 60.00,
            'tax_amount' => 3.00,
            'discount_amount' => 0.00,
            'total_amount' => 63.00,
        ]);

        $orderItem = OrderItem::create([
            'order_id' => $order->id,
            'stall_id' => $this->stall->id,
            'menu_item_id' => $this->menuItem1->id,
            'item_name' => $this->menuItem1->name,
            'quantity' => 2,
            'unit_price' => 30.00,
            'subtotal' => 60.00,
            'total_price' => 60.00,
            'status' => 'pending',
        ]);

        $ticket = StallKitchenTicket::create([
            'order_id' => $order->id,
            'stall_id' => $this->stall->id,
            'ticket_number' => 'KOT-1',
            'status' => 'pending',
        ]);

        $ticketItem = StallTicketItem::create([
            'ticket_id' => $ticket->id,
            'order_item_id' => $orderItem->id,
            'item_name' => $this->menuItem1->name,
            'quantity' => 2,
            'status' => 'pending',
        ]);

        // Increase quantity (+1)
        $incRes = $this->actingAs($this->cashier, 'sanctum')->patchJson("/api/ticket-items/{$ticketItem->id}/quantity", [
            'delta' => 1,
        ]);
        $incRes->assertStatus(200);
        $incRes->assertJsonPath('success', true);

        $this->assertEquals(3, $ticketItem->fresh()->quantity);
        $this->assertEquals(3, $orderItem->fresh()->quantity);
        $this->assertEquals(90.00, (float) $orderItem->fresh()->subtotal);

        // Decrease quantity (-1)
        $decRes = $this->actingAs($this->cashier, 'sanctum')->patchJson("/api/ticket-items/{$ticketItem->id}/quantity", [
            'delta' => -1,
        ]);
        $decRes->assertStatus(200);
        $decRes->assertJsonPath('success', true);

        $this->assertEquals(2, $ticketItem->fresh()->quantity);
        $this->assertEquals(2, $orderItem->fresh()->quantity);
    }

    public function test_add_item_to_order_inside_orders_tracking()
    {
        $order = Order::create([
            'order_type' => 'dine_in',
            'table_id' => $this->table->id,
            'order_channel' => 'cashier_pos',
            'status' => 'confirmed',
            'payment_status' => 'pending',
            'subtotal' => 0.00,
            'tax_amount' => 0.00,
            'discount_amount' => 0.00,
            'total_amount' => 0.00,
        ]);

        $ticket = StallKitchenTicket::create([
            'order_id' => $order->id,
            'stall_id' => $this->stall->id,
            'ticket_number' => 'KOT-2',
            'status' => 'pending',
        ]);

        // Add MenuItem2 (Samosa: 2 * 25.00 = 50.00)
        $res = $this->actingAs($this->cashier, 'sanctum')->postJson("/api/orders/{$order->id}/items", [
            'menu_item_id' => $this->menuItem2->id,
            'quantity' => 2,
            'special_instructions' => 'Extra spicy',
        ]);

        $res->assertStatus(200);
        $res->assertJsonPath('success', true);

        $freshOrder = $order->fresh(['items', 'kitchenTickets.ticketItems']);
        $this->assertCount(1, $freshOrder->items);
        $this->assertEquals(50.00, (float) $freshOrder->subtotal);
    }

    public function test_waiter_station_route_cannot_be_used_by_unauthorized_guests()
    {
        $res = $this->getJson('/api/waiter/ready-tickets');
        $res->assertStatus(401);
    }

    public function test_kitchen_display_route_is_completely_decommissioned()
    {
        $res = $this->actingAs($this->owner, 'sanctum')->getJson('/api/kitchen/tickets');
        $res->assertStatus(404);
    }
}
