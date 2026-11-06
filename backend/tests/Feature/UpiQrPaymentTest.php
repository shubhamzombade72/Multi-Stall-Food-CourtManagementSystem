<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\MenuItem;
use App\Models\Order;
use App\Models\Payment;
use App\Models\Setting;
use App\Models\UpiPaymentRequest;
use App\Models\User;
use App\Services\UpiPaymentService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\TestCase;

/**
 * Dynamic UPI QR: settings (owner only), per-bill UPI payment URI, and cashier-verified confirmation.
 * There is no payment gateway, so a QR is only a payment REQUEST: an order is paid only through the
 * existing /billing/pay endpoint after the cashier verifies the money and records the bank reference.
 */
class UpiQrPaymentTest extends TestCase
{
    use DatabaseTransactions;

    private const VPA = 'mangalmurti@upi';

    private function user(string $role): User
    {
        return User::where('role', $role)->where('is_active', true)->firstOrFail();
    }

    /** A staff member who must not be able to touch payment configuration or take payments. */
    private function kitchenUser(): User
    {
        return User::where('role', 'kitchen_staff')->first() ?? User::factory()->create(['role' => 'kitchen_staff', 'is_active' => true]);
    }

    private function configureUpi(string $vpa = self::VPA, bool $enabled = true): void
    {
        Setting::updateOrCreate(['key' => 'payment_methods'], ['value' => ['enabled' => ['cash', 'upi_qr', 'card']]]);
        Setting::updateOrCreate(['key' => 'business_profile'], ['value' => ['name' => 'MangalMurti Food Court']]);
        Setting::updateOrCreate(['key' => 'upi'], ['value' => ['enabled' => $enabled, 'vpa' => $vpa]]);
    }

    private function makeOrder(float $total, string $status = 'confirmed'): Order
    {
        $order = Order::create([
            'order_type' => 'takeaway',
            'order_channel' => 'cashier_pos',
            'status' => $status,
            'subtotal' => $total,
            'tax_amount' => 0,
            'discount_amount' => 0,
            'total_amount' => $total,
            'payment_status' => 'unpaid',
            'idempotency_key' => 'upi-test-' . uniqid('', true),
        ]);
        $menu = MenuItem::firstOrFail();
        $order->items()->create([
            'stall_id' => $menu->stall_id, 'menu_item_id' => $menu->id, 'item_name' => $menu->name,
            'unit_price' => $total, 'quantity' => 1, 'subtotal' => $total, 'status' => 'served',
        ]);

        return $order;
    }

    private function qr(Order $order, ?User $as = null)
    {
        return $this->actingAs($as ?? $this->user('cashier'), 'sanctum')->postJson("/api/billing/orders/{$order->id}/upi-request");
    }

    private function pay(Order $order, array $extra = [], ?string $method = 'upi_qr', ?User $as = null)
    {
        return $this->actingAs($as ?? $this->user('cashier'), 'sanctum')->postJson('/api/billing/pay', array_merge([
            'order_id' => $order->id,
            'payment_method' => $method,
            'amount' => (string) $order->total_amount,
        ], $extra));
    }

    // ---------- Settings ----------

    public function test_owner_can_save_upi_settings_and_cashier_can_read_but_not_change_them(): void
    {
        $this->configureUpi('old@upi', false);

        $this->actingAs($this->user('owner'), 'sanctum')
            ->putJson('/api/settings/upi', ['enabled' => true, 'vpa' => 'Shop.Name-1@okhdfcbank'])
            ->assertOk()
            ->assertJsonPath('data.vpa', 'shop.name-1@okhdfcbank')
            ->assertJsonPath('data.enabled', true);

        $read = $this->actingAs($this->user('cashier'), 'sanctum')->getJson('/api/settings')->assertOk();
        $read->assertJsonPath('data.upi.enabled', true)->assertJsonPath('data.upi.vpa', 'shop.name-1@okhdfcbank');

        $this->actingAs($this->user('cashier'), 'sanctum')
            ->putJson('/api/settings/upi', ['enabled' => true, 'vpa' => 'evil@upi'])->assertStatus(403);
        $this->actingAs($this->kitchenUser(), 'sanctum')
            ->putJson('/api/settings/upi', ['enabled' => false, 'vpa' => null])->assertStatus(403);
        $this->assertSame('shop.name-1@okhdfcbank', Setting::getValue('upi')['vpa']);
    }

