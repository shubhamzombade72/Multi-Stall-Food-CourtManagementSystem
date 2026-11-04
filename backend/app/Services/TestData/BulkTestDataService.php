<?php

namespace App\Services\TestData;

use App\Models\MenuCategory;
use App\Models\MenuItem;
use App\Models\Stall;
use Closure;
use Illuminate\Support\Facades\DB;
use Ramsey\Uuid\Uuid;

/**
 * Generates a fixed, clearly-labelled set of demo data: 50 stalls (TST-001..TST-050) and 20 menu items each (1000 in total).
 *
 * - Idempotent: every record has a deterministic key (stall code, item uuid derived from the item code), and anything that
 *   already exists is skipped, so a second run, or a retry after a failure, ends with exactly 50 + 1000 records.
 * - Transactional: one database transaction per stall (stall + its categories + its 20 items). A failure rolls back only that
 *   stall; the others stay, and re-running fills in what is missing.
 * - Non-destructive: existing rows are never updated. If a stall code is already taken by something that is not test data, that
 *   stall is reported as failed and left untouched.
 * - The schema has no owner / cuisine / email / UPI / hours / GST columns, so those details are written into the stall and item
 *   descriptions. Every description carries a marker, which is how test data is recognised (see isTestStall()).
 */
class BulkTestDataService
{
    public const CODE_PREFIX = 'TST-';
    public const STALL_COUNT = 50;
    public const ITEMS_PER_STALL = 20;
    public const STALL_MARKER = '[TEST DATA]';
    public const SAC_REFERENCE = 'GST: SAC 9963 (restaurant service), rate per Food Court Settings';

    /** Test hook: called inside a stall's transaction just before it commits; throw to simulate a mid-run failure. */
    private ?Closure $faultInjector = null;

    public function withFaultInjector(?Closure $injector): static
    {
        $this->faultInjector = $injector;

        return $this;
    }

    public static function stallCode(int $n): string
    {
        return sprintf('%s%03d', self::CODE_PREFIX, $n);
    }

    public static function itemCode(int $stallNo, int $itemNo): string
    {
        return sprintf('%s%03d-I%02d', self::CODE_PREFIX, $stallNo, $itemNo);
    }

    public static function itemUuid(string $itemCode): string
    {
        return Uuid::uuid5(Uuid::NAMESPACE_URL, 'urn:foodcourt-test-data:' . $itemCode)->toString();
    }

    public static function isTestStall(Stall $stall): bool
    {
        return str_starts_with((string) $stall->code, self::CODE_PREFIX) && str_starts_with((string) $stall->description, self::STALL_MARKER);
    }

    /**
     * The full deterministic plan: 50 stall specs, each with exactly 20 distinct dishes. Pure (touches no database).
     *
     * @return array<int, array<string, mixed>>
     */
    public function plan(): array
    {
        $cuisines = TestDataCatalog::cuisines();
        $cuisineNames = array_keys($cuisines);
        $firstNames = TestDataCatalog::firstNames();
        $lastNames = TestDataCatalog::lastNames();
        $locations = TestDataCatalog::locations();
        $hours = TestDataCatalog::hours();
        $priceFactors = [1.00, 1.10, 0.90];

        $plan = [];
        for ($n = 1; $n <= self::STALL_COUNT; $n++) {
            $i = $n - 1;
            $cuisineName = $cuisineNames[$i % count($cuisineNames)];
            $repeat = intdiv($i, count($cuisineNames));
            $cuisine = $cuisines[$cuisineName];
            $code = self::stallCode($n);

            $owner = $firstNames[$i % count($firstNames)] . ' ' . $lastNames[($i * 3 + $repeat) % count($lastNames)];
            $location = $locations[$i % count($locations)] . ', Stall ' . sprintf('%02d', $n);
            $openHours = $hours[($i * 5 + $repeat) % count($hours)];
            $email = 'owner.' . strtolower($code) . '@example.test';
            $upi = 'test.' . strtolower(str_replace('-', '', $code)) . '@testbank';

            // 20 of the cuisine's 22 dishes, starting at a different offset per repeat so same-cuisine stalls differ
            $dishes = $cuisine['items'];
            $picked = [];
            for ($k = 0; $k < self::ITEMS_PER_STALL; $k++) {
                $picked[] = $dishes[($k + $repeat * 5) % count($dishes)];
            }

            $items = [];
            foreach ($picked as $k => $line) {
                [$name, $category, $price, $veg, $prep] = explode('|', $line);
                $itemNo = $k + 1;
                $itemCode = self::itemCode($n, $itemNo);
                $items[] = [
                    'code' => $itemCode,
                    'uuid' => self::itemUuid($itemCode),
                    'name' => $name,
                    'category' => $category,
                    'price' => max(10, (int) round((float) $price * $priceFactors[$repeat % 3])),
                    'is_veg' => $veg === '1',
                    'prep' => (int) $prep,
                    // roughly 1 in 12 dishes is shown as sold out
                    'is_available' => (($n * 7 + $itemNo) % 12) !== 0,
                ];
            }

            $plan[] = [
                'no' => $n,
                'code' => $code,
                'uuid' => Uuid::uuid5(Uuid::NAMESPACE_URL, 'urn:foodcourt-test-data:' . $code)->toString(),
                'name' => $cuisine['names'][$repeat % count($cuisine['names'])],
                'cuisine' => $cuisineName,
                'owner' => $owner,
                'phone' => sprintf('+91 90000 %05d', 10000 + $n),
                'email' => $email,
                'upi' => $upi,
                'location' => $location,
                'hours' => $openHours,
                // every 10th stall is closed, to exercise the active / inactive states
                'is_active' => $n % 10 !== 0,
                'description' => sprintf(
                    '%s %s stall. Owner: %s. Location: %s. Hours: %s. Email: %s. UPI: %s (dummy, not a real account).',
                    self::STALL_MARKER,
                    $cuisineName,
                    $owner,
                    $location,
                    $openHours,
                    $email,
                    $upi
                ),
                'items' => $items,
            ];
        }

        return $plan;
    }

