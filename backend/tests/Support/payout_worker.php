<?php

/**
 * Stand-alone worker for the process-level payout tests. Each invocation is a separate PHP process with its own database
 * connection, so concurrent runs really contend for the same rows (and "restart" really starts from a cold application).
 *
 *   php payout_worker.php '{"mode":"pay", ...}'      records one payout, prints a JSON result
 *   php payout_worker.php '{"mode":"history", ...}'  reads settlement + payout history through the real HTTP kernel
 */

use App\Models\User;
use App\Services\PayoutException;
use App\Services\PayoutService;
use Illuminate\Http\Request;
use Laravel\Sanctum\Sanctum;

$root = dirname(__DIR__, 2);
require $root . '/vendor/autoload.php';
$app = require $root . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$a = json_decode($argv[1], true);

// Barrier: every worker waits for the same instant so they hit the database together
while (isset($a['start_at']) && microtime(true) < $a['start_at']) {
    usleep(200);
}

$user = User::findOrFail($a['user_id']);

if ($a['mode'] === 'pay') {
    try {
        [$payout, $duplicate] = app(PayoutService::class)->record($user, $a['settlement_id'], [
            'amount' => $a['amount'],
            'payment_method' => 'cash',
            'idempotency_key' => $a['key'],
            'received_by' => 'Worker',
        ]);
        echo json_encode(['ok' => true, 'duplicate' => $duplicate, 'payout_id' => $payout->id]);
    } catch (PayoutException $e) {
        echo json_encode(['ok' => false, 'status' => $e->status, 'message' => $e->getMessage()]);
    }
    exit(0);
}

if ($a['mode'] === 'history') {
    Sanctum::actingAs($user);
    $http = $app->make(Illuminate\Contracts\Http\Kernel::class);
    $get = function (string $uri) use ($http) {
        $res = $http->handle(Request::create($uri, 'GET', [], [], [], ['HTTP_ACCEPT' => 'application/json']));

        return json_decode($res->getContent(), true);
    };

    echo json_encode([
        'history' => $get('/api/settlements/payouts?stall_id=' . $a['stall_id']),
        'detail' => $get('/api/settlements/' . $a['settlement_id'] . '/payouts'),
        'reconciliation' => $get('/api/settlements/reconciliation?date_from=' . $a['date'] . '&date_to=' . $a['date']),
    ]);
    exit(0);
}

fwrite(STDERR, "unknown mode\n");
exit(2);
