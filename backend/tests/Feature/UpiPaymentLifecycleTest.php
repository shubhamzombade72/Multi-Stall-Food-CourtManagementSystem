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
 * UPI QR: honest UPI ID checking, the owner's test-scan workflow, and the request lifecycle
 * (pending -> initiated -> paid | failed | cancelled). A QR, opening a UPI app, or a customer's screenshot is never
 * payment: only a cashier's manual verification settles a bill, and it is recorded and labelled as manual.
 */
class UpiPaymentLifecycleTest extends TestCase
{
    use DatabaseTransactions;

    private const VPA = 'mangalmurti@oksbi';

    private function user(string $role): User
    {
        return User::where('role', $role)->where('is_active', true)->firstOrFail();
    }

    private function configureUpi(?string $vpa = self::VPA, bool $enabled = true): void
    {
        Setting::updateOrCreate(['key' => 'payment_methods'], ['value' => ['enabled' => ['cash', 'upi_qr', 'card', 'split']]]);
        Setting::updateOrCreate(['key' => 'business_profile'], ['value' => ['name' => 'MangalMurti Food Court']]);
        Setting::updateOrCreate(['key' => 'upi'], ['value' => ['enabled' => $enabled, 'vpa' => $vpa]]);
    }

    private function makeOrder(float|string $total): Order
    {
        $order = Order::create([
            'order_type' => 'takeaway', 'order_channel' => 'cashier_pos', 'status' => 'confirmed',
            'subtotal' => $total, 'tax_amount' => 0, 'discount_amount' => 0, 'total_amount' => $total,
            'payment_status' => 'unpaid', 'idempotency_key' => 'upi-life-' . uniqid('', true),
        ]);
        $menu = MenuItem::firstOrFail();
        $order->items()->create([
            'stall_id' => $menu->stall_id, 'menu_item_id' => $menu->id, 'item_name' => $menu->name,
            'unit_price' => $total, 'quantity' => 1, 'subtotal' => $total, 'status' => 'served',
        ]);

        return $order;
    }

    private function qr(Order $order)
    {
        return $this->actingAs($this->user('cashier'), 'sanctum')->postJson("/api/billing/orders/{$order->id}/upi-request");
    }

    private function moveTo(string $reference, string $status, ?User $as = null, array $extra = [])
    {
        return $this->actingAs($as ?? $this->user('cashier'), 'sanctum')->postJson("/api/billing/upi-requests/{$reference}/status", array_merge(['status' => $status], $extra));
    }

    private function pay(Order $order, string $reference, array $extra = [])
    {
        return $this->actingAs($this->user('cashier'), 'sanctum')->postJson('/api/billing/pay', array_merge([
            'order_id' => $order->id, 'payment_method' => 'upi_qr', 'amount' => (string) $order->total_amount,
            'upi_reference' => $reference, 'payment_verified' => true,
        ], $extra));
    }

    // ------------------------------------------------------------- UPI ID assessment (never claims the account exists)

    public function test_unknown_provider_handle_is_flagged_with_a_suggestion_but_still_saved(): void
    {
        $a = UpiPaymentService::assess('shubhamzombade68@oksb');
        $this->assertTrue($a['syntax_valid']);
        $this->assertFalse($a['handle_known']);
        $this->assertSame('oksb', $a['handle']);
        $this->assertSame('oksbi', $a['suggested_handle']);

        $this->configureUpi(null, false);
        $res = $this->actingAs($this->user('owner'), 'sanctum')->putJson('/api/settings/upi', ['enabled' => true, 'vpa' => 'Shubhamzombade68@OKSB']);
        $res->assertOk();
        $this->assertSame('shubhamzombade68@oksb', $res->json('data.vpa'), 'the configured UPI ID is preserved (lower-cased), never silently corrected');
        $this->assertFalse($res->json('data.check.handle_known'));
        $this->assertSame('oksbi', $res->json('data.check.suggested_handle'));
        $this->assertFalse($res->json('data.check.provider_verified'));
        $this->assertFalse($res->json('data.check.test_confirmed'));
    }

