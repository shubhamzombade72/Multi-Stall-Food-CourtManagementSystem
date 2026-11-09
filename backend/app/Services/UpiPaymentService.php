<?php

namespace App\Services;

use App\Http\Controllers\Api\SettingsController;
use App\Models\Order;
use App\Models\OrderSplit;
use App\Models\UpiPaymentRequest;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Builds the per-bill UPI payment request (the QR payload). A QR is only a request to pay: nothing here, and
 * nothing a customer does with it, marks an order paid. Payment is recorded by BillingController::processPayment
 * after the cashier verifies the money, and only against a request created here for that exact order and amount.
 */
class UpiPaymentService
{
    /** UPI IDs are case-insensitive: name@handle with the characters real VPAs use. Rejects '&', '?', '=', '#', spaces. */
    public const VPA_PATTERN = '/^[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9]{1,63}$/i';

    /** Payee name shown in the customer's UPI app. */
    private const MAX_PAYEE_LENGTH = 50;

    /**
     * Provider handles (the part after '@') published by NPCI for the large UPI apps. This is ADVISORY: new handles are
     * added over time, so an unlisted handle only raises a warning (with a 'did you mean'), it is never rejected, and a
     * listed one never proves the account exists. Only a real payment (or a provider's own validation) proves that.
     */
    public const KNOWN_HANDLES = [
        'okaxis', 'okhdfcbank', 'okicici', 'oksbi', 'ybl', 'ibl', 'axl', 'paytm', 'pthdfc', 'ptaxis', 'ptsbi', 'ptyes', 'upi', 'apl',
        'sbi', 'axisbank', 'hdfcbank', 'icici', 'yesbank', 'kotak', 'barodampay', 'pnb', 'cnrb', 'unionbank', 'aubank', 'idfcbank',
        'indus', 'fbl', 'rbl', 'jupiteraxis', 'freecharge', 'waicici', 'wahdfcbank', 'waaxis', 'wasbi', 'postbank',
    ];

    public static function config(): array
    {
        return SettingsController::current('upi');
    }

    /**
     * What can honestly be said about a UPI ID without asking a bank: whether it is well-formed, whether its provider
     * handle is a known one, and a suggestion when it looks like a typo. Never claims the account exists.
     */
    public static function assess(?string $vpa): array
    {
        $vpa = strtolower(trim((string) $vpa));
        if ($vpa === '' || !preg_match(self::VPA_PATTERN, $vpa)) {
            return ['syntax_valid' => false, 'handle' => null, 'handle_known' => false, 'suggested_handle' => null];
        }
        $handle = substr($vpa, strrpos($vpa, '@') + 1);
        $known = in_array($handle, self::KNOWN_HANDLES, true);
        $suggested = null;
        if (!$known) {
            $best = null;
            foreach (self::KNOWN_HANDLES as $candidate) {
                $d = levenshtein($handle, $candidate);
                if ($best === null || $d < $best[1]) {
                    $best = [$candidate, $d];
                }
            }
            $suggested = $best !== null && $best[1] <= 2 ? $best[0] : null;
        }

        return ['syntax_valid' => true, 'handle' => $handle, 'handle_known' => $known, 'suggested_handle' => $suggested];
    }

    /**
     * The UPI settings as every signed-in screen sees them: the saved values plus an honest verification status.
     * `test_confirmed` means the OWNER scanned a test QR with a real UPI app and attested the payee name appeared for THIS
     * UPI ID; it is not a bank or provider verification, and it is dropped whenever the UPI ID changes.
     */
    public static function publicConfig(): array
    {
        $cfg = self::config();
        $v = $cfg['verification'] ?? null;
        $confirmed = is_array($v) && !empty($v['vpa']) && strtolower((string) $cfg['vpa']) === $v['vpa'];

        return [
            'enabled' => (bool) $cfg['enabled'],
            'vpa' => $cfg['vpa'],
            'check' => self::assess($cfg['vpa']) + [
                'test_confirmed' => $confirmed,
                'test_confirmed_at' => $confirmed ? ($v['confirmed_at'] ?? null) : null,
                'provider_verified' => false, // no provider/bank integration exists, so this is never true
            ],
        ];
    }

