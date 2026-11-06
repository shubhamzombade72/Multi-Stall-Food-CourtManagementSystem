<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BillingController;
use App\Http\Controllers\Api\BulkDeleteController;
use App\Http\Controllers\Api\CustomerController;
use App\Http\Controllers\Api\DiningTableController;
use App\Http\Controllers\Api\FulfillmentController;
use App\Http\Controllers\Api\InventoryController;
use App\Http\Controllers\Api\KitchenController;
use App\Http\Controllers\Api\MenuController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\OrderController;
use App\Http\Controllers\Api\PairingController;
use App\Http\Controllers\Api\PayoutController;
use App\Http\Controllers\Api\StallOwnerController;
use App\Http\Controllers\Api\PurchaseController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\SettingsController;
use App\Http\Controllers\Api\SetupController;
use App\Http\Controllers\Api\SettlementController;
use App\Http\Controllers\Api\StaffController;
use App\Http\Controllers\Api\StallController;
use App\Http\Controllers\Api\SystemController;
use App\Http\Controllers\Api\UpdateAdminController;
use App\Http\Controllers\Api\UpdateClientController;
use App\Http\Controllers\Api\WaiterController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Public Routes (Customer QR Ordering & Authentication)
|--------------------------------------------------------------------------
*/
Route::prefix('auth')->group(function () {
    Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:login');
});

// Desktop built-in server only (config/foodcourt.php); 404 everywhere else
// Each route has its own named limiter: stacked unnamed throttles would share one counter per IP
Route::prefix('setup')->group(function () {
    Route::get('/status', [SetupController::class, 'status'])->middleware('throttle:setup-status');
    Route::post('/owner', [SetupController::class, 'createOwner'])->middleware('throttle:setup-owner');
    Route::post('/recover', [SetupController::class, 'recover'])->middleware('throttle:owner-recovery');
});

// Multi-PC: a terminal redeems the owner's one-time code (shared host only; 404 on a built-in server)
Route::post('/pairing/redeem', [PairingController::class, 'redeem'])->middleware('throttle:pairing-redeem');

// Readiness for the desktop app and monitors: booleans only
Route::get('/system/ready', [SystemController::class, 'ready'])->middleware('throttle:system-ready');
Route::get('/system/compat', [SystemController::class, 'compat'])->middleware('throttle:system-ready');

/*
|--------------------------------------------------------------------------
| Update service (404 unless FOODCOURT_UPDATE_SERVICE=true; never on a PC's built-in server)
|--------------------------------------------------------------------------
*/
Route::middleware('update.service')->group(function () {
    Route::post('/updates/client/enroll', [UpdateClientController::class, 'enroll'])->middleware('throttle:update-enroll');

    Route::middleware(['update.device', 'throttle:update-device'])->prefix('updates/client')->group(function () {
        Route::post('/check', [UpdateClientController::class, 'check']);
        Route::get('/history', [UpdateClientController::class, 'history']);
        Route::get('/targets/{id}/release', [UpdateClientController::class, 'release'])->whereNumber('id');
        Route::post('/targets/{id}/decision', [UpdateClientController::class, 'decide'])->whereNumber('id');
        Route::post('/targets/{id}/download-token', [UpdateClientController::class, 'downloadToken'])->whereNumber('id');
        Route::post('/targets/{id}/status', [UpdateClientController::class, 'status'])->whereNumber('id');
        Route::get('/download/{token}', [UpdateClientController::class, 'download'])->where('token', '[A-Za-z0-9]{64}');
    });

    Route::middleware(['auth:sanctum', 'active'])->prefix('update-admin')->group(function () {
        Route::get('/releases', [UpdateAdminController::class, 'releases']);
        Route::post('/releases', [UpdateAdminController::class, 'createRelease']);
        Route::put('/releases/{id}', [UpdateAdminController::class, 'updateRelease'])->whereNumber('id');
        Route::post('/releases/{id}/packages', [UpdateAdminController::class, 'addPackage'])->whereNumber('id');
        Route::put('/releases/{id}/packages/{packageId}/payload', [UpdateAdminController::class, 'uploadPayload'])->whereNumber('id')->whereNumber('packageId');
        Route::post('/releases/{id}/publish', [UpdateAdminController::class, 'publish'])->whereNumber('id');
        Route::post('/releases/{id}/unpublish', [UpdateAdminController::class, 'unpublish'])->whereNumber('id');
        Route::get('/clients', [UpdateAdminController::class, 'clients']);
        Route::post('/enrollment-codes', [UpdateAdminController::class, 'createEnrollmentCode']);
        Route::put('/clients/{id}', [UpdateAdminController::class, 'updateClient'])->whereNumber('id');
        Route::get('/deployments', [UpdateAdminController::class, 'deployments']);
        Route::post('/deployments', [UpdateAdminController::class, 'createDeployment']);
        Route::get('/deployments/{id}', [UpdateAdminController::class, 'showDeployment'])->whereNumber('id');
        Route::post('/deployments/{id}/cancel', [UpdateAdminController::class, 'cancelDeployment'])->whereNumber('id');
        Route::get('/monitoring', [UpdateAdminController::class, 'monitoring']);
    });
});