    public function test_known_handles_pass_the_advisory_check_but_are_still_not_provider_verified(): void
    {
        foreach (['shop@oksbi', 'shop@okaxis', 'shop@ybl', 'shop@paytm', 'shop@okhdfcbank', 'shop@upi'] as $vpa) {
            $a = UpiPaymentService::assess($vpa);
            $this->assertTrue($a['handle_known'], $vpa);
            $this->assertNull($a['suggested_handle']);
        }
        $this->configureUpi('shop@oksbi');
        $res = $this->actingAs($this->user('cashier'), 'sanctum')->getJson('/api/settings');
        $this->assertFalse($res->json('data.upi.check.provider_verified'), 'syntax or a known handle never proves the account exists');
        $this->assertFalse($res->json('data.upi.check.test_confirmed'));
    }

    public function test_missing_and_malformed_upi_ids_are_rejected_or_unavailable(): void
    {
        $this->assertFalse(UpiPaymentService::assess(null)['syntax_valid']);
        $this->assertFalse(UpiPaymentService::assess('')['syntax_valid']);
        foreach (['noatsign', 'a@b', 'name@', '@bank', 'na me@okaxis', 'a&b=c@okaxis', 'name@ok axis', 'x@1bank'] as $bad) {
            $this->assertFalse(UpiPaymentService::assess($bad)['syntax_valid'], $bad);
            $this->actingAs($this->user('owner'), 'sanctum')->putJson('/api/settings/upi', ['enabled' => false, 'vpa' => $bad])->assertStatus(422);
        }
        $this->configureUpi(null, true);
        $this->assertNotNull(UpiPaymentService::unavailableReason());
        $order = $this->makeOrder('26.25');
        $this->qr($order)->assertStatus(422);
        $this->assertSame(0, UpiPaymentRequest::where('order_id', $order->id)->count());
    }

    // ------------------------------------------------------------- owner test-scan workflow

    public function test_test_qr_is_one_rupee_to_the_saved_upi_id_and_creates_no_order_or_payment(): void
    {
        $this->configureUpi('shop@oksbi');
        $orders = Order::count();
        $payments = Payment::count();
        $requests = UpiPaymentRequest::count();

        $res = $this->actingAs($this->user('owner'), 'sanctum')->postJson('/api/settings/upi/test-qr');
        $res->assertOk();
        parse_str(parse_url($res->json('data.upi_uri'), PHP_URL_QUERY), $q);
        $this->assertSame('shop@oksbi', $q['pa']);
        $this->assertSame('MangalMurti Food Court', $q['pn']);
        $this->assertSame('1.00', $q['am']);
        $this->assertSame('INR', $q['cu']);
        $this->assertMatchesRegularExpression('/^TEST-[0-9A-F]{8}$/', $q['tn']);

        $this->assertSame($orders, Order::count());
        $this->assertSame($payments, Payment::count());
        $this->assertSame($requests, UpiPaymentRequest::count());
    }

    public function test_only_the_owner_can_run_the_test_and_a_missing_upi_id_blocks_it(): void
    {
        $this->configureUpi('shop@oksbi');
        $this->actingAs($this->user('cashier'), 'sanctum')->postJson('/api/settings/upi/test-qr')->assertStatus(403);
        $this->actingAs($this->user('cashier'), 'sanctum')->postJson('/api/settings/upi/test-confirmed')->assertStatus(403);
        $this->configureUpi(null, false);
        $this->actingAs($this->user('owner'), 'sanctum')->postJson('/api/settings/upi/test-qr')->assertStatus(422);
        $this->actingAs($this->user('owner'), 'sanctum')->postJson('/api/settings/upi/test-confirmed')->assertStatus(422);
    }

