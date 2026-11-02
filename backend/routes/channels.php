<?php

use App\Models\User;
use Illuminate\Support\Facades\Broadcast;

/*
| Private channel authorization (served at POST /api/broadcasting/auth behind auth:sanctum).
| The only public channel is orders.track.{trackingToken}: its name embeds the customer's
| unguessable tracking token and its payloads carry order status only.
*/

Broadcast::channel('App.Models.User.{id}', function (User $user, $id) {
    return (int) $user->id === (int) $id;
});

// Stall kitchen display: only that stall's kitchen staff / manager, or the owner
Broadcast::channel('stall.{stallId}', function (User $user, $stallId) {
    if ($user->isOwner()) {
        return true;
    }
    return ($user->isKitchenStaff() || $user->isStallManager())
        && (int) $user->stall_id === (int) $stallId;
});

// Ready-for-pickup alerts for floor staff
Broadcast::channel('waiters', function (User $user) {
    return $user->isWaiter() || $user->isOwner();
});

// Central billing counter: new orders, kitchen progress and payments
Broadcast::channel('cashier', function (User $user) {
    return $user->isCashier() || $user->isOwner();
});
