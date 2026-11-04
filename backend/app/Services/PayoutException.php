<?php

namespace App\Services;

use RuntimeException;

/** A business-rule refusal from the payout ledger, carrying the HTTP status the API should answer with. */
class PayoutException extends RuntimeException
{
    public function __construct(string $message, public readonly int $status = 422)
    {
        parent::__construct($message);
    }
}