    public function test_owner_test_confirmation_is_recorded_audited_and_dropped_when_the_upi_id_changes(): void
    {
        $this->configureUpi('shop@oksbi');
        $owner = $this->user('owner');
        $res = $this->actingAs($owner, 'sanctum')->postJson('/api/settings/upi/test-confirmed');
        $res->assertOk();
        $this->assertTrue($res->json('data.check.test_confirmed'));
        $this->assertNotNull($res->json('data.check.test_confirmed_at'));
        $this->assertFalse($res->json('data.check.provider_verified'), 'an owner scan is not a bank verification');
        $this->assertTrue(AuditLog::where('action', 'upi_test_scan_confirmed')->exists());

        $changed = $this->actingAs($owner, 'sanctum')->putJson('/api/settings/upi', ['enabled' => true, 'vpa' => 'other@okaxis']);
        $this->assertFalse($changed->json('data.check.test_confirmed'), 'a test only vouches for the UPI ID it was done with');
        $this->assertFalse($this->actingAs($owner, 'sanctum')->getJson('/api/settings')->json('data.upi.check.test_confirmed'));

        // Saving the same UPI ID again keeps the confirmation
        $this->actingAs($owner, 'sanctum')->postJson('/api/settings/upi/test-confirmed')->assertOk();
        $same = $this->actingAs($owner, 'sanctum')->putJson('/api/settings/upi', ['enabled' => true, 'vpa' => 'OTHER@okaxis']);
        $this->assertTrue($same->json('data.check.test_confirmed'));
    }

    // ------------------------------------------------------------- QR generated is NOT paid

    public function test_generating_a_qr_leaves_the_bill_unpaid_and_creates_no_payment(): void
    {
        $this->configureUpi();
        $order = $this->makeOrder('26.25');
        $res = $this->qr($order)->assertOk();
        $this->assertSame('pending', $res->json('data.status'));
        $this->assertNull($res->json('data.verification'));
        $this->assertSame('unpaid', $order->fresh()->payment_status);
        $this->assertSame('confirmed', $order->fresh()->status);
        $this->assertSame(0, Payment::where('order_id', $order->id)->count());

        $receipt = $this->actingAs($this->user('cashier'), 'sanctum')->getJson("/api/billing/receipt/{$order->id}")->json('data');
        $this->assertSame('pending', $receipt['upi']['status']);
    }

    public function test_marking_initiated_is_not_payment(): void
    {
        $this->configureUpi();
        $order = $this->makeOrder('26.25');
        $ref = $this->qr($order)->json('data.reference');

        $res = $this->moveTo($ref, 'initiated')->assertOk();
        $this->assertSame('initiated', $res->json('data.status'));
        $row = UpiPaymentRequest::where('reference', $ref)->first();
        $this->assertNotNull($row->initiated_at);
        $this->assertSame('unpaid', $order->fresh()->payment_status);
        $this->assertSame(0, Payment::where('order_id', $order->id)->count());
        $this->assertNull($row->payment_id);
        $this->assertNull($row->verification_method);
        $this->assertTrue(AuditLog::where('action', 'upi_request_initiated')->exists());

        // the same QR is reused (not replaced) while it is initiated
        $this->assertSame($ref, $this->qr($order)->json('data.reference'));
        // and the bill's receipt still shows it as an unpaid request, never as paid
        $receipt = $this->actingAs($this->user('cashier'), 'sanctum')->getJson("/api/billing/receipt/{$order->id}")->json('data');
        $this->assertSame('initiated', $receipt['upi']['status']);
        $this->assertSame('unpaid', $receipt['order']['payment_status']);
    }