    public function test_upi_setting_change_is_audited(): void
    {
        $this->configureUpi('old@upi', false);
        $this->actingAs($this->user('owner'), 'sanctum')->putJson('/api/settings/upi', ['enabled' => true, 'vpa' => 'new@upi'])->assertOk();

        $log = AuditLog::where('action', 'settings_updated')->where('entity_id', 'upi')->latest('id')->first();
        $this->assertNotNull($log);
        $this->assertSame('old@upi', $log->old_values['vpa']);
        $this->assertSame('new@upi', $log->new_values['vpa']);
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('invalidVpas')]
    public function test_invalid_upi_ids_are_rejected_by_the_backend(string $vpa): void
    {
        $this->configureUpi();
        $this->actingAs($this->user('owner'), 'sanctum')
            ->putJson('/api/settings/upi', ['enabled' => true, 'vpa' => $vpa])->assertStatus(422)->assertJsonValidationErrors('vpa');
        $this->assertSame(self::VPA, Setting::getValue('upi')['vpa']);
    }

    public static function invalidVpas(): array
    {
        return [
            'no handle' => ['mangalmurti'],
            'no name' => ['@upi'],
            'spaces' => ['man gal@upi'],
            'param injection' => ['a@upi&am=1'],
            'query chars' => ['a@upi?x=1'],
            'two ats' => ['a@b@upi'],
            'scheme' => ['upi://pay?pa=x@y'],
            'too long' => [str_repeat('a', 300) . '@upi'],
        ];
    }

    public function test_enabling_upi_requires_a_upi_id_and_the_upi_payment_method(): void
    {
        $this->configureUpi('', false);
        $owner = $this->user('owner');
        $this->actingAs($owner, 'sanctum')->putJson('/api/settings/upi', ['enabled' => true, 'vpa' => null])
            ->assertStatus(422)->assertJsonValidationErrors('vpa');

        $this->actingAs($owner, 'sanctum')->putJson('/api/settings/upi', ['enabled' => false, 'vpa' => null])->assertOk();

        Setting::updateOrCreate(['key' => 'payment_methods'], ['value' => ['enabled' => ['cash']]]);
        $this->actingAs($owner, 'sanctum')->putJson('/api/settings/upi', ['enabled' => true, 'vpa' => self::VPA])
            ->assertStatus(422)->assertJsonValidationErrors('enabled');
    }

    // ---------- URI generation ----------

    public function test_uri_uses_standard_upi_intent_format_with_encoded_values(): void
    {
        $uri = UpiPaymentService::buildUri('mangalmurti@upi', 'MangalMurti Food Court', '200.00', 'ORD-20261104-ABCDE');
        $this->assertSame('upi://pay?pa=mangalmurti@upi&pn=MangalMurti%20Food%20Court&am=200.00&cu=INR&tn=ORD-20261104-ABCDE', $uri);
    }

    public function test_uri_cannot_be_injected_through_the_business_name_or_reference(): void
    {
        $uri = UpiPaymentService::buildUri('a@upi', "Evil&pa=thief@upi&am=1 #\n\"x\"", '200.00', 'R&am=1');
        parse_str(substr($uri, strlen('upi://pay?')), $q);
        $this->assertSame(['pa', 'pn', 'am', 'cu', 'tn'], array_keys($q));
        $this->assertSame('a@upi', $q['pa']);
        $this->assertSame('200.00', $q['am']);
        $this->assertSame('R&am=1', $q['tn']);
        $this->assertStringNotContainsString("\n", $uri);
        $this->assertSame(1, substr_count($uri, '&am='));
    }

