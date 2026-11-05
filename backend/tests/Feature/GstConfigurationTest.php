<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\MenuItem;
use App\Models\Order;
use App\Models\Payment;
use App\Models\Setting;
use App\Models\User;
use App\Services\TaxService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\TestCase;

/**
 * GST is configured in Food Court Settings (key "tax") and calculated by ONE service (TaxService). Every new bill
 * snapshots the rate and mode it was priced with; payments, receipts, daily closing and reports read those stored
 * amounts, so changing the configuration never touches bills that already exist.
 */
class GstConfigurationTest extends TestCase
{
    use DatabaseTransactions;

    private function user(string $role): User
    {
        return User::where('role', $role)->where('is_active', true)->firstOrFail();
    }

    private function setTax(bool $enabled, string $rate, string $mode): void
    {
        Setting::updateOrCreate(['key' => 'tax'], ['value' => ['enabled' => $enabled, 'rate_percent' => $rate, 'mode' => $mode, 'apply_to' => 'all']]);
    }

    private function menuItem(string $price): MenuItem
    {
        $item = MenuItem::whereHas('stall', fn ($q) => $q->where('is_active', true))->where('is_available', true)->firstOrFail();
        $item->update(['price' => $price]);

        return $item->fresh();
    }

    /** Places a takeaway order through the real endpoint; the server prices it. */
    private function placeOrder(MenuItem $item, int $qty = 1): Order
    {
        $res = $this->actingAs($this->user('cashier'), 'sanctum')->postJson('/api/orders', [
            'order_type' => 'takeaway',
            'items' => [['menu_item_id' => $item->id, 'quantity' => $qty]],
            'idempotency_key' => 'gst-test-' . uniqid('', true),
        ])->assertStatus(201);

        return Order::where('order_number', $res->json('data.order_number'))->firstOrFail();
    }

    private function vectors(): array
    {
        $path = base_path('../qa/tax-vectors.json');
        $this->assertFileExists($path);

        return json_decode(file_get_contents($path), true)['cases'];
    }

    // ---------- the single calculation service ----------

    public function test_tax_service_matches_every_shared_vector(): void
    {
        foreach ($this->vectors() as $case) {
            $r = TaxService::calculate($case['items_total'], $case['config']);
            $this->assertSame($case['expect']['subtotal'], $r['subtotal'], $case['name'] . ' subtotal');
            $this->assertSame($case['expect']['tax_amount'], $r['tax_amount'], $case['name'] . ' tax');
            $this->assertSame($case['expect']['total_amount'], $r['total_amount'], $case['name'] . ' total');
            $this->assertSame($case['expect']['tax_mode'], $r['tax_mode'], $case['name'] . ' mode');
            $this->assertSame($case['expect']['tax_rate_percent'], $r['tax_rate_percent'], $case['name'] . ' rate');
            $this->assertSame(bcadd($r['subtotal'], $r['tax_amount'], 2), $r['total_amount'], $case['name'] . ' subtotal + tax = total');
        }
    }

    public function test_gst_is_never_applied_twice_in_inclusive_mode(): void
    {
        $r = TaxService::calculate('105.00', ['enabled' => true, 'rate_percent' => '5.00', 'mode' => 'inclusive']);
        $this->assertSame('105.00', $r['total_amount']);
        $this->assertSame('5.00', $r['tax_amount']);
    }

    // ---------- settings ----------

    public function test_default_configuration_keeps_the_existing_behaviour_for_installations_that_never_saved_it(): void
    {
        Setting::where('key', 'tax')->delete();
        $tax = $this->actingAs($this->user('cashier'), 'sanctum')->getJson('/api/settings')->assertOk()->json('data.tax');
        $this->assertTrue($tax['enabled']);
        $this->assertSame('5.00', $tax['rate_percent']);
        $this->assertSame('exclusive', $tax['mode']);
        $this->assertSame('all', $tax['apply_to']);
        $this->assertFalse($tax['item_level_supported']);
        $this->assertTrue($tax['editable']);
    }

    public function test_owner_saves_gst_settings_and_cashier_cannot(): void
    {
        $owner = $this->user('owner');
        $this->actingAs($owner, 'sanctum')->putJson('/api/settings/tax', ['enabled' => true, 'rate_percent' => 12, 'mode' => 'inclusive', 'apply_to' => 'all'])
            ->assertOk()->assertJsonPath('data.rate_percent', '12.00')->assertJsonPath('data.mode', 'inclusive');
        $this->assertSame('12.00', Setting::getValue('tax')['rate_percent']);

        $this->actingAs($this->user('cashier'), 'sanctum')->putJson('/api/settings/tax', ['enabled' => false, 'rate_percent' => 0, 'mode' => 'exclusive', 'apply_to' => 'all'])->assertStatus(403);
        $this->assertSame('12.00', Setting::getValue('tax')['rate_percent']);

        $log = AuditLog::where('action', 'settings_updated')->where('entity_id', 'tax')->latest('id')->first();
        $this->assertNotNull($log);
        $this->assertSame('12.00', $log->new_values['rate_percent']);
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('invalidTaxSettings')]
    public function test_invalid_gst_settings_are_rejected_by_the_backend(array $body, string $field): void
    {
        $this->setTax(true, '5.00', 'exclusive');
        $this->actingAs($this->user('owner'), 'sanctum')->putJson('/api/settings/tax', $body + ['enabled' => true, 'mode' => 'exclusive', 'apply_to' => 'all'])
            ->assertStatus(422)->assertJsonValidationErrors($field);
        $this->assertSame('5.00', Setting::getValue('tax')['rate_percent']);
    }

