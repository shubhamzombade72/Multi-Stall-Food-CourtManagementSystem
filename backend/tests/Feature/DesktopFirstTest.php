<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\InventoryItem;
use App\Models\MenuItem;
use App\Models\Stall;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Desktop-first backend additions: staff management, categories, product images, stock-out,
 * payment history, closing history and owner reports.
 */
class DesktopFirstTest extends TestCase
{
    use DatabaseTransactions;

    private function user(string $role, ?int $stallId = null): User
    {
        $q = User::where('role', $role)->where('is_active', true);
        if ($stallId) {
            $q->where('stall_id', $stallId);
        }
        return $q->firstOrFail();
    }

    private function stalls(): array
    {
        $s = Stall::orderBy('id')->take(2)->get();
        return [$s[0], $s[1]];
    }

    // ------------------------------------------------------------- staff management

    public function test_owner_creates_lists_and_updates_staff_with_audit(): void
    {
        [$stallA] = $this->stalls();
        $owner = $this->user('owner');

        $res = $this->actingAs($owner, 'sanctum')->postJson('/api/staff', [
            'name' => 'Desktop Test Chef',
            'email' => 'desktop.chef.' . uniqid() . '@foodcourt.com',
            'password' => 'StrongPass123',
            'role' => 'kitchen_staff',
            'stall_id' => $stallA->id,
        ]);
        $res->assertStatus(201)->assertJsonPath('data.role', 'kitchen_staff');
        $id = $res->json('data.id');
        $this->assertArrayNotHasKey('password', $res->json('data'));
        $this->assertTrue(Hash::check('StrongPass123', User::find($id)->password));
        $this->assertNotNull(AuditLog::where('action', 'staff_created')->where('entity_id', (string) $id)->first());

        $list = $this->actingAs($owner, 'sanctum')->getJson('/api/staff');
        $list->assertStatus(200);
        $this->assertTrue(collect($list->json('data'))->contains('id', $id));

        $this->actingAs($owner, 'sanctum')->putJson("/api/staff/{$id}", ['role' => 'stall_manager'])
            ->assertStatus(200)->assertJsonPath('data.role', 'stall_manager');
        $this->assertNotNull(AuditLog::where('action', 'staff_updated')->where('entity_id', (string) $id)->first());
    }

    public function test_staff_management_is_owner_only(): void
    {
        $cashier = $this->user('cashier');
        $manager = $this->user('stall_manager');
        foreach ([$cashier, $manager] as $u) {
            $this->actingAs($u, 'sanctum')->getJson('/api/staff')->assertStatus(403);
            $this->actingAs($u, 'sanctum')->postJson('/api/staff', [
                'name' => 'x', 'email' => 'x' . uniqid() . '@x.com', 'password' => 'StrongPass123', 'role' => 'owner',
            ])->assertStatus(403);
        }
    }

    public function test_stall_roles_require_a_stall_and_roles_are_validated(): void
    {
        $owner = $this->user('owner');
        $this->actingAs($owner, 'sanctum')->postJson('/api/staff', [
            'name' => 'No Stall Chef', 'email' => 'nostall' . uniqid() . '@foodcourt.com', 'password' => 'StrongPass123', 'role' => 'kitchen_staff',
        ])->assertStatus(422);
        $this->actingAs($owner, 'sanctum')->postJson('/api/staff', [
            'name' => 'Bad Role', 'email' => 'badrole' . uniqid() . '@foodcourt.com', 'password' => 'StrongPass123', 'role' => 'superuser',
        ])->assertStatus(422);
        $this->actingAs($owner, 'sanctum')->postJson('/api/staff', [
            'name' => 'Short', 'email' => 'short' . uniqid() . '@foodcourt.com', 'password' => 'short', 'role' => 'waiter',
        ])->assertStatus(422);
    }

    public function test_owner_cannot_lock_themselves_out(): void
    {
        $owner = $this->user('owner');
        $this->actingAs($owner, 'sanctum')->putJson("/api/staff/{$owner->id}", ['is_active' => false])->assertStatus(422);
        $this->actingAs($owner, 'sanctum')->putJson("/api/staff/{$owner->id}", ['role' => 'cashier'])->assertStatus(422);
        $this->assertTrue((bool) $owner->fresh()->is_active);
    }

