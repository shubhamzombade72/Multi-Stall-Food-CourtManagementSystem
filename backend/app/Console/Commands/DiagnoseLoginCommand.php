<?php

namespace App\Console\Commands;

use App\Models\AuditLog;
use App\Models\User;
use App\Services\SetupState;
use App\Services\SystemHealth;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/**
 * Support tool for "I cannot sign in": reports, as one JSON line, what this system knows about an email.
 * It never prints a password, a hash or a token. With --check-password it also tests the password given in
 * the FOODCOURT_DIAG_PASSWORD environment variable and whether a session token could be created (that test is
 * rolled back, nothing is written).
 */
class DiagnoseLoginCommand extends Command
{
    protected $signature = 'foodcourt:diagnose-login {email} {--check-password : Also test FOODCOURT_DIAG_PASSWORD against the account}';

    protected $description = 'Explain why an email cannot sign in (prints one JSON line, no secrets)';

    public function handle(): int
    {
        $email = mb_strtolower(trim($this->argument('email')));
        $report = [
            'database_reachable' => SystemHealth::databaseReachable(),
            'migrations_current' => SystemHealth::migrationsCurrent(),
        ];
        if (!$report['database_reachable']) {
            $this->line(json_encode($report));

            return self::FAILURE;
        }

        $user = User::query()->whereRaw('lower(email) = ?', [$email])->first();
        $report += [
            'accounts_in_system' => User::query()->count(),
            'owners_in_system' => User::query()->where('role', 'owner')->count(),
            'setup_completed' => SetupState::marker() !== null,
            'account_found' => $user !== null,
        ];
        if ($user) {
            $report += [
                'role' => $user->role,
                'is_active' => (bool) $user->is_active,
                'email_differs_only_by_case_from_stored' => $user->getRawOriginal('email') !== $email && mb_strtolower($user->getRawOriginal('email')) === $email,
                'accounts_matching_ignoring_case' => User::query()->whereRaw('lower(email) = ?', [$email])->count(),
            ];
        }

        $reasons = [];
        $recent = [];
        foreach (AuditLog::query()->where('action', 'login_failed')->orderByDesc('id')->limit(500)->get() as $row) {
            $v = $row->new_values ?? [];
            if (mb_strtolower((string) ($v['email'] ?? '')) !== $email) {
                continue;
            }
            $reasons[$v['reason'] ?? 'unknown'] = ($reasons[$v['reason'] ?? 'unknown'] ?? 0) + 1;
            if (count($recent) < 5) {
                $recent[] = (string) $row->created_at;
            }
        }
        $report['failed_attempts_by_reason'] = $reasons;
        $report['latest_failed_attempts'] = $recent;

        if ($this->option('check-password') && $user) {
            $given = (string) getenv('FOODCOURT_DIAG_PASSWORD');
            $report['password_matches'] = $given !== '' && Hash::check($given, $user->password);
            $report['password_hash_needs_rehash'] = Hash::needsRehash($user->password);
            try {
                DB::beginTransaction();
                $user->createToken('diagnose');
                $report['token_can_be_created'] = true;
            } catch (\Throwable) {
                $report['token_can_be_created'] = false;
            } finally {
                DB::rollBack();
            }
        }

        $this->line(json_encode($report));

        return self::SUCCESS;
    }
}
