<?php

namespace App\Services;

use App\Http\Controllers\Api\SettingsController;
use App\Models\Order;
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

    public static function config(): array
    {
        return SettingsController::current('upi');
    }

    /** Why a QR cannot be shown right now, or null when UPI QR payments are fully configured and on. */
    public static function unavailableReason(): ?string
    {
        $cfg = self::config();
        if (empty($cfg['enabled'])) {
            return 'UPI QR payments are turned off. The owner can enable them in Food Court Settings.';
        }
        if (empty($cfg['vpa']) || !preg_match(self::VPA_PATTERN, (string) $cfg['vpa'])) {
            return 'UPI ID is not configured. The owner must add it in Food Court Settings.';
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
     * The pending request for an unpaid order, created (or re-created after a UPI ID change) on demand. The amount is
     * always the order's stored total: nothing from the client is used.
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

            $amount = bcadd((string) $locked->total_amount, '0', 2);
            if (bccomp($amount, '0', 2) <= 0) {
                abort(422, 'Nothing to pay on this order.');
            }

            $pending = UpiPaymentRequest::where('order_id', $locked->id)->where('status', 'pending')->lockForUpdate()->get();
            $reusable = $pending->first(fn ($r) => $r->vpa === $vpa && bccomp((string) $r->amount, $amount, 2) === 0);
            if ($reusable) {
                return $reusable;
            }

            // The UPI ID or the amount changed since the last QR: that QR can no longer confirm a payment
            foreach ($pending as $stale) {
                $stale->update(['status' => 'superseded']);
                AuditService::log('upi_request_superseded', 'UpiPaymentRequest', $stale->id, null, ['status' => 'pending'], ['status' => 'superseded'], $by->id);
            }

            $attempt = UpiPaymentRequest::where('order_id', $locked->id)->count();
            $reference = $attempt === 0 ? $locked->order_number : $locked->order_number . '-' . ($attempt + 1);
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