    // ---------- QR request endpoint ----------

    public function test_rupees_200_and_500_bills_generate_qr_with_the_exact_amount_and_configured_upi_id(): void
    {
        $this->configureUpi();
        foreach (['200.00', '500.00'] as $total) {
            $order = $this->makeOrder((float) $total);
            $res = $this->qr($order)->assertOk()->assertJsonPath('success', true);
            $uri = $res->json('data.upi_uri');
            parse_str(parse_url($uri, PHP_URL_QUERY), $q);
            $this->assertStringStartsWith('upi://pay?', $uri);
            $this->assertSame(self::VPA, $q['pa']);
            $this->assertSame($total, $q['am']);
            $this->assertSame('INR', $q['cu']);
            $this->assertSame('MangalMurti Food Court', $q['pn']);
            $this->assertSame($order->order_number, $q['tn']);
            $this->assertSame($total, $res->json('data.amount'));
        }
    }

    public function test_every_order_gets_a_distinct_reference_and_a_repeat_request_reuses_it(): void
    {
        $this->configureUpi();
        $a = $this->makeOrder(200);
        $b = $this->makeOrder(200);
        $refA = $this->qr($a)->assertOk()->json('data.reference');
        $refB = $this->qr($b)->assertOk()->json('data.reference');
        $this->assertNotSame($refA, $refB);
        $this->assertSame($refA, $this->qr($a)->json('data.reference'));
        $this->assertSame(1, UpiPaymentRequest::where('order_id', $a->id)->count());
    }

    public function test_changing_the_upi_id_affects_new_qr_codes_and_invalidates_the_old_one(): void
    {
        $this->configureUpi('first@upi');
        $order = $this->makeOrder(200);
        $old = $this->qr($order)->json('data');

        $this->actingAs($this->user('owner'), 'sanctum')->putJson('/api/settings/upi', ['enabled' => true, 'vpa' => 'second@upi'])->assertOk();
        $new = $this->qr($order)->json('data');

        $this->assertStringContainsString('pa=second@upi', $new['upi_uri']);
        $this->assertNotSame($old['reference'], $new['reference']);
        $this->assertSame('superseded', UpiPaymentRequest::where('reference', $old['reference'])->value('status'));
    }

    public function test_no_qr_when_upi_is_disabled_or_not_configured(): void
    {
        $order = $this->makeOrder(200);
        $this->configureUpi(self::VPA, false);
        $this->qr($order)->assertStatus(422)->assertJsonPath('message', 'UPI QR payments are turned off. The owner can enable them in Food Court Settings.');

        Setting::updateOrCreate(['key' => 'upi'], ['value' => ['enabled' => true, 'vpa' => null]]);
        $this->qr($order)->assertStatus(422)->assertJsonPath('message', 'UPI ID is not configured. The owner must add it in Food Court Settings.');
        $this->assertSame(0, UpiPaymentRequest::where('order_id', $order->id)->count());
    }

    public function test_qr_is_refused_for_cancelled_paid_or_unauthorised_requests(): void
    {
        $this->configureUpi();
        $this->qr($this->makeOrder(200, 'cancelled'))->assertStatus(422);

        $paid = $this->makeOrder(200);
        $paid->update(['payment_status' => 'paid']);
        $this->qr($paid)->assertStatus(422);

        $this->qr($this->makeOrder(200), $this->kitchenUser())->assertStatus(403);
    }

    // ---------- Payment verification ----------

    public function test_cashier_verified_upi_payment_marks_the_order_paid_and_closes_the_request(): void
    {
        $this->configureUpi();
        $order = $this->makeOrder(200);
        $ref = $this->qr($order)->json('data.reference');
        $this->assertSame('unpaid', $order->fresh()->payment_status, 'generating a QR never marks an order paid');

        $this->pay($order, ['upi_reference' => $ref, 'transaction_reference' => '412345678901', 'payment_verified' => true])
            ->assertOk()->assertJsonPath('data.payment.transaction_reference', '412345678901');

        $this->assertSame('paid', $order->fresh()->payment_status);
        $request = UpiPaymentRequest::where('reference', $ref)->first();
        $this->assertSame('paid', $request->status);
        $this->assertNotNull($request->payment_id);
        $this->assertNotNull(AuditLog::where('action', 'upi_payment_confirmed')->where('entity_id', (string) $request->id)->first());
    }