    /**
     * Create whatever is missing. $progress receives (done, total, stallCode, status) after every stall.
     *
     * @return array<string, mixed> the creation summary
     */
    public function run(?callable $progress = null): array
    {
        $summary = [
            'stalls_created' => 0, 'stalls_existing' => 0,
            'items_created' => 0, 'items_existing' => 0,
            'categories_created' => 0,
            'failed' => [],
        ];

        $plan = $this->plan();
        foreach ($plan as $idx => $spec) {
            try {
                $r = DB::transaction(fn () => $this->seedStall($spec));
                $summary['stalls_created'] += $r['stall_created'] ? 1 : 0;
                $summary['stalls_existing'] += $r['stall_created'] ? 0 : 1;
                $summary['items_created'] += $r['items_created'];
                $summary['items_existing'] += $r['items_existing'];
                $summary['categories_created'] += $r['categories_created'];
                $status = $r['stall_created'] ? 'created' : ($r['items_created'] ? 'completed' : 'already present');
            } catch (\Throwable $e) {
                $summary['failed'][] = ['stall' => $spec['code'], 'reason' => $e->getMessage()];
                $status = 'FAILED: ' . $e->getMessage();
            }
            if ($progress) {
                $progress($idx + 1, count($plan), $spec['code'], $status);
            }
        }

        $summary['total_in_database'] = $this->counts();
        $summary['stalls_created_total'] = $summary['total_in_database']['stalls'];
        $summary['items_created_total'] = $summary['total_in_database']['items'];
        $summary['grand_total'] = $summary['total_in_database']['stalls'] + $summary['total_in_database']['items'];

        return $summary;
    }

    /** @return array{stalls: int, items: int} how much test data currently exists */
    public function counts(): array
    {
        $stallIds = Stall::where('code', 'like', self::CODE_PREFIX . '%')
            ->where('description', 'like', self::STALL_MARKER . '%')
            ->pluck('id');

        return [
            'stalls' => $stallIds->count(),
            'items' => MenuItem::whereIn('stall_id', $stallIds)->where('description', 'like', '%[' . self::CODE_PREFIX . '%')->count(),
        ];
    }

    /** @return array{stall_created: bool, items_created: int, items_existing: int, categories_created: int} */
    private function seedStall(array $spec): array
    {
        $stall = Stall::where('code', $spec['code'])->first();
        $stallCreated = false;
        if ($stall === null) {
            $stall = Stall::create([
                'uuid' => $spec['uuid'],
                'name' => $spec['name'],
                'code' => $spec['code'],
                'description' => $spec['description'],
                'contact_phone' => $spec['phone'],
                'is_active' => $spec['is_active'],
            ]);
            $stallCreated = true;
        } elseif (!self::isTestStall($stall)) {
            throw new \RuntimeException("Stall code {$spec['code']} is already used by a non-test stall; left untouched");
        }

        // Categories, in first-use order
        $categoryIds = [];
        $categoriesCreated = 0;
        $order = 0;
        foreach ($spec['items'] as $item) {
            if (isset($categoryIds[$item['category']])) {
                continue;
            }
            $order++;
            $category = MenuCategory::firstOrCreate(
                ['stall_id' => $stall->id, 'name' => $item['category']],
                ['display_order' => $order, 'is_active' => true]
            );
            $categoriesCreated += $category->wasRecentlyCreated ? 1 : 0;
            $categoryIds[$item['category']] = $category->id;
        }

        // Items: skip the ones whose deterministic uuid is already present, insert the rest in one statement
        $existing = MenuItem::whereIn('uuid', array_column($spec['items'], 'uuid'))->pluck('uuid')->all();
        $now = now();
        $rows = [];
        foreach ($spec['items'] as $item) {
            if (in_array($item['uuid'], $existing, true)) {
                continue;
            }
            $rows[] = [
                'uuid' => $item['uuid'],
                'stall_id' => $stall->id,
                'category_id' => $categoryIds[$item['category']],
                'name' => $item['name'],
                'description' => sprintf('%s [%s] %s', $item['name'], $item['code'], self::SAC_REFERENCE . '. Test data.'),
                'price' => $item['price'],
                'is_veg' => $item['is_veg'],
                'is_available' => $item['is_available'],
                'preparation_time_minutes' => $item['prep'],
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }
        foreach (array_chunk($rows, 100) as $chunk) {
            MenuItem::insert($chunk);
        }

        if ($this->faultInjector) {
            ($this->faultInjector)($spec);
        }

        return [
            'stall_created' => $stallCreated,
            'items_created' => count($rows),
            'items_existing' => count($existing),
            'categories_created' => $categoriesCreated,
        ];
    }
}
