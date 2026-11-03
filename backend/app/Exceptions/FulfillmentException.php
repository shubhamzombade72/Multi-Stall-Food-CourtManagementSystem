<?php

namespace App\Exceptions;

use App\Models\StallTicketItem;
use App\Services\FulfillmentService;
use Illuminate\Http\JsonResponse;
use RuntimeException;

/**
 * A refused fulfilment change (403 role, 409 version conflict, 422 invalid transition).
 * Rendered as the API's usual {success:false, message, error, data?} envelope.
 */
class FulfillmentException extends RuntimeException
{
    public function __construct(
        public readonly int $httpStatus,
        public readonly string $errorCode,
        string $message,
        public readonly ?StallTicketItem $item = null,
    ) {
        parent::__construct($message);
    }

    public static function forbidden(string $message): self
    {
        return new self(403, 'forbidden', $message);
    }

    public static function invalid(string $message, ?StallTicketItem $item = null): self
    {
        return new self(422, 'invalid_transition', $message, $item);
    }

    public static function itemNotInOrder(string $message): self
    {
        return new self(422, 'item_not_in_order', $message);
    }

    public static function idempotencyKeyReused(): self
    {
        return new self(409, 'idempotency_key_reused', 'This request key was already used for a different set of items.');
    }

    public static function versionConflict(StallTicketItem $current): self
    {
        return new self(409, 'version_conflict', 'This item was changed by someone else. The latest state is shown.', $current);
    }

    public function render(): JsonResponse
    {
        $body = [
            'success' => false,
            'message' => $this->getMessage(),
            'error' => $this->errorCode,
        ];
        if ($this->item) {
            $body['data'] = ['item' => FulfillmentService::presentItem($this->item)];
        }

        return response()->json($body, $this->httpStatus);
    }
}
