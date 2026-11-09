<?php

/**
 * Test-only worker for StallDeletionConcurrencyTest. Boots the real application in its own PHP process (so it has its own
 * PostgreSQL connection) and runs ONE real action, then prints a JSON line {"status":..., "body":...}.
 *
 *   php stall_concurrency_worker.php order      <bearer-token> <menu-item-id> <idempotency-key>
 *   php stall_concurrency_worker.php delete     <owner-user-id> <stall-id>
 *
 * The caller passes APP_ENV / DB_* in the environment. This file never runs outside the test suite.
 */

use App\Models\User;
use App\Services\BulkDeleteService;
use Illuminate\Contracts\Console\Kernel as ConsoleKernel;
use Illuminate\Contracts\Http\Kernel as HttpKernel;
use Illuminate\Http\Request;

require __DIR__ . '/../../vendor/autoload.php';

if (getenv('APP_ENV') !== 'testing') {
    fwrite(STDERR, "refusing to run outside APP_ENV=testing\n");
    exit(2);
}

$app = require __DIR__ . '/../../bootstrap/app.php';
$app->make(ConsoleKernel::class)->bootstrap();

$http = static function (string $method, string $uri, string $token, array $payload) use ($app): array {
    $request = Request::create($uri, $method, [], [], [], [
        'HTTP_AUTHORIZATION' => 'Bearer ' . $token, 'HTTP_ACCEPT' => 'application/json', 'CONTENT_TYPE' => 'application/json',
    ], json_encode($payload));
    $response = $app->make(HttpKernel::class)->handle($request);

    return ['status' => $response->getStatusCode(), 'body' => json_decode($response->getContent(), true)];
};

[, $action] = $argv + [null, ''];

switch ($action) {
    case 'order':
        [, , $token, $menuItemId, $key] = $argv;
        $out = $http('POST', '/api/orders', $token, [
            'order_type' => 'takeaway', 'idempotency_key' => $key, 'items' => [['menu_item_id' => (int) $menuItemId, 'quantity' => 1]],
        ]);
        break;
    case 'delete':
        [, , $ownerId, $stallId] = $argv;
        $out = ['status' => 200, 'body' => $app->make(BulkDeleteService::class)->deleteStalls([(int) $stallId], (int) $ownerId)];
        break;
    default:
        fwrite(STDERR, "unknown action\n");
        exit(2);
}

echo json_encode($out) . "\n";
