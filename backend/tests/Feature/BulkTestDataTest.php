<?php

namespace Tests\Feature;

use App\Models\MenuCategory;
use App\Models\MenuItem;
use App\Models\Stall;
use App\Services\TestData\BulkTestDataService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\TestCase;

class BulkTestDataTest extends TestCase
{
    use DatabaseTransactions;

    private function service(): BulkTestDataService
    {
        return app(BulkTestDataService::class);
    }

    private function testStalls()
    {
        return Stall::where('code', 'like', 'TST-%')->orderBy('code')->get();
    }

    public function test_plan_is_exactly_50_stalls_and_1000_items_without_touching_the_database(): void
    {
        $plan = $this->service()->plan();

        $this->assertCount(50, $plan);
        $this->assertCount(50, array_unique(array_column($plan, 'code')));
        $this->assertSame(1000, array_sum(array_map(fn ($s) => count($s['items']), $plan)));

        $allItemCodes = [];
        foreach ($plan as $stall) {
            $this->assertCount(20, $stall['items']);
            $names = array_column($stall['items'], 'name');
            $this->assertSame(count($names), count(array_unique($names)), "Duplicate dish name inside {$stall['code']}");
            foreach ($stall['items'] as $item) {
                $allItemCodes[] = $item['code'];
                $this->assertGreaterThanOrEqual(10, $item['price']);
                $this->assertLessThanOrEqual(1000, $item['price']);
                $this->assertGreaterThan(0, $item['prep']);
            }
        }
        $this->assertCount(1000, array_unique($allItemCodes));
        $this->assertCount(1000, array_unique(array_column(array_merge(...array_column($plan, 'items')), 'uuid')));

        // all 20 required categories are used
        $this->assertCount(20, array_unique(array_column($plan, 'cuisine')));
    }

    public function test_run_creates_exactly_50_stalls_and_1000_valid_items(): void
    {
        $this->assertSame(['stalls' => 0, 'items' => 0], $this->service()->counts(), 'test database must start without test data');
        $existingStalls = Stall::count();
        $existingItems = MenuItem::count();

        $summary = $this->service()->run();

        $this->assertSame([], $summary['failed']);
        $this->assertSame(50, $summary['stalls_created']);
        $this->assertSame(1000, $summary['items_created']);
        $this->assertSame(1050, $summary['grand_total']);
        $this->assertSame(['stalls' => 50, 'items' => 1000], $summary['total_in_database']);

        // existing data is untouched and only these records were added
        $this->assertSame($existingStalls + 50, Stall::count());
        $this->assertSame($existingItems + 1000, MenuItem::count());

        $stalls = $this->testStalls();
        $this->assertCount(50, $stalls);
        $this->assertCount(50, $stalls->pluck('code')->unique());
        foreach ($stalls as $stall) {
            $this->assertStringStartsWith('[TEST DATA]', $stall->description);
            $this->assertStringContainsString('@example.test', $stall->description);
            $this->assertStringContainsString('(dummy, not a real account)', $stall->description);
            $this->assertMatchesRegularExpression('/^\+91 90000 \d{5}$/', $stall->contact_phone);
            $this->assertSame(20, MenuItem::where('stall_id', $stall->id)->count(), "{$stall->code} must have exactly 20 items");
        }

        // inactive and sold-out states are both exercised
        $this->assertSame(5, $stalls->where('is_active', false)->count());
        $this->assertGreaterThan(0, MenuItem::whereIn('stall_id', $stalls->pluck('id'))->where('is_available', false)->count());

        // every item: valid stall, a category that belongs to that same stall, sane price, marker + item code
        $bad = MenuItem::whereIn('stall_id', $stalls->pluck('id'))
            ->get()
            ->filter(function (MenuItem $item) {
                $cat = MenuCategory::find($item->category_id);

                return !$cat || $cat->stall_id !== $item->stall_id
                    || (float) $item->price <= 0 || (float) $item->price > 1000
                    || $item->preparation_time_minutes < 1
                    || !preg_match('/\[TST-\d{3}-I\d{2}\]/', (string) $item->description);
            });
        $this->assertCount(0, $bad);

        // no duplicate dish name inside any stall, and item codes are unique
        $dupNames = MenuItem::whereIn('stall_id', $stalls->pluck('id'))
            ->selectRaw('stall_id, name, count(*) as n')->groupBy('stall_id', 'name')->havingRaw('count(*) > 1')->get();
        $this->assertCount(0, $dupNames);
        $codes = MenuItem::whereIn('stall_id', $stalls->pluck('id'))->pluck('description')
            ->map(fn ($d) => preg_match('/\[(TST-\d{3}-I\d{2})\]/', $d, $m) ? $m[1] : null);
        $this->assertCount(1000, $codes->unique());
    }