    /** A controlled test payload: Rs 1.00 to the configured UPI ID with a TEST reference. Creates no order and no payment. */
    public static function testPayload(): array
    {
        $cfg = self::config();
        $vpa = strtolower(trim((string) ($cfg['vpa'] ?? '')));
        if (!preg_match(self::VPA_PATTERN, $vpa)) {
            abort(422, 'Cannot generate a test QR: no valid UPI ID is configured.');
        }
        $name = (string) (SettingsController::current('business_profile')['name'] ?? '');
        $name = $name !== '' ? $name : 'Food Court';
        $ref = 'TEST-' . strtoupper(bin2hex(random_bytes(4)));

        return [
            'vpa' => $vpa,
            'payee_name' => mb_substr($name, 0, self::MAX_PAYEE_LENGTH),
            'amount' => '1.00',
            'reference' => $ref,
            'upi_uri' => self::buildUri($vpa, $name, '1.00', $ref),
            'warning' => 'This is a test QR for Rs 1.00. Scanning it in a UPI app shows whether your UPI app resolves the handle and displays your registered payee name.',
        ];
    }

    /** Why UPI QR cannot be used right now, or null if it can. */
    public static function unavailableReason(): ?string
    {
        $cfg = self::config();
        if (empty($cfg['enabled'])) {
            return 'UPI QR payments are turned off. The owner can enable them in Food Court Settings.';
        }
        $vpa = strtolower(trim((string) ($cfg['vpa'] ?? '')));
        if ($vpa === '') {
            return 'UPI ID is not configured. The owner must add it in Food Court Settings.';
        }
        if (!preg_match(self::VPA_PATTERN, $vpa)) {
            return 'The configured UPI ID is not valid. Edit it in Food Court Settings.';
        }
        if (!in_array('upi_qr', SettingsController::enabledPaymentMethods(), true)) {
            return 'UPI / QR is not an enabled payment method. The owner can enable it in Food Court Settings.';
        }

        return null;
    }

    public static function isActive(): bool
    {
        return self::unavailableReason() === null;
    }