    public function test_verified_confirmation_marks_paid_and_records_who_when_what_and_that_it_was_manual(): void
    {
        $this->configureUpi();
        $order = $this->makeOrder('26.25');
        $ref = $this->qr($order)->json('data.reference');
        $this->moveTo($ref, 'initiated')->assertOk();
        $cashier = $this->user('cashier');

        $this->pay($order, $ref, ['transaction_reference' => '412345678901'])->assertOk();

        $row = UpiPaymentRequest::where('reference', $ref)->first();
        $this->assertSame('paid', $row->status);
        $this->assertSame('manual', $row->verification_method);
        $this->assertSame($cashier->id, (int) $row->verified_by_user_id);
        $this->assertNotNull($row->verified_at);
        $this->assertSame('26.25', (string) $row->amount);
        $payment = Payment::where('order_id', $order->id)->firstOrFail();
        $this->assertSame('412345678901', $payment->transaction_reference);
        $this->assertSame('26.25', (string) $payment->amount);

        $audit = AuditLog::where('action', 'upi_payment_confirmed')->latest('id')->first();
        $this->assertSame('manual', $audit->new_values['verification_method']);
        $this->assertSame($cashier->id, $audit->new_values['verified_by_user_id']);

        $receipt = $this->actingAs($cashier, 'sanctum')->getJson("/api/billing/receipt/{$order->id}")->json('data');
        $this->assertSame('paid', $receipt['upi']['status']);
        $this->assertSame('manual', $receipt['upi']['verification']['method']);
        $this->assertSame($cashier->name, $receipt['upi']['verification']['verified_by']);
        $this->assertNotNull($receipt['upi']['verification']['verified_at']);
    }

    public function test_a_confirmation_without_the_verified_tick_never_marks_paid(): void
    {
        $this->configureUpi();
        $order = $this->makeOrder('26.25');
        $ref = $this->qr($order)->json('data.reference');
        $this->moveTo($ref, 'initiated')->assertOk();

        $this->pay($order, $ref, ['payment_verified' => false])->assertStatus(422);
        $this->actingAs($this->user('cashier'), 'sanctum')->postJson('/api/billing/pay', [
            'order_id' => $order->id, 'payment_method' => 'upi_qr', 'amount' => '26.25', 'upi_reference' => $ref,
        ])->assertStatus(422);
        $this->assertSame('unpaid', $order->fresh()->payment_status);
        $this->assertSame(0, Payment::where('order_id', $order->id)->count());
        $this->assertSame('initiated', UpiPaymentRequest::where('reference', $ref)->value('status'));
    }

    // ------------------------------------------------------------- failed and cancelled never settle

    public function test_failed_and_cancelled_requests_cannot_settle_the_bill_and_a_new_qr_gets_a_new_reference(): void
    {
        $this->configureUpi();
        foreach (['failed', 'cancelled'] as $closed) {
            $order = $this->makeOrder('26.25');
            $ref = $this->qr($order)->json('data.reference');
            $this->moveTo($ref, 'initiated')->assertOk();
            $res = $this->moveTo($ref, $closed, null, ['reason' => 'customer app declined'])->assertOk();
            $this->assertSame($closed, $res->json('data.status'));
            $row = UpiPaymentRequest::where('reference', $ref)->first();
            $this->assertNotNull($row->closed_at);
            $this->assertSame('customer app declined', $row->closed_reason);

            $this->pay($order, $ref)->assertStatus(422);
            $this->assertSame('unpaid', $order->fresh()->payment_status);
            $this->assertSame(0, Payment::where('order_id', $order->id)->count());

            $fresh = $this->qr($order)->assertOk();
            $this->assertNotSame($ref, $fresh->json('data.reference'));
            $this->assertSame('pending', $fresh->json('data.status'));

            // a closed request is not printed on a bill either
            $receipt = $this->actingAs($this->user('cashier'), 'sanctum')->getJson("/api/billing/receipt/{$order->id}")->json('data');
            $this->assertSame($fresh->json('data.reference'), $receipt['upi']['reference']);
        }
    }

