<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Setting;
use App\Services\AuditService;
use App\Services\TaxService;
use App\Services\UpiPaymentService;
use Illuminate\Validation\ValidationException;
use Illuminate\Http\Request;

/**
 * Food court settings. Any signed-in user can read them (the POS needs the enabled payment methods and the
 * receipt text); only the owner can change them. GST ("tax") is configured here and calculated only by TaxService.
 */
class SettingsController extends Controller
{
    /** Payment methods the billing code already supports. Settings can only switch these on or off. */
    public const PAYMENT_METHODS = ['cash', 'upi_qr', 'card'];

    private const DEFAULTS = [
        'business_profile' => [
            'name' => 'Urban Food Court',
            'legal_name' => null,
            'address' => null,
            'phone' => null,
            'email' => null,
            'gstin' => null,
            'opening_time' => null,
            'closing_time' => null,
        ],
        'receipt' => [
            'header' => null,
            'footer' => 'Thank you! Visit again.',
            'show_gstin' => false,
        ],
        'payment_methods' => [
            'enabled' => self::PAYMENT_METHODS,
        ],
        'order_tracking' => [
            'delay_minutes' => 15,
        ],
        // Merchant UPI ID for the per-bill payment QR. A UPI ID is public by nature (it is printed on the QR),
        // so any signed-in user may read it; only the owner may change it.
        'upi' => [
            'enabled' => false,
            'vpa' => null,
            // Set only by the owner's test-scan confirmation; dropped when the UPI ID changes. Never client-supplied.
            'verification' => null,
        ],
        // GST. These are the values an installation that never opened the setting keeps using (the rule it always had:
        // GST on, 5%, added on top of item prices). The owner changes them in Food Court Settings; nothing else holds a rate.
        'tax' => [
            'enabled' => true,
            'rate_percent' => '5.00',
            'mode' => 'exclusive',
            'apply_to' => 'all',
        ],
    ];

    public static function current(string $key): array
    {
        return array_merge(self::DEFAULTS[$key], Setting::getValue($key, []) ?? []);
    }

    public static function enabledPaymentMethods(): array
    {
        $enabled = self::current('payment_methods')['enabled'] ?? self::PAYMENT_METHODS;

        return array_values(array_intersect(self::PAYMENT_METHODS, $enabled));
    }

    public function index()
    {
        return response()->json([
            'success' => true,
            'data' => [
                'business_profile' => self::current('business_profile'),
                'receipt' => self::current('receipt'),
                'payment_methods' => [
                    'enabled' => self::enabledPaymentMethods(),
                    'available' => self::PAYMENT_METHODS,
                ],
                'order_tracking' => self::current('order_tracking'),
                'upi' => UpiPaymentService::publicConfig(),
                'tax' => self::current('tax') + [
                    'editable' => true,
                    // Menu items carry no tax setting of their own, so GST can only apply to all items
                    'item_level_supported' => false,
                ],
            ],
        ]);
    }

    /** GET /public/tax: what the customer QR menu needs to show an estimate (the server prices the real order). */
    public function publicTax()
    {
        $tax = self::current('tax');

        return response()->json(['success' => true, 'data' => [
            'enabled' => (bool) $tax['enabled'],
            'rate_percent' => $tax['rate_percent'],
            'mode' => $tax['mode'],
        ]]);
    }

