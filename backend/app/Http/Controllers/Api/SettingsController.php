<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Setting;
use App\Services\AuditService;
use Illuminate\Http\Request;

/**
 * Food court settings. Any signed-in user can read them (the POS needs the enabled payment methods and the
 * receipt text); only the owner can change them. Tax is reported read-only: the 5% rate is hard-coded in
 * OrderController and stays that way until the owner confirms the rate and inclusive/exclusive pricing.
 */
class SettingsController extends Controller
{
    /** Payment methods the billing code already supports. Settings can only switch these on or off. */
    public const PAYMENT_METHODS = ['cash', 'upi_qr', 'card', 'split'];

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
                'tax' => [
                    'rate_percent' => '5.00',
                    'editable' => false,
                    'note' => 'Fixed 5% GST on every item, pending owner confirmation of the rate and of inclusive/exclusive pricing.',
                ],
            ],
        ]);
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
            default => null,
        };

        if ($rules === null) {
            return response()->json(['success' => false, 'message' => 'Unknown setting.'], 404);
        }

        $validated = $request->validate($rules, [
            'gstin.regex' => 'GSTIN must be 15 characters: digits and capital letters.',
        ]);

        $old = self::current($key);
        $new = array_merge($old, $validated);

        Setting::updateOrCreate(['key' => $key], ['value' => $new, 'updated_by_user_id' => $request->user()->id]);
        AuditService::log('settings_updated', 'Setting', $key, null, $old, $new);

        return response()->json(['success' => true, 'message' => 'Settings saved', 'data' => $new]);
    }
}
