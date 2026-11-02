<?php

namespace Tests\Feature;

use App\Models\DiningTable;
use App\Models\InventoryItem;
use App\Models\MenuItem;
use App\Models\Order;
use App\Models\PurchaseOrder;
use App\Models\Stall;
use App\Models\Supplier;
use App\Models\User;
use Tests\TestCase;

class PendingBillsAndPurchasesTest extends TestCase
{
    public function test_cashier_can_retrieve_pending_bills_and_receipts(): void
    {
        $cashier = User::where('role', 'cashier')->first();
        $this->assertNotNull($cashier);

        // Fetch pending bills
        $response = $this->actingAs($cashier, 'sanctum')->getJson('/api/billing/pending');
        $response->assertStatus(200);
        $response->assertJsonStructure([
            'success',
            'data' => [
                '*' => [
                    'id',
                    'order_number',
                    'total_amount',
                    'payment_status',
                    'order_channel',
                ]
            ]
        ]);

        // Non-cashier/non-owner should be denied
        $waiter = User::where('role', 'waiter')->first();
        $unauthResponse = $this->actingAs($waiter, 'sanctum')->getJson('/api/billing/pending');
        $unauthResponse->assertStatus(403);
    }

    public function test_stall_manager_can_create_and_receive_purchase_order(): void
    {
        $stall = Stall::first();
        $this->assertNotNull($stall);

        $manager = User::where('role', 'stall_manager')->where('stall_id', $stall->id)->first();
        if (!$manager) {
            $manager = User::create([
                'name' => 'Stall 1 Manager',
                'email' => 'mgr1@test.com',
                'password' => bcrypt('password'),
                'role' => 'stall_manager',
                'stall_id' => $stall->id,
            ]);
        }

        // 1. Create Supplier (stall_id auto-filled from authenticated stall manager)
        $supplierRes = $this->actingAs($manager, 'sanctum')->postJson('/api/suppliers', [
            'name' => 'Farm Fresh Ingredients Ltd',
            'contact_person' => 'Rajesh Sharma',
            'phone' => '9876543210',
            'email' => 'orders@farmfresh.test',
        ]);
        $supplierRes->assertStatus(201);
        $supplierId = $supplierRes->json('data.id');

        // 2. Ensure an inventory item exists
        $invItem = InventoryItem::firstOrCreate(
            ['stall_id' => $stall->id, 'name' => 'Fresh Paneer'],
            ['unit' => 'kg', 'current_stock' => 10, 'minimum_alert_stock' => 5, 'unit_cost' => 250]
        );
        $initialStock = (float) $invItem->current_stock;

        // 3. Create Purchase Order
        $poRes = $this->actingAs($manager, 'sanctum')->postJson('/api/purchases', [
            'stall_id' => $stall->id,
            'supplier_id' => $supplierId,
            'order_date' => now()->toDateString(),
            'notes' => 'Weekly dairy restocking',
            'items' => [
                [
                    'inventory_item_id' => $invItem->id,
                    'quantity' => 20,
                    'unit_price' => 250,
                ]
            ]
        ]);
        $poRes->assertStatus(201);
        $poId = $poRes->json('data.id');
        $this->assertEquals('ordered', $poRes->json('data.status'));

        // 4. Another stall manager cannot receive this PO
        $otherStall = Stall::where('id', '!=', $stall->id)->first();
        if ($otherStall) {
            $otherManager = User::where('role', 'stall_manager')->where('stall_id', $otherStall->id)->first();
            if ($otherManager) {
                $forbiddenRes = $this->actingAs($otherManager, 'sanctum')->postJson("/api/purchases/{$poId}/receive");
                $forbiddenRes->assertStatus(403);
            }
        }

        // 5. Authorized stall manager receives goods
        $receiveRes = $this->actingAs($manager, 'sanctum')->postJson("/api/purchases/{$poId}/receive");
        $receiveRes->assertStatus(200);

        // 6. Verify stock increased by 20
        $invItem->refresh();
        $this->assertEquals($initialStock + 20, (float) $invItem->current_stock);
    }
}
