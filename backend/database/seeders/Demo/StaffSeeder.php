<?php

namespace Database\Seeders\Demo;

use App\Models\User;
use Database\Seeders\Demo\Data\DemoCatalog;
use Illuminate\Support\Facades\Hash;

/**
 * 150 fictional staff: 1 owner, 8 cashiers, 12 waiters, 50 stall managers (one per stall), 75 kitchen staff (one per stall plus a
 * second for stalls 1-25) and 4 store staff (stalls 1-4). The application has no separate "admin" role: the owner is the
 * administrator. Passwords are bcrypt hashes of the two demo passwords documented in docs/engineering/indian-demo-credentials.md.
 * No authorization rule is touched; users are created exactly as the Staff screen would store them.
 */
class StaffSeeder extends DemoSeederBase
{
    protected function seed(): int
    {
        $stalls = self::stallIds();
        if (count($stalls) < 50) {
            throw new \RuntimeException('StallSeeder must run before StaffSeeder');
        }
        $first = DemoCatalog::firstNames();
        $last = DemoCatalog::lastNames();
        $domain = 'demo.' . DemoCatalog::EMAIL_DOMAIN;
        $ownerHash = Hash::make(self::DEMO_OWNER_PASSWORD);
        $staffHash = Hash::make(self::DEMO_STAFF_PASSWORD);

        $plan = [['owner@' . $domain, 'owner', null, $ownerHash]];
        for ($n = 1; $n <= 8; $n++) {
            $plan[] = [sprintf('cashier%02d@%s', $n, $domain), 'cashier', null, $staffHash];
        }
        for ($n = 1; $n <= 12; $n++) {
            $plan[] = [sprintf('waiter%02d@%s', $n, $domain), 'waiter', null, $staffHash];
        }
        for ($n = 1; $n <= 50; $n++) {
            $code = strtolower(self::stallCode($n));
            $stallId = $stalls[self::stallCode($n)];
            $compact = str_replace('-', '', $code);
            $plan[] = ["manager.{$compact}@{$domain}", 'stall_manager', $stallId, $staffHash];
            $plan[] = ["kitchen.{$compact}a@{$domain}", 'kitchen_staff', $stallId, $staffHash];
            if ($n <= 25) {
                $plan[] = ["kitchen.{$compact}b@{$domain}", 'kitchen_staff', $stallId, $staffHash];
            }
            if ($n <= 4) {
                $plan[] = ["store.{$compact}@{$domain}", 'store_staff', $stallId, $staffHash];
            }
        }

        $created = 0;
        foreach ($plan as $k => [$email, $role, $stallId, $hash]) {
            if (User::where('email', $email)->exists()) {
                continue;
            }
            $name = $role === 'owner'
                ? 'Demo Owner (Mr. Prakash Deshmukh)'
                : $first[(($k + 1) * 13) % count($first)] . ' ' . $last[(($k + 1) * 17 + intdiv($k, 40)) % count($last)];
            // password is already hashed; the model's "hashed" cast leaves a valid bcrypt hash alone
            User::create([
                'name' => $name,
                'email' => $email,
                'password' => $hash,
                'role' => $role,
                'stall_id' => $stallId,
                'phone' => self::fictionalPhone(900000 + $k),
                'is_active' => true,
            ]);
            $created++;
        }

        return $created;
    }
}