Route::prefix('public')->group(function () {
    Route::get('/stalls', [StallController::class, 'index']);
    Route::get('/tax', [SettingsController::class, 'publicTax']);
    Route::get('/tables', [DiningTableController::class, 'index']);
    Route::get('/qr/{qrToken}', [DiningTableController::class, 'showByQrToken']);
    Route::post('/orders', [OrderController::class, 'createOrder'])->middleware('throttle:public-orders');
    Route::get('/orders/track/{trackingToken}', [OrderController::class, 'trackOrder'])->middleware('throttle:60,1');
    Route::get('/menu-images/{file}', [MenuController::class, 'showImage'])->middleware('throttle:240,1');
});

/*
|--------------------------------------------------------------------------
| Authenticated Routes (Sanctum)
|--------------------------------------------------------------------------
*/
Route::middleware(['auth:sanctum', 'active'])->group(function () {
    // Auth & Profile
    Route::get('/auth/me', [AuthController::class, 'me']);
    Route::post('/setup/recovery-key', [SetupController::class, 'issueRecoveryKey'])->middleware('throttle:recovery-key');

    // Multi-PC pairing (owner)
    Route::post('/pairing/codes', [PairingController::class, 'createCode'])->middleware('throttle:pairing-codes');
    Route::get('/pairing/devices', [PairingController::class, 'devices']);
    Route::delete('/pairing/devices/{id}', [PairingController::class, 'revoke']);
    Route::post('/auth/logout', [AuthController::class, 'logout']);

    // Stalls
    Route::get('/stalls', [StallController::class, 'index']);
    Route::post('/stalls', [StallController::class, 'store']);
    Route::post('/stalls/bulk-delete', [BulkDeleteController::class, 'stalls'])->middleware('throttle:60,1');
    Route::get('/stalls/{id}', [StallController::class, 'show']);
    Route::put('/stalls/{id}', [StallController::class, 'update']);

    // Tables & floor sections
    Route::get('/tables', [DiningTableController::class, 'index']);
    Route::get('/tables/sections', [DiningTableController::class, 'sections']);
    Route::post('/tables', [DiningTableController::class, 'store']);
    Route::put('/tables/{id}', [DiningTableController::class, 'update']);
    Route::put('/tables/{id}/status', [DiningTableController::class, 'updateStatus']);

    // Food court settings (read: any signed-in user; write: owner)
    Route::get('/settings', [SettingsController::class, 'index']);
    Route::post('/settings/upi/test-qr', [SettingsController::class, 'upiTestQr']);
    Route::post('/settings/upi/test-confirmed', [SettingsController::class, 'upiTestConfirmed']);
    Route::put('/settings/{key}', [SettingsController::class, 'update']);

    // Customers (owner + cashier)
    Route::get('/customers', [CustomerController::class, 'index']);
    Route::get('/customers/lookup', [CustomerController::class, 'lookup']);
    Route::post('/customers', [CustomerController::class, 'store']);
    Route::get('/customers/{id}', [CustomerController::class, 'show']);
    Route::put('/customers/{id}', [CustomerController::class, 'update']);

    // Notifications feed (role and stall filtered)
    Route::get('/notifications', [NotificationController::class, 'index']);

    // Menu Management
    Route::get('/menu', [MenuController::class, 'index']);
    Route::post('/menu', [MenuController::class, 'store']);
    Route::post('/menu/bulk-delete', [BulkDeleteController::class, 'menuItems'])->middleware('throttle:60,1');
    Route::put('/menu/{id}', [MenuController::class, 'update']);
    Route::post('/menu/{id}/toggle', [MenuController::class, 'toggleAvailability']);
    Route::get('/menu-categories', [MenuController::class, 'categories']);
    Route::post('/menu-categories', [MenuController::class, 'storeCategory']);
    Route::put('/menu-categories/{id}', [MenuController::class, 'updateCategory']);
    Route::post('/menu/{id}/image', [MenuController::class, 'uploadImage']);

    // Staff & Permissions (owner only)
    Route::get('/staff', [StaffController::class, 'index']);
    Route::post('/staff', [StaffController::class, 'store']);
    Route::put('/staff/{id}', [StaffController::class, 'update']);
    Route::post('/staff/{id}/reset-password', [StaffController::class, 'resetPassword']);

    // Order Pipeline
    Route::get('/orders', [OrderController::class, 'index']);
    Route::post('/orders', [OrderController::class, 'createOrder']);
    Route::get('/orders/board', [FulfillmentController::class, 'board']);
    Route::get('/orders/{id}', [OrderController::class, 'show']);
    Route::post('/orders/{id}/serve-remaining', [FulfillmentController::class, 'serveRemaining'])->whereNumber('id');
    Route::post('/orders/{id}/cancel', [OrderController::class, 'cancelOrder']);


    // Waiter Android Workflows
    Route::get('/waiter/tables', [WaiterController::class, 'getActiveTables']);
    Route::get('/waiter/ready-tickets', [WaiterController::class, 'getReadyTickets']);
    Route::post('/waiter/tickets/{id}/served', [WaiterController::class, 'markTicketServed']);

    // Item-level fulfilment (single writer: FulfillmentService)
    Route::patch('/ticket-items/{id}/status', [FulfillmentController::class, 'updateItemStatus'])->whereNumber('id');
    Route::patch('/ticket-items/{id}/quantity', [FulfillmentController::class, 'updateItemQuantity'])->whereNumber('id');
    Route::post('/orders/{id}/items', [FulfillmentController::class, 'addItem'])->whereNumber('id');

    // Cashier POS & Billing
    Route::get('/billing/pending', [BillingController::class, 'getPendingBills']);
    Route::get('/billing/orders/{orderId}/open', [BillingController::class, 'openBill'])->whereNumber('orderId');
    Route::post('/billing/pay', [BillingController::class, 'processPayment']);
    Route::get('/billing/receipt/{orderId}', [BillingController::class, 'getOrderReceipt']);
    Route::post('/billing/orders/{orderId}/upi-request', [BillingController::class, 'upiRequest'])->whereNumber('orderId');
    Route::post('/billing/upi-requests/{reference}/status', [BillingController::class, 'upiRequestStatus'])->where('reference', '[A-Za-z0-9._-]{1,40}');
    Route::get('/billing/payments', [BillingController::class, 'paymentHistory']);

    // Stall Purchases
    Route::get('/purchases', [PurchaseController::class, 'index']);
    Route::post('/purchases', [PurchaseController::class, 'store']);
    Route::post('/purchases/{id}/receive', [PurchaseController::class, 'receive']);
    Route::get('/suppliers', [PurchaseController::class, 'suppliers']);
    Route::post('/suppliers', [PurchaseController::class, 'storeSupplier']);
    Route::get('/suppliers/{id}', [PurchaseController::class, 'showSupplier']);
    Route::put('/suppliers/{id}', [PurchaseController::class, 'updateSupplier']);

    // Stall Inventory & Stock Ledger
    Route::get('/inventory', [InventoryController::class, 'index']);
    Route::post('/inventory', [InventoryController::class, 'store']);
    Route::post('/inventory/{id}/adjust', [InventoryController::class, 'adjust']);
    Route::post('/inventory/{id}/stock-out', [InventoryController::class, 'stockOut']);
    Route::get('/inventory/movements', [InventoryController::class, 'movements']);

    // End-of-Day Closing & Stall Settlements
    Route::get('/settlements/daily-summary', [SettlementController::class, 'getDailySummary']);
    Route::get('/settlements/stall-bills', [SettlementController::class, 'stallBills']);
    Route::post('/settlements/close-day', [SettlementController::class, 'closeDay']);
    Route::get('/settlements/closings', [SettlementController::class, 'closings']);
    Route::post('/settlements/{recordId}/pay', [SettlementController::class, 'recordSettlementPayment'])->whereNumber('recordId');

    // Payout ledger: permanent payout transactions, history, owner-wise consolidated payouts, reconciliation (owner only)
    Route::get('/settlements/payouts', [PayoutController::class, 'history']);
    Route::get('/settlements/payouts/{id}', [PayoutController::class, 'show'])->whereNumber('id');
    Route::get('/settlements/payouts/{id}/receipt', [PayoutController::class, 'receipt'])->whereNumber('id');
    Route::post('/settlements/payouts/{id}/reverse', [PayoutController::class, 'reverse'])->whereNumber('id');
    Route::get('/settlements/owners', [PayoutController::class, 'owners']);
    Route::get('/settlements/owners/{ownerId}/outstanding', [PayoutController::class, 'ownerOutstanding'])->whereNumber('ownerId');
    Route::post('/settlements/owners/{ownerId}/payouts', [PayoutController::class, 'storeConsolidated'])->whereNumber('ownerId');
    Route::get('/settlements/consolidated-payouts/{id}', [PayoutController::class, 'showConsolidated'])->whereNumber('id');
    Route::post('/settlements/consolidated-payouts/{id}/reverse', [PayoutController::class, 'reverseConsolidated'])->whereNumber('id');
    Route::get('/settlements/reconciliation', [PayoutController::class, 'reconciliation']);
    Route::get('/settlements/{recordId}/payouts', [PayoutController::class, 'settlementDetail'])->whereNumber('recordId');
    Route::post('/settlements/{recordId}/payouts', [PayoutController::class, 'store'])->whereNumber('recordId');
    Route::post('/settlements/{recordId}/adjustments', [PayoutController::class, 'adjust'])->whereNumber('recordId');

    // Who owns which stall (settlement money is paid to the owner)
    Route::get('/stall-owners', [StallOwnerController::class, 'index']);
    Route::post('/stall-owners', [StallOwnerController::class, 'store']);
    Route::put('/stall-owners/{id}', [StallOwnerController::class, 'update'])->whereNumber('id');

    // Reports & Analytics
    Route::get('/reports/dashboard', [ReportController::class, 'dashboardStats']);
    Route::get('/reports/stall-sales', [ReportController::class, 'stallSalesReport']);
    Route::get('/reports/audit-logs', [ReportController::class, 'auditLogs']);
    Route::get('/reports/cashier-activity', [ReportController::class, 'cashierActivity']);
    Route::get('/reports/menu-performance', [ReportController::class, 'menuPerformance']);
    Route::get('/reports/sales-summary', [ReportController::class, 'salesSummary']);
    Route::get('/reports/payment-summary', [ReportController::class, 'paymentSummary']);
    Route::get('/reports/purchases', [ReportController::class, 'purchaseReport']);
    Route::get('/reports/inventory', [ReportController::class, 'inventoryReport']);
    Route::get('/reports/staff-activity', [ReportController::class, 'staffActivity']);
});
