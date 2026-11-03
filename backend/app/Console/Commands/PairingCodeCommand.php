<?php

namespace App\Console\Commands;

use App\Services\PairingCodes;
use Illuminate\Console\Command;

/** Run on the host by the administrator to connect the first terminal (later codes come from the owner's screen). */
class PairingCodeCommand extends Command
{
    protected $signature = 'foodcourt:pairing-code {--url= : Address terminals use to reach this host, e.g. https://foodcourt-host.lan/api}';

    protected $description = 'Create a one-time code that connects a terminal PC to this shared host';

    public function handle(): int
    {
        if (config('foodcourt.embedded')) {
            $this->error('This is a single-PC installation; it has no shared host to connect to.');

            return self::FAILURE;
        }
        $url = $this->option('url') ?: config('foodcourt.public_url');
        if (!$url || !preg_match('#^https?://[^/\s]+(/[^\s]*)?/api$#', $url)) {
            $this->error('Give the address terminals use, ending in /api: --url=https://host/api (or set FOODCOURT_PUBLIC_API_URL).');

            return self::FAILURE;
        }

        $issued = PairingCodes::issue(null, $url);
        $this->line('Connection code (valid ' . PairingCodes::VALID_MINUTES . ' minutes, works once):');
        $this->line('');
        $this->line($issued['pairing_string']);
        $this->line('');
        $this->line('On the terminal: open the app, choose "Connect to an existing food court" and paste the line above.');

        return self::SUCCESS;
    }
}
