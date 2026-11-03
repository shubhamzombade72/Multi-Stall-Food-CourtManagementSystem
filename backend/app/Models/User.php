<?php

namespace App\Models;

use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable;

    protected $fillable = [
        'name',
        'email',
        'password',
        'role',
        'stall_id',
        'phone',
        'is_active',
    ];

    protected $hidden = [
        'password',
        'remember_token',
    ];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'is_active' => 'boolean',
        ];
    }

    /** Emails are matched case-insensitively; new ones are stored lower-case and without stray spaces. */
    protected function email(): Attribute
    {
        return Attribute::make(set: fn ($value) => $value === null ? null : mb_strtolower(trim($value)));
    }

    public function stall()
    {
        return $this->belongsTo(Stall::class);
    }

    public function isOwner(): bool
    {
        return $this->role === 'owner';
    }

    public function isCashier(): bool
    {
        return $this->role === 'cashier';
    }

    public function isStallManager(): bool
    {
        return $this->role === 'stall_manager';
    }

    public function isKitchenStaff(): bool
    {
        return $this->role === 'kitchen_staff';
    }

    public function isWaiter(): bool
    {
        return $this->role === 'waiter';
    }

    public function isStoreStaff(): bool
    {
        return $this->role === 'store_staff';
    }
}
