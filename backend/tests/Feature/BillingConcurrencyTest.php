<?php

namespace Tests\Feature;

use App\Models\MenuItem;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\StallKitchenTicket;
use App\Models\StallTicketItem;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Tests\Concerns\ServesOrders;
use Tests\TestCase;

/**
 * Billing races that an in-process test cannot prove: separate PHP processes with separate database connections.
 * PostgreSQL only: SQLite has no row locks, and the embedded single-PC server handles one request at a time.
 *
 * These tests COMMIT their data (the workers must see it) and delete every row they created in tearDown.
 */
class BillingConcurrencyTest extends TestCase
{
    use ServesOrders;

    /** @var int[] */
    private array $orderIds = [];

    protected function setUp(): void
    {
        parent::setUp();
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('Row-level concurrency is verified on PostgreSQL only.');
        }
    }

    protected function tearDown(): void
    {
        if ($this->orderIds) {
            $paymentIds = DB::table('payments')->whereIn('order_id', $this->orderIds)->pluck('id');
            DB::table('payment_allocations')->whereIn('payment_id', $paymentIds)->delete();
            DB::table('payments')->whereIn('id', $paymentIds)->delete();
            $ticketIds = DB::table('stall_kitchen_tickets')->whereIn('order_id', $this->orderIds)->pluck('id');
            DB::table('stall_ticket_items')->whereIn('ticket_id', $ticketIds)->delete();
            DB::table('stall_kitchen_tickets')->whereIn('id', $ticketIds)->delete();
            DB::table('order_items')->whereIn('order_id', $this->orderIds)->delete();
            DB::table('orders')->whereIn('id', $this->orderIds)->delete();
        }
        parent::tearDown();
    }

    private function committedOrder(): Order
    {
        $menu = MenuItem::where('is_available', true)->whereHas('stall', fn ($q) => $q->where('is_active', true))->firstOrFail();
        $id = $this->actingAs($this->cashier(), 'sanctum')
            ->postJson('/api/orders', ['order_type' => 'takeaway', 'items' => [['menu_item_id' => $menu->id, 'quantity' => 1]]])
            ->assertCreated()->json('data.id');
        $this->orderIds[] = $id;

        return Order::findOrFail($id);
    }

    private function cashier(): User
    {
        return User::where('role', 'cashier')->where('is_active', true)->firstOrFail();
    }

    /** @return array<int, array> resource + pipes per started worker */
    private function startWorkers(Order $order, int $count, float $startAt): array
    {
        $script = base_path('tests/Support/billing_worker.php');
        $env = array_merge(getenv(), ['APP_ENV' => 'testing']);
        $job = json_encode([
            'start_at' => $startAt,
            'user_id' => $this->cashier()->id,
            'body' => ['order_id' => $order->id, 'payment_method' => 'cash', 'amount' => (string) $order->total_amount],
        ]);

        $running = [];
        for ($i = 0; $i < $count; $i++) {
            $proc = proc_open([PHP_BINARY, $script, $job], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, base_path(), $env);
            $this->assertIsResource($proc);
            $running[] = [$proc, $pipes];
        }

        return $running;
    }

    /** @return array<int, array> */
    private function collect(array $running): array
    {
        $results = [];
        foreach ($running as [$proc, $pipes]) {
            $out = stream_get_contents($pipes[1]);
            $err = stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            proc_close($proc);
            $decoded = json_decode($out, true);
            $this->assertIsArray($decoded, "worker produced no JSON. stdout: {$out} stderr: {$err}");
            $results[] = $decoded;
        }

        return $results;
    }

    public function test_simultaneous_payment_requests_create_exactly_one_payment(): void
    {
        $order = $this->committedOrder();
        $this->serveAllItems($order);

        $results = $this->collect($this->startWorkers($order, 6, microtime(true) + 3.0));

        $statuses = array_column($results, 'status');
        sort($statuses);
        $this->assertSame([200, 422, 422, 422, 422, 422], $statuses, json_encode($results));
        foreach ($results as $r) {
            if ($r['status'] === 422) {
                $this->assertSame('This order has already been paid in full.', $r['body']['message']);
            }
        }
        $this->assertSame(1, Payment::where('order_id', $order->id)->count());
        $this->assertSame('paid', $order->fresh()->payment_status);
    }

    /**
     * The kitchen and the cashier collide: a kitchen-side write holds the order lock with an uncommitted new pending item
     * while the payment arrives. The payment must wait for the lock, then see the committed item and refuse.
     */
    public function test_a_payment_racing_a_fulfilment_change_waits_and_validates_the_latest_items(): void
    {
        $order = $this->committedOrder();
        $this->serveAllItems($order);

        $running = null;
        DB::transaction(function () use ($order, &$running) {
            Order::whereKey($order->id)->lockForUpdate()->firstOrFail();

            $start = microtime(true) + 2.5;
            $running = $this->startWorkers($order, 1, $start);
            usleep((int) ((($start + 1.5) - microtime(true)) * 1_000_000)); // the worker is now blocked on the row lock

            $menu = MenuItem::where('is_available', true)->firstOrFail();
            $line = OrderItem::create(['order_id' => $order->id, 'stall_id' => $menu->stall_id, 'menu_item_id' => $menu->id, 'item_name' => $menu->name, 'unit_price' => $menu->price, 'quantity' => 1, 'subtotal' => $menu->price, 'status' => 'pending']);
            $ticket = StallKitchenTicket::create(['order_id' => $order->id, 'stall_id' => $menu->stall_id, 'status' => 'pending']);
            StallTicketItem::create(['ticket_id' => $ticket->id, 'order_item_id' => $line->id, 'quantity' => 1, 'status' => 'pending', 'version' => 1]);
        });

        [$result] = $this->collect($running);

        $this->assertSame(422, $result['status'], json_encode($result));
        $this->assertSame('billing_not_eligible', $result['body']['error']);
        $this->assertSame(0, Payment::where('order_id', $order->id)->count());
        $this->assertSame('unpaid', $order->fresh()->payment_status);
    }
}
