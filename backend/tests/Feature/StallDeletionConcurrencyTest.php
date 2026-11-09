<?php

namespace Tests\Feature;

use App\Models\MenuCategory;
use App\Models\MenuItem;
use App\Models\Stall;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use PDO;
use Symfony\Component\Process\Process;
use Tests\TestCase;

/**
 * REAL PostgreSQL concurrency: two database sessions and separate PHP processes, no mocks.
 * The test holds a row lock in its own raw PDO session (standing in for "a delete / deactivate / order is in flight"),
 * starts the real code in a child process, proves from pg_stat_activity that the child is WAITING on that lock, then
 * releases it and checks the outcome. Data is committed (no wrapping transaction) and removed again in tearDown.
 * Observations are appended to the evidence file named by STALL_CONCURRENCY_EVIDENCE (default: system temp dir).
 */
class StallDeletionConcurrencyTest extends TestCase
{
    private ?PDO $pdo = null;
    private array $stallIds = [];
    private array $orderKeys = [];
    private array $tokenIds = [];
    private string $evidence = '';

    protected function setUp(): void
    {
        parent::setUp();
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('PostgreSQL row locking can only be exercised on PostgreSQL.');
        }
        $this->evidence = getenv('STALL_CONCURRENCY_EVIDENCE') ?: sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'stall-concurrency-evidence.txt';
    }

    protected function tearDown(): void
    {
        if ($this->pdo && $this->pdo->inTransaction()) {
            $this->pdo->rollBack();
        }
        $this->pdo = null;
        if (DB::connection()->getDriverName() === 'pgsql') {
            foreach ($this->orderKeys as $key) {
                $ids = DB::table('orders')->where('idempotency_key', $key)->pluck('id');
                DB::table('stall_ticket_items')->whereIn('ticket_id', DB::table('stall_kitchen_tickets')->whereIn('order_id', $ids)->pluck('id'))->delete();
                DB::table('stall_kitchen_tickets')->whereIn('order_id', $ids)->delete();
                DB::table('order_items')->whereIn('order_id', $ids)->delete();
                DB::table('orders')->whereIn('id', $ids)->delete();
            }
            DB::table('personal_access_tokens')->whereIn('id', $this->tokenIds)->delete();
            DB::table('stalls')->whereIn('id', $this->stallIds)->delete(); // menu categories / items cascade
        }
        parent::tearDown();
    }

    private function log(string $line): void
    {
        file_put_contents($this->evidence, '[' . date('H:i:s') . '] ' . $this->name() . ': ' . $line . "\n", FILE_APPEND);
    }

    private function raw(): PDO
    {
        $c = config('database.connections.' . config('database.default'));

        return $this->pdo ??= new PDO(
            "pgsql:host={$c['host']};port={$c['port']};dbname={$c['database']}", $c['username'], $c['password'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION],
        );
    }

    private function committedStall(string $tag): array
    {
        $stall = Stall::create(['name' => "CC {$tag}", 'code' => 'CC-' . $tag . '-' . substr(uniqid(), -5), 'is_active' => true]);
        $this->stallIds[] = $stall->id;
        $cat = MenuCategory::create(['stall_id' => $stall->id, 'name' => 'Mains', 'display_order' => 1, 'is_active' => true]);
        $item = MenuItem::create(['stall_id' => $stall->id, 'category_id' => $cat->id, 'name' => "CC dish {$tag}", 'price' => 120]);

        return [$stall, $item];
    }

    private function tokenFor(string $role): array
    {
        $user = User::where('role', $role)->where('is_active', true)->firstOrFail();
        $token = $user->createToken('stall-concurrency');
        $this->tokenIds[] = $token->accessToken->id;

        return [$user, $token->plainTextToken];
    }

    /** Start the worker in a child PHP process with its own DB connection to the same test database. */
    private function worker(string ...$args): Process
    {
        $c = config('database.connections.' . config('database.default'));
        $p = new Process([PHP_BINARY, base_path('tests/Support/stall_concurrency_worker.php'), ...$args], base_path(), [
            'APP_ENV' => 'testing', 'DB_CONNECTION' => 'pgsql', 'DB_HOST' => $c['host'], 'DB_PORT' => (string) $c['port'],
            'DB_DATABASE' => $c['database'], 'DB_USERNAME' => $c['username'], 'DB_PASSWORD' => $c['password'], 'DB_URL' => '',
            'CACHE_STORE' => 'array', 'SESSION_DRIVER' => 'array', 'QUEUE_CONNECTION' => 'sync', 'BROADCAST_CONNECTION' => 'null',
            'PGAPPNAME' => self::WORKER_APP_NAME, // libpq reads this, so the worker's database session is identifiable in pg_stat_activity
        ]);
        $p->setTimeout(60);
        $p->start();

        return $p;
    }

    /** Wait until some other session of this database is blocked on a lock; returns that session's description. */
    private const WORKER_APP_NAME = 'stall-cc-worker';

    /**
     * Wait until a session of OUR worker (matched by application_name, not just "any session") is blocked on a lock, and
     * assert that the statement it is blocked on matches $expectedSql, so the test proves WHICH lock the code takes.
     */
    private function waitForLockWait(Process $p, string $expectedSql, int $seconds = 40): string
    {
        $deadline = microtime(true) + $seconds;
        while (microtime(true) < $deadline) {
            // pg_stat_activity is cached for the length of a transaction, and this session holds one open
            $this->raw()->query('select pg_stat_clear_snapshot()');
            $row = $this->raw()->query(
                "select pid, wait_event_type, wait_event, left(query, 160) q from pg_stat_activity
                 where datname = current_database() and application_name = '" . self::WORKER_APP_NAME . "'
                   and wait_event_type = 'Lock' and state = 'active' limit 1",
            )->fetch(PDO::FETCH_ASSOC);
            if ($row) {
                $desc = "pid {$row['pid']} waiting on {$row['wait_event_type']}/{$row['wait_event']}: {$row['q']}";
                $this->log($desc);
                $this->assertTrue($p->isRunning(), 'the blocked worker must still be running while the lock is held');
                $this->assertMatchesRegularExpression($expectedSql, $row['q'], 'the worker is blocked, but not on the statement this test is about');

                return $desc;
            }
            if (!$p->isRunning()) {
                break;
            }
            usleep(50_000);
        }
        $out = $p->getOutput() . $p->getErrorOutput();
        $p->stop(0);
        $this->fail('the worker never blocked on a row lock (it finished or timed out). Its output: ' . substr($out, 0, 400));
    }

    private function finish(Process $p): array
    {
        $p->wait();
        $lines = array_values(array_filter(explode("\n", trim($p->getOutput()))));
        $last = end($lines);
        $decoded = $last ? json_decode($last, true) : null;
        $this->assertIsArray($decoded, 'worker printed no result. stdout: ' . $p->getOutput() . ' stderr: ' . $p->getErrorOutput());
        $this->log('worker result status=' . $decoded['status']);

        return $decoded;
    }

    public function test_an_order_waits_for_an_in_flight_delete_and_is_then_refused_cleanly(): void
    {
        [$stall, $item] = $this->committedStall('DELORD');
        [, $token] = $this->tokenFor('cashier');
        $key = $this->orderKeys[] = 'cc-del-' . uniqid();

        $pdo = $this->raw();
        $pdo->beginTransaction();
        $pdo->exec("select id from stalls where id = {$stall->id} for update"); // the delete is in flight and holds the stall row

        $worker = $this->worker('order', $token, (string) $item->id, $key);
        $this->waitForLockWait($worker, '/from "stalls".*for share/is'); // the order's own shared lock on the stall waits for the delete

        $pdo->exec("delete from stalls where id = {$stall->id}"); // the delete finishes: stall, menu items cascade
        $pdo->commit();
        $result = $this->finish($worker);

        $this->assertSame(422, $result['status'], 'a clean refusal, not an FK/500 error: ' . json_encode($result['body']));
        $this->assertSame(0, DB::table('orders')->where('idempotency_key', $key)->count(), 'no half-written order');
        $this->assertSame(0, DB::table('order_items')->where('menu_item_id', $item->id)->count());
    }

    /**
     * Guards deleteStall itself: it queues behind work in flight and then refuses with the history kept. (The order's own
     * KEY SHARE foreign-key lock would also make this wait, so this test does not prove the order-side lock; the first and
     * third tests in this class do.)
     */
    public function test_a_delete_queues_behind_an_in_flight_order_and_is_then_refused_with_all_history_kept(): void
    {
        [$stall, $item] = $this->committedStall('ORDDEL');
        [$owner] = $this->tokenFor('owner');
        $key = $this->orderKeys[] = 'cc-ord-' . uniqid();

        $pdo = $this->raw();
        $pdo->beginTransaction();
        $pdo->exec("select id from stalls where id = {$stall->id} for share"); // the order is in flight: it holds a shared lock on the stall
        $pdo->prepare("insert into orders (uuid, order_number, order_type, order_channel, status, subtotal, tax_amount, discount_amount, total_amount, payment_status, idempotency_key, created_at, updated_at)
                       values (gen_random_uuid(),'CC-' || ?,'takeaway','cashier_pos','confirmed',120,0,0,120,'unpaid',?,now(),now())")->execute([$key, $key]);
        $orderId = (int) $pdo->query("select id from orders where idempotency_key = '{$key}'")->fetchColumn();
        $pdo->exec("insert into order_items (order_id, stall_id, menu_item_id, item_name, unit_price, quantity, subtotal, status, created_at, updated_at)
                    values ({$orderId}, {$stall->id}, {$item->id}, 'CC dish', 120, 1, 120, 'pending', now(), now())");

        $worker = $this->worker('delete', (string) $owner->id, (string) $stall->id);
        $this->waitForLockWait($worker, '/from "stalls".*for update/is');

        $pdo->commit(); // the order is placed
        $result = $this->finish($worker);

        $this->assertSame(1, $result['body']['summary']['failed']);
        $this->assertStringContainsString('order line', $result['body']['failed'][0]['reason']);
        $this->assertNotNull(Stall::find($stall->id), 'the stall survives');
        $this->assertSame(1, DB::table('order_items')->where('order_id', $orderId)->count(), 'the order line survives');
        $this->assertSame(1, DB::table('orders')->where('id', $orderId)->count());
    }

    public function test_an_order_waits_for_an_in_flight_deactivation_and_is_then_refused(): void
    {
        [$stall, $item] = $this->committedStall('DEACT');
        [, $token] = $this->tokenFor('cashier');
        $key = $this->orderKeys[] = 'cc-deact-' . uniqid();

        $pdo = $this->raw();
        $pdo->beginTransaction();
        $pdo->exec("update stalls set is_active = false where id = {$stall->id}"); // the owner is deactivating the stall right now

        $worker = $this->worker('order', $token, (string) $item->id, $key);
        $this->waitForLockWait($worker, '/from "stalls".*for share/is');

        $pdo->commit();
        $result = $this->finish($worker);

        $this->assertSame(422, $result['status'], json_encode($result['body']));
        $this->assertSame(0, DB::table('orders')->where('idempotency_key', $key)->count(), 'no order slipped in for the closed stall');
    }

    public function test_an_order_whose_dish_was_deleted_after_validation_is_refused_cleanly(): void
    {
        [$stall, $item] = $this->committedStall('GONE');
        [, $token] = $this->tokenFor('cashier');
        $key = $this->orderKeys[] = 'cc-gone-' . uniqid();

        // Freeze the worker AFTER request validation (which saw the dish) and BEFORE the transaction reads the menu: it stops on the
        // idempotency lookup against `orders`. Meanwhile the stall is deleted and its menu cascades away.
        $pdo = $this->raw();
        $pdo->beginTransaction();
        $pdo->exec('lock table orders in access exclusive mode');

        $worker = $this->worker('order', $token, (string) $item->id, $key);
        $this->waitForLockWait($worker, '/from "orders"/i');

        $pdo->exec("delete from stalls where id = {$stall->id}");
        $pdo->commit();
        $result = $this->finish($worker);

        $this->assertSame(422, $result['status'], 'a clean refusal instead of a 500: ' . json_encode($result['body']));
        $this->assertStringContainsString('no longer on the menu', json_encode($result['body']));
        $this->assertSame(0, DB::table('orders')->where('idempotency_key', $key)->count());
    }
}