    public static function invalidTaxSettings(): array
    {
        return [
            'negative' => [['rate_percent' => -1], 'rate_percent'],
            'not numeric' => [['rate_percent' => 'abc'], 'rate_percent'],
            'empty' => [['rate_percent' => ''], 'rate_percent'],
            'too large' => [['rate_percent' => 41], 'rate_percent'],
            'absurd' => [['rate_percent' => 100000], 'rate_percent'],
            'three decimals' => [['rate_percent' => '5.123'], 'rate_percent'],
            'scientific' => [['rate_percent' => '1e1'], 'rate_percent'],
            'bad mode' => [['rate_percent' => 5, 'mode' => 'weird'], 'mode'],
            'item level not supported' => [['rate_percent' => 5, 'apply_to' => 'individual'], 'apply_to'],
        ];
    }

    public function test_enabled_flag_is_required_and_boolean(): void
    {
        $this->actingAs($this->user('owner'), 'sanctum')->putJson('/api/settings/tax', ['rate_percent' => 5, 'mode' => 'exclusive', 'apply_to' => 'all'])
            ->assertStatus(422)->assertJsonValidationErrors('enabled');
    }

    public function test_public_tax_config_is_readable_without_signing_in_for_the_qr_menu(): void
    {
        $this->setTax(true, '12.00', 'inclusive');
        $this->getJson('/api/public/tax')->assertOk()
            ->assertJsonPath('data.enabled', true)->assertJsonPath('data.rate_percent', '12.00')->assertJsonPath('data.mode', 'inclusive')
            ->assertJsonMissingPath('data.apply_to');
    }

    // ---------- new bills use the saved configuration ----------

    #[\PHPUnit\Framework\Attributes\DataProvider('orderScenarios')]
    public function test_new_orders_are_priced_from_the_saved_configuration(bool $enabled, string $rate, string $mode, string $items, string $tax, string $subtotal, string $total): void
    {
        $this->setTax($enabled, $rate, $mode);
        $order = $this->placeOrder($this->menuItem($items));

        $this->assertSame($subtotal, (string) $order->subtotal);
        $this->assertSame($tax, (string) $order->tax_amount);
        $this->assertSame($total, (string) $order->total_amount);
        $this->assertSame($enabled ? $mode : 'none', $order->tax_mode);
        $this->assertSame($enabled ? $rate : '0.00', (string) $order->tax_rate_percent);
    }

    public static function orderScenarios(): array
    {
        return [
            'GST disabled' => [false, '5.00', 'exclusive', '100.00', '0.00', '100.00', '100.00'],
            'exclusive 5%' => [true, '5.00', 'exclusive', '100.00', '5.00', '100.00', '105.00'],
            'exclusive 12%' => [true, '12.00', 'exclusive', '100.00', '12.00', '100.00', '112.00'],
            'exclusive 18%' => [true, '18.00', 'exclusive', '100.00', '18.00', '100.00', '118.00'],
            'inclusive 5%' => [true, '5.00', 'inclusive', '105.00', '5.00', '100.00', '105.00'],
            'inclusive 12%' => [true, '12.00', 'inclusive', '112.00', '12.00', '100.00', '112.00'],
            'inclusive 18%' => [true, '18.00', 'inclusive', '118.00', '18.00', '100.00', '118.00'],
            'inclusive 5% with rounding' => [true, '5.00', 'inclusive', '100.00', '4.76', '95.24', '100.00'],
        ];
    }

