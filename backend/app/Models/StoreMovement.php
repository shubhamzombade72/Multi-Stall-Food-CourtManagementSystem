<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class StoreMovement extends Model
{
    public const OPENING = 'opening_stock';
    public const PURCHASE = 'purchase_inward';
    public const ISSUE = 'issue_to_stall';
    public const RETURN = 'return_from_stall';
    public const WASTE = 'waste_loss';
    public const COUNT = 'stock_count';

    /** The food court's calendar day. Timestamps are stored in UTC, and 00:00-05:30 in India would otherwise land on yesterday. */
    public const BUSINESS_TIMEZONE = 'Asia/Kolkata';

    protected $fillable = [
        'store_item_id', 'stall_id', 'movement_type', 'quantity', 'previous_stock', 'new_stock',
        'unit_cost', 'value', 'business_date', 'reference_id', 'performed_by_user_id', 'reason',
    ];

    protected $casts = [
        'quantity' => 'decimal:3',
        'previous_stock' => 'decimal:3',
        'new_stock' => 'decimal:3',
        'unit_cost' => 'decimal:2',
        'value' => 'decimal:2',
    ];

    public static function businessToday(): string
    {
        return now(self::BUSINESS_TIMEZONE)->toDateString();
    }

    public function item()
    {
        return $this->belongsTo(StoreItem::class, 'store_item_id');
    }

    public function stall()
    {
        return $this->belongsTo(Stall::class);
    }

    public function performedBy()
    {
        return $this->belongsTo(User::class, 'performed_by_user_id');
    }
}