    /**
     * upi://pay?pa=VPA&pn=NAME&am=AMOUNT&cu=INR&tn=REFERENCE. Every value is percent-encoded so a business name or
     * reference cannot add or override parameters. The VPA is validated to a safe alphabet, so its '@' stays literal
     * (as every UPI app expects it); anything else in it is encoded.
     */
    public static function buildUri(string $vpa, string $payeeName, string $amount, string $reference): string
    {
        $name = trim(preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $payeeName) ?? '');
        $name = mb_substr($name, 0, self::MAX_PAYEE_LENGTH);
        $amount = bcadd($amount, '0', 2);
        $reference = trim(preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $reference) ?? '');

        return 'upi://pay?'
            . 'pa=' . str_replace('%40', '@', rawurlencode($vpa))
            . '&pn=' . rawurlencode($name)
            . '&am=' . $amount
            . '&cu=INR'
            . '&tn=' . rawurlencode($reference);
    }

    /**
     * Records what the cashier saw: initiated (customer started paying) or failed/cancelled (closed without payment).
     * None of these moves money or touches the order: only BillingController::settle can mark a bill paid.
     */
    public function transition(string $reference, string $to, User $by, ?string $reason = null): UpiPaymentRequest
    {
        return DB::transaction(function () use ($reference, $to, $by, $reason) {
            $request = UpiPaymentRequest::where('reference', $reference)->lockForUpdate()->first();
            if (!$request) {
                abort(404, 'UPI request not found.');
            }
            if (!$request->canMoveTo($to)) {
                abort(422, "A UPI request that is {$request->status} cannot be marked {$to}.");
            }
            $from = $request->status;
            $changes = ['status' => $to];
            if ($to === 'initiated') {
                $changes += ['initiated_at' => now(), 'initiated_by_user_id' => $by->id];
            } else {
                $changes += ['closed_at' => now(), 'closed_reason' => $reason !== null && trim($reason) !== '' ? mb_substr(trim($reason), 0, 255) : null];
            }
            $request->update($changes);
            AuditService::log('upi_request_' . $to, 'UpiPaymentRequest', $request->id, null, ['status' => $from], [
                'status' => $to,
                'order_id' => $request->order_id,
                'reference' => $request->reference,
                'reason' => $changes['closed_reason'] ?? null,
            ], $by->id);

            return $request->fresh();
        });
    }

    /**
     * The pending request for an unpaid order, created (or re-created after a UPI ID change) on demand.
     */
    public function requestFor(Order $order, User $by): UpiPaymentRequest
    {
        if ($reason = self::unavailableReason()) {
            abort(422, $reason);
        }
        $cfg = self::config();
        $vpa = strtolower(trim((string) $cfg['vpa']));

        return DB::transaction(function () use ($order, $by, $vpa) {
            $locked = Order::where('id', $order->id)->lockForUpdate()->firstOrFail();
            if ($locked->status === 'cancelled') {
                abort(422, 'Cannot create a UPI QR for a cancelled order.');
            }
            if ($locked->payment_status === 'paid') {
                abort(422, 'This order has already been paid in full.');
            }

            // A QR asks the customer for the final amount, so it follows the same rule as the bill itself
            $eligibility = app(BillingEligibility::class);
            $eligibility->persistRepricing($locked, $eligibility->assertBillable($locked), $by->id);

            $alreadyPaid =$locked->payments()->where('status', 'success')->sum('amount');
            $remaining = bcsub((string) $locked->total_amount, (string) $alreadyPaid, 2);
            $amount = bccomp($remaining, '0.00', 2) > 0 ? $remaining : bcadd((string) $locked->total_amount, '0', 2);
            $query = UpiPaymentRequest::where('order_id', $locked->id)->whereNull('order_split_id');

            if (bccomp($amount, '0', 2) <= 0) {
                abort(422, 'Nothing to pay on this order.');
            }

            $pending = $query->whereIn('status', UpiPaymentRequest::OPEN)->lockForUpdate()->get();
            $reusable = $pending->first(fn ($r) => $r->vpa === $vpa && bccomp((string) $r->amount, $amount, 2) === 0);
            if ($reusable) {
                return $reusable;
            }

            // The UPI ID or the amount changed since the last QR: that QR can no longer confirm a payment
            foreach ($pending as $stale) {
                $was = $stale->status;
                $stale->update(['status' => 'superseded', 'closed_at' => now(), 'closed_reason' => 'Replaced by a newer QR (UPI ID or amount changed)']);
                AuditService::log('upi_request_superseded', 'UpiPaymentRequest', $stale->id, null, ['status' => $was], ['status' => 'superseded'], $by->id);
            }

            $baseCode = $locked->order_number;
            $attempt = UpiPaymentRequest::where('order_id', $locked->id)
                ->whereNull('order_split_id')
                ->count();
            $reference = $attempt === 0 ? $baseCode : $baseCode . '-' . ($attempt + 1);
            $payee = (string) (SettingsController::current('business_profile')['name'] ?? '');
            $payee = $payee !== '' ? $payee : 'Food Court';

            $request = UpiPaymentRequest::create([
                'order_id' => $locked->id,
                'reference' => $reference,
                'vpa' => $vpa,
                'payee_name' => mb_substr($payee, 0, self::MAX_PAYEE_LENGTH),
                'amount' => $amount,
                'upi_uri' => self::buildUri($vpa, $payee, $amount, $reference),
                'status' => 'pending',
                'created_by_user_id' => $by->id,
            ]);
            AuditService::log('upi_request_created', 'UpiPaymentRequest', $request->id, null, null, [
                'order_id' => $locked->id,
                'reference' => $reference,
                'vpa' => $vpa,
                'amount' => $amount,
            ], $by->id);

            return $request;
        });
    }
}