    public function test_upi_payment_is_refused_until_the_cashier_confirms_verification(): void
    {
        $this->configureUpi();
        $order = $this->makeOrder(200);
        $ref = $this->qr($order)->json('data.reference');

        $this->pay($order, ['upi_reference' => $ref, 'transaction_reference' => '412345678901'])->assertStatus(422)->assertJsonValidationErrors('payment_verified');
        // The bank reference is optional, but a malformed one is still refused
        $this->pay($order, ['upi_reference' => $ref, 'transaction_reference' => 'ab', 'payment_verified' => true])->assertStatus(422)->assertJsonValidationErrors('transaction_reference');
        $this->pay($order, ['transaction_reference' => '412345678901', 'payment_verified' => true])->assertStatus(422)->assertJsonValidationErrors('upi_reference');
        $this->assertSame('unpaid', $order->fresh()->payment_status);
        $this->assertSame(0, Payment::where('order_id', $order->id)->count());
    }

    public function test_upi_payment_can_be_settled_without_a_bank_reference_once_verified(): void
    {
        $this->configureUpi();
        $order = $this->makeOrder(200);
        $ref = $this->qr($order)->json('data.reference');

        $this->pay($order, ['upi_reference' => $ref, 'payment_verified' => true])
            ->assertOk()->assertJsonPath('data.payment.transaction_reference', null);
        $this->assertSame('paid', $order->fresh()->payment_status);
        $this->assertSame('paid', UpiPaymentRequest::where('reference', $ref)->first()->status);
    }

    public function test_wrong_amount_or_another_orders_reference_cannot_mark_an_order_paid(): void
    {
        $this->configureUpi();
        $order = $this->makeOrder(200);
        $other = $this->makeOrder(200);
        $ref = $this->qr($order)->json('data.reference');
        $otherRef = $this->qr($other)->json('data.reference');

        $this->pay($order, ['amount' => '199.00', 'upi_reference' => $ref, 'transaction_reference' => '412345678901', 'payment_verified' => true])->assertStatus(422);
        $this->pay($order, ['upi_reference' => $otherRef, 'transaction_reference' => '412345678901', 'payment_verified' => true])->assertStatus(422);
        $this->pay($order, ['upi_reference' => 'ORD-DOES-NOT-EXIST', 'transaction_reference' => '412345678901', 'payment_verified' => true])->assertStatus(422);
        $this->assertSame('unpaid', $order->fresh()->payment_status);
    }

    public function test_a_qr_from_before_a_upi_id_change_cannot_confirm_payment(): void
    {
        $this->configureUpi('first@upi');
        $order = $this->makeOrder(200);
        $oldRef = $this->qr($order)->json('data.reference');
        $this->actingAs($this->user('owner'), 'sanctum')->putJson('/api/settings/upi', ['enabled' => true, 'vpa' => 'second@upi'])->assertOk();

        $this->pay($order, ['upi_reference' => $oldRef, 'transaction_reference' => '412345678901', 'payment_verified' => true])->assertStatus(422);
        $this->assertSame('unpaid', $order->fresh()->payment_status);
    }

    public function test_duplicate_confirmation_cannot_create_a_second_payment(): void
    {
        $this->configureUpi();
        $order = $this->makeOrder(200);
        $ref = $this->qr($order)->json('data.reference');
        $body = ['upi_reference' => $ref, 'transaction_reference' => '412345678901', 'payment_verified' => true];

        $this->pay($order, $body)->assertOk();
        $this->pay($order, $body)->assertStatus(422);
        $this->assertSame(1, Payment::where('order_id', $order->id)->count());
    }

