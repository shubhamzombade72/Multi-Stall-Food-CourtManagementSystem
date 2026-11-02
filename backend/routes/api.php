<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BillingController;
use App\Http\Controllers\Api\DiningTableController;
use App\Http\Controllers\Api\InventoryController;
use App\Http\Controllers\Api\KitchenController;
use App\Http\Controllers\Api\MenuController;
use App\Http\Controllers\Api\OrderController;
use App\Http\Controllers\Api\PurchaseController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\SettlementController;
use App\Http\Controllers\Api\StallController;
use App\Http\Controllers\Api\WaiterController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Public Routes (Customer QR Ordering & Authentication)
|--------------------------------------------------------------------------
*/
Route::prefix('auth')->group(function () {
    Route::post('/login', [AuthController::class, 'login']);
});

Route::prefix('public')->group(function () {
    Route::get('/stalls', [StallController::class, 'index']);
    Route::get('/tables', [DiningTableController::class, 'index']);
    Route::get('/qr/{qrToken}', [DiningTableController::class, 'showByQrToken']);
    Route::post('/orders', [OrderController::class, 'createOrder']);
    Route::get('/orders/{id}', [OrderController::class, 'show']);
});

/*
|--------------------------------------------------------------------------
| Authenticated Routes (Sanctum)
|--------------------------------------------------------------------------
*/
Route::middleware('auth:sanctum')->group(function () {
    // Auth & Profile
    Route::get('/auth/me', [AuthController::class, 'me']);
    Route::post('/auth/logout', [AuthController::class, 'logout']);

    // Stalls
    Route::get('/stalls', [StallController::class, 'index']);
    Route::post('/stalls', [StallController::class, 'store']);
    Route::get('/stalls/{id}', [StallController::class, 'show']);
    Route::put('/stalls/{id}', [StallController::class, 'update']);

    // Tables
    Route::get('/tables', [DiningTableController::class, 'index']);
    Route::post('/tables', [DiningTableController::class, 'store']);
    Route::put('/tables/{id}/status', [DiningTableController::class, 'updateStatus']);

    // Menu Management
    Route::get('/menu', [MenuController::class, 'index']);
    Route::post('/menu', [MenuController::class, 'store']);
    Route::put('/menu/{id}', [MenuController::class, 'update']);
    Route::post('/menu/{id}/toggle', [MenuController::class, 'toggleAvailability']);
    Route::get('/menu-categories', [MenuController::class, 'categories']);

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

    // Stall Purchases
    Route::get('/purchases', [PurchaseController::class, 'index']);
    Route::post('/purchases', [PurchaseController::class, 'store']);
    Route::post('/purchases/{id}/receive', [PurchaseController::class, 'receive']);

    // Stall Inventory & Stock Ledger
    Route::get('/inventory', [InventoryController::class, 'index']);
    Route::post('/inventory', [InventoryController::class, 'store']);
    Route::post('/inventory/{id}/adjust', [InventoryController::class, 'adjust']);
    Route::get('/inventory/movements', [InventoryController::class, 'movements']);

    // End-of-Day Closing & Stall Settlements
    Route::get('/settlements/daily-summary', [SettlementController::class, 'getDailySummary']);
    Route::post('/settlements/close-day', [SettlementController::class, 'closeDay']);
    Route::post('/settlements/{recordId}/pay', [SettlementController::class, 'recordSettlementPayment']);

    // Reports & Analytics
    Route::get('/reports/dashboard', [ReportController::class, 'dashboardStats']);
    Route::get('/reports/stall-sales', [ReportController::class, 'stallSalesReport']);
    Route::get('/reports/audit-logs', [ReportController::class, 'auditLogs']);
});
