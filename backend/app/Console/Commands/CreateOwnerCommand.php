<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Services\AuditService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rules\Password;

/**
 * First owner of a SHARED host (a single-PC install has the Welcome screen instead). Run once, on the host, by
 * the administrator. The password is typed at a hidden prompt: no default password exists and none can be
 * passed on the command line. Refuses to run when any account exists, so it cannot add or replace an owner.
 */
class CreateOwnerCommand extends Command
{
    protected $signature = 'foodcourt:create-owner {email : Owner email address} {name : Owner full name}';

    protected $description = 'Create the first owner account on a shared host (hidden password prompt; refuses if any account exists)';

    public function handle(): int
    {
        if (config('foodcourt.embedded')) {
            $this->error('This is a single-PC installation: the owner is created on the Welcome screen when the app first opens.');

            return self::FAILURE;
        }

        $validator = Validator::make($this->arguments(), ['email' => 'required|email|max:150', 'name' => 'required|string|max:100']);
        if ($validator->fails()) {
            $this->error($validator->errors()->first());

            return self::FAILURE;
        }

        $password = (string) $this->secret('Password (at least 8 characters, letters and numbers)');
        if ($password !== (string) $this->secret('Repeat the password')) {
            $this->error('The two passwords do not match. Nothing was created.');

            return self::FAILURE;
        }
        $rules = Validator::make(['password' => $password], ['password' => ['required', Password::min(8)->letters()->numbers()]]);
        if ($rules->fails()) {
            $this->error($rules->errors()->first());

            return self::FAILURE;
        }

        $user = DB::transaction(function () use ($password) {
            if (User::query()->exists()) {
                return null;
            }

            return User::create(['name' => $this->argument('name'), 'email' => $this->argument('email'), 'password' => $password, 'role' => 'owner', 'is_active' => true]);
        });
        if (!$user) {
            $this->error('Accounts already exist on this system. Nothing was created.');

            return self::FAILURE;
        }

        AuditService::log('owner_setup', 'User', $user->id, null, null, ['via' => 'artisan'], $user->id);
        $this->info('Owner account created. Sign in on any connected computer with this email and the password you typed.');

        return self::SUCCESS;
    }
}
