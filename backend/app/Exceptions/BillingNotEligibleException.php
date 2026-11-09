<?php

namespace App\Exceptions;

use App\Models\Order;
use Illuminate\Http\JsonResponse;
use RuntimeException;

/** A billing request refused because the order is not fully served or cancelled (no invoice, no payment, no state change). */
class BillingNotEligibleException extends RuntimeException
{
    public function __construct(private readonly Order $order, private readonly array $evaluation)
    {
        parent::__construct((string) $evaluation['message']);
    }

    public function render(): JsonResponse
    {
        return response()->json([
            'success' => false,
            'message' => $this->getMessage(),
            'error' => 'billing_not_eligible',
            'data' => [
                'order_id' => $this->order->id,
                'order_number' => $this->order->order_number,
                'outstanding_items' => $this->evaluation['outstanding_items'],
            ],
        ], 422);
    }
}