    public function test_deactivation_and_password_reset_revoke_tokens(): void
    {
        $owner = $this->user('owner');
        $waiter = $this->user('waiter');
        $waiter->createToken('device');
        $this->actingAs($owner, 'sanctum')->putJson("/api/staff/{$waiter->id}", ['is_active' => false])->assertStatus(200);
        $this->assertSame(0, $waiter->tokens()->count());

        $cashier = $this->user('cashier');
        $cashier->createToken('pos');
        $this->actingAs($owner, 'sanctum')->postJson("/api/staff/{$cashier->id}/reset-password", [
            'password' => 'NewSecret456', 'password_confirmation' => 'NewSecret456',
        ])->assertStatus(200);
        $this->assertSame(0, $cashier->tokens()->count());
        $this->assertTrue(Hash::check('NewSecret456', $cashier->fresh()->password));
        $this->actingAs($owner, 'sanctum')->postJson("/api/staff/{$cashier->id}/reset-password", [
            'password' => 'NewSecret456', 'password_confirmation' => 'Mismatch999',
        ])->assertStatus(422);
    }

    // ------------------------------------------------------------- categories & images

    public function test_categories_respect_stall_ownership(): void
    {
        [$stallA, $stallB] = $this->stalls();
        $manager = $this->user('stall_manager', $stallA->id);
        $this->actingAs($manager, 'sanctum')->postJson('/api/menu-categories', ['stall_id' => $stallA->id, 'name' => 'Desserts'])
            ->assertStatus(201);
        $this->actingAs($manager, 'sanctum')->postJson('/api/menu-categories', ['stall_id' => $stallB->id, 'name' => 'Hijack'])
            ->assertStatus(403);
        $kitchen = $this->user('kitchen_staff', $stallA->id);
        $this->actingAs($kitchen, 'sanctum')->postJson('/api/menu-categories', ['stall_id' => $stallA->id, 'name' => 'Nope'])
            ->assertStatus(403);
    }

    public function test_menu_item_category_must_belong_to_its_stall(): void
    {
        [$stallA, $stallB] = $this->stalls();
        $owner = $this->user('owner');
        $foreignCategory = \App\Models\MenuCategory::where('stall_id', $stallB->id)->firstOrFail();
        $ownCategory = \App\Models\MenuCategory::where('stall_id', $stallA->id)->firstOrFail();

        $this->actingAs($owner, 'sanctum')->postJson('/api/menu', [
            'stall_id' => $stallA->id, 'category_id' => $foreignCategory->id, 'name' => 'Mismatch', 'price' => 10,
        ])->assertStatus(422);

        $item = MenuItem::where('stall_id', $stallA->id)->firstOrFail();
        $this->actingAs($owner, 'sanctum')->putJson("/api/menu/{$item->id}", ['category_id' => $foreignCategory->id])->assertStatus(422);
        $this->actingAs($owner, 'sanctum')->putJson("/api/menu/{$item->id}", ['category_id' => $ownCategory->id])->assertStatus(200);
    }

    public function test_inactive_stalls_listed_only_for_owner_request(): void
    {
        $owner = $this->user('owner');
        $cashier = $this->user('cashier');
        $stall = Stall::orderBy('id')->firstOrFail();
        $stall->update(['is_active' => false]);

        $ownerIds = collect($this->actingAs($owner, 'sanctum')->getJson('/api/stalls?include_inactive=1')->json('data'))->pluck('id');
        $cashierIds = collect($this->actingAs($cashier, 'sanctum')->getJson('/api/stalls?include_inactive=1')->json('data'))->pluck('id');
        $publicIds = collect($this->getJson('/api/public/stalls?include_inactive=1')->json('data'))->pluck('id');

        $this->assertTrue($ownerIds->contains($stall->id));
        $this->assertFalse($cashierIds->contains($stall->id));
        $this->assertFalse($publicIds->contains($stall->id));
    }

