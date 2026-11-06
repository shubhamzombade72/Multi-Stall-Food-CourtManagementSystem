<?php

namespace App\Providers;

use App\Models\DailyClosing;
use App\Models\MenuItem;
use App\Models\Order;
use App\Models\Payment;
use App\Models\PurchaseOrder;
use App\Models\StockMovement;
use App\Observers\DailyClosingObserver;
use App\Observers\MenuItemObserver;
use App\Observers\OrderObserver;
use App\Observers\PaymentObserver;
use App\Observers\PurchaseOrderObserver;
use App\Observers\StockMovementObserver;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        Order::observe(OrderObserver::class);
        Payment::observe(PaymentObserver::class);
        MenuItem::observe(MenuItemObserver::class);
        StockMovement::observe(StockMovementObserver::class);
        DailyClosing::observe(DailyClosingObserver::class);
        PurchaseOrder::observe(PurchaseOrderObserver::class);

        // Brute-force protection per account per device; staff sharing one counter PC do not lock each other out
        RateLimiter::for('login', function (Request $request) {
            return Limit::perMinute(5)->by(Str::lower((string) $request->input('email')) . '|' . $request->ip());
        });

        // Each sensitive route gets its OWN counter. Unnamed throttle:N,M middleware share one counter per IP/user,
        // so stacking them would let polling the status endpoint lock out owner recovery.
        RateLimiter::for('setup-status', fn (Request $request) => Limit::perMinute(60)->by('setup-status|' . $request->ip()));
        RateLimiter::for('setup-owner', fn (Request $request) => Limit::perMinute(10)->by('setup-owner|' . $request->ip()));
        RateLimiter::for('owner-recovery', fn (Request $request) => Limit::perMinute(5)->by('owner-recovery|' . $request->ip()));
        RateLimiter::for('recovery-key', fn (Request $request) => Limit::perMinute(5)->by('recovery-key|' . ($request->user()?->id ?? $request->ip())));
        RateLimiter::for('pairing-redeem', fn (Request $request) => Limit::perMinute(10)->by('pairing-redeem|' . $request->ip()));
        RateLimiter::for('pairing-codes', fn (Request $request) => Limit::perMinute(10)->by('pairing-codes|' . ($request->user()?->id ?? $request->ip())));
        RateLimiter::for('update-enroll', fn (Request $request) => Limit::perMinute(10)->by('update-enroll|' . $request->ip()));
        RateLimiter::for('update-device', fn (Request $request) => Limit::perMinute(300)->by('update-device|' . ($request->header('X-Update-Device') ?: $request->ip())));
        RateLimiter::for('system-ready', fn (Request $request) => Limit::perMinute(120)->by('system-ready|' . $request->ip()));

        // Public QR ordering: flood control per table, plus a ceiling per source IP that still allows a
        // whole food court of phones behind one NAT/guest Wi-Fi gateway at peak hour.
        RateLimiter::for('public-orders', function (Request $request) {
            return [
                Limit::perMinute(20)->by('qr|' . (string) $request->input('qr_token')),
                Limit::perMinute(300)->by('ip|' . $request->ip()),
            ];
        });
    }
}