    public function test_the_same_bank_reference_cannot_settle_two_orders(): void
    {
        $this->configureUpi();
        $a = $this->makeOrder(200);
        $b = $this->makeOrder(200);
        $refA = $this->qr($a)->json('data.reference');
        $refB = $this->qr($b)->json('data.reference');

        $this->pay($a, ['upi_reference' => $refA, 'transaction_reference' => '412345678901', 'payment_verified' => true])->assertOk();
        $this->pay($b, ['upi_reference' => $refB, 'transaction_reference' => '412345678901', 'payment_verified' => true])
            ->assertStatus(422)->assertJsonValidationErrors('transaction_reference');
        $this->assertSame('unpaid', $b->fresh()->payment_status);
    }

    public function test_cancelled_order_cannot_be_paid_through_a_stale_qr(): void
    {
        $this->configureUpi();
        $order = $this->makeOrder(200);
        $ref = $this->qr($order)->json('data.reference');

        $this->actingAs($this->user('cashier'), 'sanctum')->postJson("/api/orders/{$order->id}/cancel", ['reason' => 'Customer left'])->assertOk();
        $this->assertSame('cancelled', UpiPaymentRequest::where('reference', $ref)->value('status'));

        $this->pay($order, ['upi_reference' => $ref, 'transaction_reference' => '412345678901', 'payment_verified' => true])->assertStatus(422);
        $this->assertSame('unpaid', $order->fresh()->payment_status);
    }

    // ---------- Unchanged behaviour & receipts ----------

    public function test_cash_payment_is_unchanged_when_upi_is_configured(): void
    {
        $this->configureUpi();
        $order = $this->makeOrder(200);
        $this->pay($order, ['cash_tendered' => 500], 'cash')->assertOk()->assertJsonPath('data.change_returned', '300.00');
        $this->assertSame('paid', $order->fresh()->payment_status);
    }

    public function test_upi_payment_without_upi_qr_configured_keeps_the_legacy_manual_flow(): void
    {
        $this->configureUpi(self::VPA, false);
        $order = $this->makeOrder(200);
        $this->pay($order)->assertOk();
        $this->assertSame('paid', $order->fresh()->payment_status);
    }

    public function test_receipt_keeps_the_original_upi_details_after_the_upi_id_changes(): void
    {
        $this->configureUpi('first@upi');
        $order = $this->makeOrder(200);
        $ref = $this->qr($order)->json('data.reference');

        $before = $this->actingAs($this->user('cashier'), 'sanctum')->getJson("/api/billing/receipt/{$order->id}")->assertOk();
        $before->assertJsonPath('data.upi.reference', $ref)->assertJsonPath('data.upi.status', 'pending')->assertJsonPath('data.upi_enabled', true);

        $this->pay($order, ['upi_reference' => $ref, 'transaction_reference' => '412345678901', 'payment_verified' => true])->assertOk();
        $this->actingAs($this->user('owner'), 'sanctum')->putJson('/api/settings/upi', ['enabled' => true, 'vpa' => 'second@upi'])->assertOk();

        $after = $this->actingAs($this->user('cashier'), 'sanctum')->getJson("/api/billing/receipt/{$order->id}")->assertOk();
        $after->assertJsonPath('data.upi.reference', $ref)->assertJsonPath('data.upi.vpa', 'first@upi')->assertJsonPath('data.upi.status', 'paid');
        $this->assertStringContainsString('pa=first@upi', $after->json('data.upi.upi_uri'));
        $this->assertStringContainsString("tn={$order->order_number}", $after->json('data.upi.upi_uri'));
    }

    public function test_receipt_has_no_upi_block_when_upi_is_disabled(): void
    {
        $this->configureUpi(self::VPA, false);
        $order = $this->makeOrder(200);
        $res = $this->actingAs($this->user('cashier'), 'sanctum')->getJson("/api/billing/receipt/{$order->id}")->assertOk();
        $res->assertJsonPath('data.upi', null)->assertJsonPath('data.upi_enabled', false);
    }
}
