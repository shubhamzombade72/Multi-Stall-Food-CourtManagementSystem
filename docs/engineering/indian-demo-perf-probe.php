<?php
// Measures query count / time / payload per endpoint, in-process, against whatever DB_DATABASE is set (demo DB only).
$base = 'D:/New folder/Multi-Stall-Food-CourtManagementSystem/backend';
require $base . '/vendor/autoload.php';
$app = require $base . '/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
$kernel->bootstrap();
if (!preg_match('/demo/i', config('database.connections.' . config('database.default') . '.database'))) {
    exit("refusing: not the demo DB\n");
}
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

$owner = App\Models\User::where('email', 'owner@demo.example.test')->first();
$token = $owner->createToken('perf')->plainTextToken;
$stall = DB::table('stalls')->where('code', 'DM-014')->value('id');
$endpoints = [
    'stalls (owner, include inactive)' => '/api/stalls?include_inactive=1',
    'menu (all dishes)' => '/api/menu',
    'menu (POS: available only)' => '/api/menu?available_only=1',
    'menu (one stall)' => "/api/menu?stall_id={$stall}",
    'tables (500)' => '/api/tables',
    'order board (live orders)' => '/api/orders/board',
    'orders list (page 1 of 100)' => '/api/orders?per_page=20',
    'kitchen tickets (one stall)' => "/api/kitchen/tickets?stall_id={$stall}",
    'dashboard stats' => '/api/reports/dashboard',
    'sales summary' => '/api/reports/sales-summary',
    'stall sales report' => '/api/reports/stall-sales',
    'menu performance report' => '/api/reports/menu-performance',
    'inventory (all stalls)' => '/api/inventory',
    'purchases (all stalls)' => '/api/purchases',
    'suppliers (100)' => '/api/suppliers',
    'customers' => '/api/customers',
    'payments history' => '/api/payments',
];
$results = [];
foreach ($endpoints as $name => $uri) {
    $times = [];
    $queries = 0;
    $dbMs = 0;
    $bytes = 0;
    $status = 0;
    $dupes = [];
    for ($i = 0; $i < 5; $i++) {
        $log = [];
        DB::flushQueryLog();
        DB::enableQueryLog();
        $t = microtime(true);
        $req = Request::create($uri, 'GET', [], [], [], ['HTTP_ACCEPT' => 'application/json', 'HTTP_AUTHORIZATION' => 'Bearer ' . $token]);
        $res = $kernel->handle($req);
        $times[] = (microtime(true) - $t) * 1000;
        $log = DB::getQueryLog();
        DB::disableQueryLog();
        $status = $res->getStatusCode();
        $bytes = strlen($res->getContent());
        $queries = count($log);
        $dbMs = array_sum(array_column($log, 'time'));
        $norm = [];
        foreach ($log as $q) {
            $k = preg_replace('/\b\d+\b|\'[^\']*\'/', '?', preg_replace('/in \([^)]*\)/', 'in (?)', $q['query']));
            $norm[$k] = ($norm[$k] ?? 0) + 1;
        }
        arsort($norm);
        $dupes = array_filter($norm, fn ($n) => $n >= 10);
        $kernel->terminate($req, $res);
        app('auth')->forgetGuards();
    }
    sort($times);
    $results[$name] = ['status' => $status, 'queries' => $queries, 'db_ms' => round($dbMs, 1), 'median_ms' => round($times[2], 1), 'kb' => round($bytes / 1024, 1), 'repeated_queries(>=10x)' => count($dupes) ? array_map(fn ($n, $k) => "{$n}x " . substr($k, 0, 110), $dupes, array_keys($dupes)) : []];
}
$owner->tokens()->where('name', 'perf')->delete();
echo json_encode($results, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n";