    public function test_menu_image_upload_validates_type_and_ownership(): void
    {
        Storage::fake('local');
        [$stallA, $stallB] = $this->stalls();
        $manager = $this->user('stall_manager', $stallA->id);
        $own = MenuItem::where('stall_id', $stallA->id)->firstOrFail();
        $foreign = MenuItem::where('stall_id', $stallB->id)->firstOrFail();

        $ok = $this->actingAs($manager, 'sanctum')->post("/api/menu/{$own->id}/image", ['image' => UploadedFile::fake()->image('dish.png', 400, 300)], ['Accept' => 'application/json']);
        $ok->assertStatus(200);
        $url = $ok->json('data.image_url');
        $this->assertMatchesRegularExpression('#/api/public/menu-images/[A-Za-z0-9]{32}\.png$#', $url);
        Storage::disk('local')->assertExists('menu-images/' . basename($url));
        $this->get('/api/public/menu-images/' . basename($url))->assertStatus(200);

        $this->actingAs($manager, 'sanctum')->post("/api/menu/{$own->id}/image", ['image' => UploadedFile::fake()->create('evil.php', 10, 'application/x-php')], ['Accept' => 'application/json'])
            ->assertStatus(422);
        $this->actingAs($manager, 'sanctum')->post("/api/menu/{$foreign->id}/image", ['image' => UploadedFile::fake()->image('x.png')], ['Accept' => 'application/json'])
            ->assertStatus(403);
        $this->get('/api/public/menu-images/..%2F..%2F.env')->assertStatus(404);
        $this->get('/api/public/menu-images/notarealfile.png')->assertStatus(404);
    }

    // ------------------------------------------------------------- stock out

    public function test_stock_out_decrements_with_ledger_and_never_goes_negative(): void
    {
        [$stallA, $stallB] = $this->stalls();
        $manager = $this->user('stall_manager', $stallA->id);
        $item = InventoryItem::where('stall_id', $stallA->id)->firstOrFail();
        $before = (string) $item->current_stock;

        $this->actingAs($manager, 'sanctum')->postJson("/api/inventory/{$item->id}/stock-out", [
            'quantity' => 1.5, 'movement_type' => 'consumption', 'reason' => 'Issued to kitchen',
        ])->assertStatus(200);
        $this->assertSame(bcsub($before, '1.5', 3), bcadd((string) $item->fresh()->current_stock, '0', 3));
        $this->assertDatabaseHas('stock_movements', ['inventory_item_id' => $item->id, 'movement_type' => 'consumption', 'quantity' => '-1.500']);

        $this->actingAs($manager, 'sanctum')->postJson("/api/inventory/{$item->id}/stock-out", [
            'quantity' => 999999, 'movement_type' => 'waste_loss', 'reason' => 'too much',
        ])->assertStatus(422);

        $foreign = InventoryItem::where('stall_id', $stallB->id)->firstOrFail();
        $this->actingAs($manager, 'sanctum')->postJson("/api/inventory/{$foreign->id}/stock-out", [
            'quantity' => 1, 'movement_type' => 'consumption', 'reason' => 'x',
        ])->assertStatus(403);
    }

    // ------------------------------------------------------------- history & reports

    public function test_history_and_report_endpoints_enforce_roles(): void
    {
        $owner = $this->user('owner');
        $cashier = $this->user('cashier');
        [$stallA] = $this->stalls();
        $kitchen = $this->user('kitchen_staff', $stallA->id);

        $this->actingAs($cashier, 'sanctum')->getJson('/api/billing/payments')->assertStatus(200);
        $this->actingAs($kitchen, 'sanctum')->getJson('/api/billing/payments')->assertStatus(403);

        $this->actingAs($owner, 'sanctum')->getJson('/api/settlements/closings')->assertStatus(200);
        $this->actingAs($cashier, 'sanctum')->getJson('/api/settlements/closings')->assertStatus(403);

        foreach (['/api/reports/cashier-activity', '/api/reports/menu-performance'] as $url) {
            $this->actingAs($owner, 'sanctum')->getJson($url)->assertStatus(200);
            $this->actingAs($cashier, 'sanctum')->getJson($url)->assertStatus(403);
            $this->actingAs($kitchen, 'sanctum')->getJson($url)->assertStatus(403);
        }

        $dash = $this->actingAs($owner, 'sanctum')->getJson('/api/reports/dashboard');
        $dash->assertStatus(200)->assertJsonStructure(['data' => [
            'pending_bills' => ['count', 'amount'], 'low_stock_items', 'payment_methods_today', 'staff_by_role', 'recent_activity', 'closing_today',
        ]]);
    }
}
