<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BillingController;
use App\Http\Controllers\Api\CashierClosingController;
use App\Http\Controllers\Api\CustomerController;
use App\Http\Controllers\Api\DiningTableController;
use App\Http\Controllers\Api\InventoryController;
use App\Http\Controllers\Api\KitchenController;
use App\Http\Controllers\Api\MenuController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\OrderController;
use App\Http\Controllers\Api\PurchaseController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\SettingsController;
use App\Http\Controllers\Api\SetupController;
use App\Http\Controllers\Api\SettlementController;
use App\Http\Controllers\Api\StaffController;
use App\Http\Controllers\Api\StallController;
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
Route::prefix('setup')->middleware('throttle:10,1')->group(function () {
    Route::get('/status', [SetupController::class, 'status']);
    Route::post('/owner', [SetupController::class, 'createOwner']);
});

Route::prefix('public')->group(function () {
    Route::get('/stalls', [StallController::class, 'index']);
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
    Route::post('/auth/logout', [AuthController::class, 'logout']);

    // Stalls
    Route::get('/stalls', [StallController::class, 'index']);
    Route::post('/stalls', [StallController::class, 'store']);
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
    Route::get('/orders/{id}', [OrderController::class, 'show']);
    Route::post('/orders/{id}/cancel', [OrderController::class, 'cancelOrder']);

    // Kitchen Display System (KDS)
    Route::get('/kitchen/tickets', [KitchenController::class, 'getTickets']);
    Route::put('/kitchen/tickets/{id}/status', [KitchenController::class, 'updateTicketStatus']);

    // Waiter Android Workflows
    Route::get('/waiter/tables', [WaiterController::class, 'getActiveTables']);
    Route::get('/waiter/ready-tickets', [WaiterController::class, 'getReadyTickets']);
    Route::post('/waiter/tickets/{id}/served', [WaiterController::class, 'markTicketServed']);

    // Cashier POS & Billing
    Route::get('/billing/pending', [BillingController::class, 'getPendingBills']);
    Route::post('/billing/pay', [BillingController::class, 'processPayment']);
    Route::get('/billing/receipt/{orderId}', [BillingController::class, 'getOrderReceipt']);
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
    Route::post('/settlements/close-day', [SettlementController::class, 'closeDay']);
    Route::get('/settlements/closings', [SettlementController::class, 'closings']);
    Route::post('/settlements/{recordId}/pay', [SettlementController::class, 'recordSettlementPayment']);

    // Cashier-wise closing (cash count against the cashier's own cash payments)
    Route::get('/cashier-closings', [CashierClosingController::class, 'index']);
    Route::get('/cashier-closings/preview', [CashierClosingController::class, 'preview']);
    Route::post('/cashier-closings', [CashierClosingController::class, 'store']);

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