    public function update(Request $request, string $key)
    {
        if (!$request->user()->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Owner access required.'], 403);
        }

        $rules = match ($key) {
            'business_profile' => [
                'name' => 'required|string|max:100',
                'legal_name' => 'nullable|string|max:150',
                'address' => 'nullable|string|max:500',
                'phone' => 'nullable|string|max:20',
                'email' => 'nullable|email|max:100',
                'gstin' => ['nullable', 'string', 'regex:/^[0-9A-Z]{15}$/'],
                'opening_time' => 'nullable|date_format:H:i',
                'closing_time' => 'nullable|date_format:H:i',
            ],
            'receipt' => [
                'header' => 'nullable|string|max:200',
                'footer' => 'nullable|string|max:300',
                'show_gstin' => 'required|boolean',
            ],
            'payment_methods' => [
                'enabled' => 'required|array|min:1',
                'enabled.*' => 'distinct|in:' . implode(',', self::PAYMENT_METHODS),
            ],
            'order_tracking' => [
                'delay_minutes' => 'required|integer|min:1|max:120',
            ],
            'upi' => [
                'enabled' => 'required|boolean',
                'vpa' => ['nullable', 'string', 'max:320', 'regex:' . UpiPaymentService::VPA_PATTERN],
            ],
            'tax' => [
                'enabled' => 'required|boolean',
                'rate_percent' => ['required', 'regex:/^\d{1,2}(\.\d{1,2})?$/', 'numeric', 'between:0,' . TaxService::MAX_RATE_PERCENT],
                'mode' => 'required|in:exclusive,inclusive',
                'apply_to' => 'required|in:all',
            ],
            default => null,
        };

        if ($rules === null) {
            return response()->json(['success' => false, 'message' => 'Unknown setting.'], 404);
        }

        $validated = $request->validate($rules, [
            'gstin.regex' => 'GSTIN must be 15 characters: digits and capital letters.',
            'vpa.regex' => 'Enter a valid UPI ID such as name@bank (letters, digits, dot, dash, underscore, then @ and the provider handle).',
        ]);

        if ($key === 'tax') {
            $validated['rate_percent'] = number_format((float) $validated['rate_percent'], 2, '.', '');
        }

        if ($key === 'upi') {
            $validated['vpa'] = isset($validated['vpa']) && trim($validated['vpa']) !== '' ? strtolower(trim($validated['vpa'])) : null;
            if ($validated['enabled'] && $validated['vpa'] === null) {
                throw ValidationException::withMessages(['vpa' => 'Enter the merchant UPI ID before turning on UPI QR payments.']);
            }
            if ($validated['enabled'] && !in_array('upi_qr', self::enabledPaymentMethods(), true)) {
                throw ValidationException::withMessages(['enabled' => 'Turn on "UPI / QR" under Payment methods first, then enable UPI QR payments.']);
            }
        }

        $old = self::current($key);
        $new = array_merge($old, $validated);
        if ($key === 'upi' && strtolower((string) ($old['vpa'] ?? '')) !== strtolower((string) ($new['vpa'] ?? ''))) {
            $new['verification'] = null; // a test scan only vouches for the UPI ID it was done with
        }

        Setting::updateOrCreate(['key' => $key], ['value' => $new, 'updated_by_user_id' => $request->user()->id]);
        AuditService::log('settings_updated', 'Setting', $key, null, $old, $new);

        $data = $key === 'upi' ? UpiPaymentService::publicConfig() : $new;

        return response()->json(['success' => true, 'message' => 'Settings saved', 'data' => $data]);
    }

    /** POST /settings/upi/test-qr (owner): a Rs 1.00 test payload to the saved UPI ID. Creates no order or payment. */
    public function upiTestQr(Request $request)
    {
        if (!$request->user()->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Owner access required.'], 403);
        }

        return response()->json(['success' => true, 'data' => UpiPaymentService::testPayload()]);
    }

    /**
     * POST /settings/upi/test-confirmed (owner): the owner attests that a real UPI app scanned the test QR and showed the
     * payee for THIS UPI ID. This is an owner statement, not a bank/provider verification, and is recorded as such.
     */
    public function upiTestConfirmed(Request $request)
    {
        if (!$request->user()->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Owner access required.'], 403);
        }
        $cfg = self::current('upi');
        if (empty($cfg['vpa']) || !preg_match(UpiPaymentService::VPA_PATTERN, (string) $cfg['vpa'])) {
            return response()->json(['success' => false, 'message' => 'Save a valid UPI ID first, then test it.'], 422);
        }
        $old = $cfg;
        $cfg['verification'] = [
            'vpa' => strtolower((string) $cfg['vpa']),
            'method' => 'owner_test_scan',
            'confirmed_at' => now()->toIso8601String(),
            'confirmed_by_user_id' => $request->user()->id,
        ];
        Setting::updateOrCreate(['key' => 'upi'], ['value' => $cfg, 'updated_by_user_id' => $request->user()->id]);
        AuditService::log('upi_test_scan_confirmed', 'Setting', 'upi', null, $old, $cfg);

        return response()->json(['success' => true, 'message' => 'Test scan recorded', 'data' => UpiPaymentService::publicConfig()]);
    }
}