    public function test_rerun_creates_no_duplicates_and_changes_nothing(): void
    {
        $this->service()->run();
        $snapshot = MenuItem::orderBy('id')->get(['id', 'name', 'price', 'updated_at'])->toArray();

        $second = $this->service()->run();

        $this->assertSame(0, $second['stalls_created']);
        $this->assertSame(0, $second['items_created']);
        $this->assertSame(50, $second['stalls_existing']);
        $this->assertSame(1000, $second['items_existing']);
        $this->assertSame(['stalls' => 50, 'items' => 1000], $this->service()->counts());
        $this->assertSame($snapshot, MenuItem::orderBy('id')->get(['id', 'name', 'price', 'updated_at'])->toArray());
    }

    public function test_failure_rolls_back_only_that_stall_and_a_rerun_recovers_to_exactly_50_and_1000(): void
    {
        $failing = $this->service()->withFaultInjector(function (array $spec) {
            if ($spec['no'] === 25) {
                throw new \RuntimeException('simulated crash');
            }
        })->run();

        $this->assertCount(1, $failing['failed']);
        $this->assertSame('TST-025', $failing['failed'][0]['stall']);
        $this->assertSame(['stalls' => 49, 'items' => 980], $this->service()->counts());
        $this->assertNull(Stall::where('code', 'TST-025')->first(), 'the failed stall must be rolled back completely');

        $recovered = $this->service()->withFaultInjector(null)->run();

        $this->assertSame([], $recovered['failed']);
        $this->assertSame(1, $recovered['stalls_created']);
        $this->assertSame(20, $recovered['items_created']);
        $this->assertSame(['stalls' => 50, 'items' => 1000], $this->service()->counts());
    }

    public function test_a_partially_created_stall_is_completed_without_duplicates(): void
    {
        $this->service()->run();
        $stall = Stall::where('code', 'TST-003')->firstOrFail();
        MenuItem::where('stall_id', $stall->id)->orderBy('id')->limit(7)->delete();
        $this->assertSame(13, MenuItem::where('stall_id', $stall->id)->count());

        $summary = $this->service()->run();

        $this->assertSame(7, $summary['items_created']);
        $this->assertSame(20, MenuItem::where('stall_id', $stall->id)->count());
        $this->assertSame(['stalls' => 50, 'items' => 1000], $this->service()->counts());
    }

    public function test_a_non_test_stall_with_a_clashing_code_is_left_untouched(): void
    {
        $real = Stall::create(['name' => 'Real Stall', 'code' => 'TST-007', 'description' => 'A genuine stall', 'is_active' => true]);

        $summary = $this->service()->run();

        $this->assertCount(1, $summary['failed']);
        $this->assertSame('TST-007', $summary['failed'][0]['stall']);
        $real->refresh();
        $this->assertSame('Real Stall', $real->name);
        $this->assertSame('A genuine stall', $real->description);
        $this->assertSame(0, MenuItem::where('stall_id', $real->id)->count());
        $this->assertSame(49, $summary['stalls_created']);
    }

    public function test_artisan_command_prints_the_creation_summary_and_is_idempotent(): void
    {
        $this->artisan('foodcourt:seed-test-data')
            ->expectsOutputToContain('Creation summary: 50 stalls, 1000 menu items, 1050 total test records in the database.')
            ->assertExitCode(0);

        $this->artisan('foodcourt:seed-test-data')
            ->expectsOutputToContain('Creation summary: 50 stalls, 1000 menu items, 1050 total test records in the database.')
            ->assertExitCode(0);

        $this->assertSame(['stalls' => 50, 'items' => 1000], $this->service()->counts());
    }
}
