<?php

/**
 * Stand-alone worker for BillingConcurrencyTest: one POST /api/billing/pay through the real HTTP kernel, in its own PHP
 * process with its own database connection, so concurrent runs really contend for the same rows. Prints a JSON result.
 */

use App\Models\User;
use Illuminate\Http\Request;
use Laravel\Sanctum\Sanctum;

$root = dirname(__DIR__, 2);
require $root . '/vendor/autoload.php';
$app = require $root . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$a = json_decode($argv[1], true);

// Boot everything first, then wait: every worker hits the database at the same instant
Sanctum::actingAs(User::findOrFail($a['user_id']));
$http = $app->make(Illuminate\Contracts\Http\Kernel::class);
while (microtime(true) < $a['start_at']) {
    usleep(200);
}

$response = $http->handle(Request::create('/api/billing/pay', 'POST', [], [], [], [
    'HTTP_ACCEPT' => 'application/json',
    'CONTENT_TYPE' => 'application/json',
], json_encode($a['body'])));

echo json_encode(['status' => $response->getStatusCode(), 'body' => json_decode($response->getContent(), true)]);