    public function test_illegal_transitions_and_unauthorised_users_are_refused(): void
    {
        $this->configureUpi();
        $order = $this->makeOrder('26.25');
        $ref = $this->qr($order)->json('data.reference');

        $this->moveTo($ref, 'paid')->assertStatus(422);        // paid is not a status a person can set directly
        $this->moveTo($ref, 'refunded')->assertStatus(422);    // reserved: no refund workflow exists
        $this->moveTo($ref, 'superseded')->assertStatus(422);
        $this->moveTo('NOPE-123', 'initiated')->assertStatus(404);
        $this->moveTo($ref, 'failed')->assertOk();
        $this->moveTo($ref, 'initiated')->assertStatus(422);   // a closed request cannot reopen
        $this->moveTo($ref, 'cancelled')->assertStatus(422);

        $kitchen = User::where('role', 'kitchen_staff')->first() ?? User::factory()->create(['role' => 'kitchen_staff', 'is_active' => true]);
        $other = $this->makeOrder('10.00');
        $otherRef = $this->qr($other)->json('data.reference');
        $this->moveTo($otherRef, 'initiated', $kitchen)->assertStatus(403);
        $this->assertSame('pending', UpiPaymentRequest::where('reference', $otherRef)->value('status'));
    }

    public function test_a_paid_request_cannot_be_changed_by_status_updates(): void
    {
        $this->configureUpi();
        $order = $this->makeOrder('26.25');
        $ref = $this->qr($order)->json('data.reference');
        $this->pay($order, $ref)->assertOk();
        foreach (['initiated', 'failed', 'cancelled'] as $s) {
            $this->moveTo($ref, $s)->assertStatus(422);
        }
        $this->assertSame('paid', UpiPaymentRequest::where('reference', $ref)->value('status'));
    }

    public function test_cancelling_the_order_closes_an_initiated_qr(): void
    {
        $this->configureUpi();
        $order = $this->makeOrder('26.25');
        $ref = $this->qr($order)->json('data.reference');
        $this->moveTo($ref, 'initiated')->assertOk();
        $this->actingAs($this->user('owner'), 'sanctum')->postJson("/api/orders/{$order->id}/cancel", ['reason' => 'test'])->assertOk();
        $this->assertSame('cancelled', UpiPaymentRequest::where('reference', $ref)->value('status'));
        $this->pay($order, $ref)->assertStatus(422);
    }

    // ------------------------------------------------------------- amount and payload

    public function test_zero_or_invalid_amounts_never_produce_a_qr(): void
    {
        $this->configureUpi();
        $zero = $this->makeOrder('0.00');
        $this->qr($zero)->assertStatus(422);
        $this->assertSame(0, UpiPaymentRequest::where('order_id', $zero->id)->count());
        $this->qr($this->makeOrder('0.00'))->assertStatus(422);
        $this->actingAs($this->user('cashier'), 'sanctum')->postJson('/api/billing/orders/999999999/upi-request')->assertStatus(404);
    }

    public function test_qr_payload_amount_is_the_stored_total_with_two_decimals_and_the_updated_upi_id_is_used(): void
    {
        $this->configureUpi('first@oksbi');
        $order = $this->makeOrder('26.25');
        $first = $this->qr($order)->json('data');
        parse_str(parse_url($first['upi_uri'], PHP_URL_QUERY), $q);
        $this->assertSame('first@oksbi', $q['pa']);
        $this->assertSame('26.25', $q['am']);
        $this->assertSame($first['reference'], $q['tn']);
        $this->assertSame(substr_count($first['upi_uri'], 'pa='), 1);
        $this->assertSame(1, substr_count($first['upi_uri'], 'am='));
        $this->assertStringNotContainsString(' ', $first['upi_uri']);
        $this->assertStringNotContainsString('%25', $first['upi_uri'], 'no double encoding');

        $this->actingAs($this->user('owner'), 'sanctum')->putJson('/api/settings/upi', ['enabled' => true, 'vpa' => 'second@okaxis'])->assertOk();
        $second = $this->qr($order)->json('data');
        $this->assertSame('second@okaxis', $second['vpa']);
        $this->assertNotSame($first['reference'], $second['reference']);
        $this->assertSame('superseded', UpiPaymentRequest::where('reference', $first['reference'])->value('status'));
        $this->pay($order, $first['reference'])->assertStatus(422); // the old QR can no longer confirm anything
    }
}