    public function test_changing_the_rate_affects_only_new_bills_and_never_old_ones_or_their_reports(): void
    {
        $item = $this->menuItem('100.00');
        $owner = $this->user('owner');
        $today = now()->toDateString();

        $this->setTax(true, '5.00', 'exclusive');
        $old = $this->placeOrder($item);
        $this->actingAs($this->user('cashier'), 'sanctum')->postJson('/api/billing/pay', ['order_id' => $old->id, 'payment_method' => 'cash', 'amount' => '105.00', 'cash_tendered' => 105])->assertOk();

        $summary = fn () => $this->actingAs($owner, 'sanctum')->getJson("/api/settlements/daily-summary?date={$today}")->assertOk()->json('data.summary');
        $day = fn () => collect($this->actingAs($owner, 'sanctum')->getJson("/api/reports/sales-summary?start_date={$today}&end_date={$today}")->assertOk()->json('data.days'))->firstWhere('day', $today);
        $before = $summary();
        $dayBefore = $day();

        // The owner raises GST to 18% inclusive
        $this->actingAs($owner, 'sanctum')->putJson('/api/settings/tax', ['enabled' => true, 'rate_percent' => '18', 'mode' => 'inclusive', 'apply_to' => 'all'])->assertOk();

        $oldAgain = Order::find($old->id);
        $this->assertSame('5.00', (string) $oldAgain->tax_amount);
        $this->assertSame('105.00', (string) $oldAgain->total_amount);
        $this->assertSame('exclusive', $oldAgain->tax_mode);
        $this->assertSame('5.00', (string) $oldAgain->tax_rate_percent);

        $receipt = $this->actingAs($this->user('cashier'), 'sanctum')->getJson("/api/billing/receipt/{$old->id}")->assertOk();
        $receipt->assertJsonPath('data.order.tax_mode', 'exclusive')->assertJsonPath('data.order.tax_rate_percent', '5.00')->assertJsonPath('data.order.tax_amount', '5.00');

        $this->assertEquals($before, $summary(), 'daily closing figures for existing bills do not move');
        $this->assertEquals($dayBefore, $day(), 'sales report figures for existing bills do not move');

        $new = $this->placeOrder($item);
        $this->assertSame('inclusive', $new->tax_mode);
        $this->assertSame('18.00', (string) $new->tax_rate_percent);
        $this->assertSame('15.25', (string) $new->tax_amount);
        $this->assertSame('100.00', (string) $new->total_amount);
    }

    // ---------- payments settle exactly the stored total, in every method ----------

    #[\PHPUnit\Framework\Attributes\DataProvider('paymentMethods')]
    public function test_every_payment_method_settles_the_gst_total_and_refuses_a_stale_five_percent_amount(string $method): void
    {
        $this->setTax(true, '12.00', 'exclusive');
        $order = $this->placeOrder($this->menuItem('100.00'));
        $this->assertSame('112.00', (string) $order->total_amount);

        $cashier = $this->user('cashier');
        // A client still computing the old 5% total is refused: the server total is authoritative
        $this->actingAs($cashier, 'sanctum')->postJson('/api/billing/pay', ['order_id' => $order->id, 'payment_method' => $method, 'amount' => '105.00', 'cash_tendered' => 200])->assertStatus(422);
        $this->assertSame('unpaid', $order->fresh()->payment_status);

        $body = ['order_id' => $order->id, 'payment_method' => $method, 'amount' => '112.00', 'cash_tendered' => 200];
        $this->actingAs($cashier, 'sanctum')->postJson('/api/billing/pay', $body)->assertOk();
        $this->assertSame('paid', $order->fresh()->payment_status);
        $this->assertSame('112.00', (string) Payment::where('order_id', $order->id)->value('amount'));
    }

    public static function paymentMethods(): array
    {
        return ['cash' => ['cash'], 'card' => ['card'], 'upi without a configured QR' => ['upi_qr']];
    }

    public function test_upi_qr_amount_is_the_gst_inclusive_payable_amount(): void
    {
        $this->setTax(true, '18.00', 'exclusive');
        Setting::updateOrCreate(['key' => 'payment_methods'], ['value' => ['enabled' => ['cash', 'upi_qr', 'card']]]);
        Setting::updateOrCreate(['key' => 'upi'], ['value' => ['enabled' => true, 'vpa' => 'shop@upi']]);
        $order = $this->placeOrder($this->menuItem('100.00'));

        $res = $this->actingAs($this->user('cashier'), 'sanctum')->postJson("/api/billing/orders/{$order->id}/upi-request")->assertOk();
        parse_str(parse_url($res->json('data.upi_uri'), PHP_URL_QUERY), $q);
        $this->assertSame('118.00', $q['am']);
        $this->assertSame('118.00', $res->json('data.amount'));
    }

    // ---------- reports and daily closing show the snapshot ----------

    public function test_daily_summary_reports_the_gst_collected_from_the_stored_bills(): void
    {
        $owner = $this->user('owner');
        $today = now()->toDateString();
        $summary = fn () => $this->actingAs($owner, 'sanctum')->getJson("/api/settlements/daily-summary?date={$today}")->assertOk()->json('data.summary');
        $before = $summary();

        $this->setTax(true, '12.00', 'exclusive');
        $a = $this->placeOrder($this->menuItem('100.00'));
        $this->setTax(true, '5.00', 'inclusive');
        $b = $this->placeOrder($this->menuItem('105.00'));
        foreach ([[$a, '112.00'], [$b, '105.00']] as [$o, $amt]) {
            $this->actingAs($this->user('cashier'), 'sanctum')->postJson('/api/billing/pay', ['order_id' => $o->id, 'payment_method' => 'cash', 'amount' => $amt, 'cash_tendered' => 500])->assertOk();
        }

        $after = $summary();
        $this->assertSame('17.00', bcsub((string) $after['tax_collected'], (string) $before['tax_collected'], 2), '12.00 (exclusive) + 5.00 (inclusive)');
        $this->assertSame('217.00', bcsub((string) $after['net_sales'], (string) $before['net_sales'], 2));
        $this->assertSame('200.00', bcsub((string) $after['gross_sales'], (string) $before['gross_sales'], 2), 'taxable value: 100 + 100');
    }
}
