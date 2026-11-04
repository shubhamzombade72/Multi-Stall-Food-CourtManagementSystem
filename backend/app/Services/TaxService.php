<?php

namespace App\Services;

use App\Http\Controllers\Api\SettingsController;

/**
 * The ONE place GST is calculated. The configuration lives in Food Court Settings (key "tax"); nothing else in the
 * backend multiplies by a rate. The desktop POS estimate (frontend-desktop/src/lib/tax.ts) follows the same rules and is
 * checked against the same vectors (qa/tax-vectors.json), and the server's figures always win.
 *
 * Rules (all amounts in whole paise, so there is no floating point and no bcmath scale drift):
 *  - Exclusive: tax = items x rate / 100; total = items + tax. subtotal (taxable value) = items.
 *  - Inclusive: item prices already contain GST. tax = items x rate / (100 + rate); total = items (GST is never added
 *    again); subtotal (taxable value) = items - tax.
 *  - Disabled: no tax, total = items.
 *  - Rounding: half up to the paisa, once, on the whole bill. subtotal + tax_amount = total_amount in every mode.
 */
class TaxService
{
    /** Highest GST slab incl. compensation cess; anything above is a typing mistake. */
    public const MAX_RATE_PERCENT = 40;

    /** The saved configuration (settings key "tax"), merged over the defaults. */
    public static function config(): array
    {
        return SettingsController::current('tax');
    }

    /**
     * @param string     $itemsTotal Sum of the bill's line prices (decimal string, 2 places)
     * @param array|null $config     Defaults to the saved configuration
     * @return array{subtotal:string,tax_amount:string,total_amount:string,tax_mode:string,tax_rate_percent:string}
     */
    public static function calculate(string $itemsTotal, ?array $config = null): array
    {
        $config ??= self::config();
        $items = (int) bcmul($itemsTotal, '100', 0);
        $enabled = !empty($config['enabled']);
        $mode = ($config['mode'] ?? 'exclusive') === 'inclusive' ? 'inclusive' : 'exclusive';
        $rate = $enabled ? (int) bcmul((string) ($config['rate_percent'] ?? '0'), '100', 0) : 0; // hundredths of a percent

        if (!$enabled) {
            return self::result($items, 0, $items, 'none', 0);
        }
        if ($mode === 'exclusive') {
            $tax = self::divideHalfUp($items * $rate, 10000);

            return self::result($items, $tax, $items + $tax, 'exclusive', $rate);
        }
        $tax = self::divideHalfUp($items * $rate, 10000 + $rate);

        return self::result($items - $tax, $tax, $items, 'inclusive', $rate);
    }

    private static function divideHalfUp(int $numerator, int $denominator): int
    {
        return intdiv(2 * $numerator + $denominator, 2 * $denominator);
    }

    private static function result(int $subtotal, int $tax, int $total, string $mode, int $rate): array
    {
        return [
            'subtotal' => self::money($subtotal),
            'tax_amount' => self::money($tax),
            'total_amount' => self::money($total),
            'tax_mode' => $mode,
            'tax_rate_percent' => self::money($rate),
        ];
    }

    private static function money(int $paise): string
    {
        return sprintf('%d.%02d', intdiv($paise, 100), $paise % 100);
    }
}
