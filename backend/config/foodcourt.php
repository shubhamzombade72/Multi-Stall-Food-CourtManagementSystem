<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Embedded (single-PC) mode
    |--------------------------------------------------------------------------
    |
    | The Windows desktop app can launch this API on 127.0.0.1 with its own local database. In that mode,
    | and only that mode, /api/setup/* lets the first run create the owner account (no demo accounts and
    | no default passwords). On a hosted or LAN server this stays false and those routes answer 404.
    |
    */
    'embedded' => (bool) env('FOODCOURT_EMBEDDED', false),

    /*
    |--------------------------------------------------------------------------
    | Shared host (multi-PC) mode
    |--------------------------------------------------------------------------
    |
    | On the one computer or server that holds the shared database, every other computer is "paired" with a
    | one-time code (/api/pairing/*). With require_paired_devices on, only paired terminals can sign in.
    | public_url is the address terminals reach this host on (https://host/api); when empty it is taken from
    | the request that created the pairing code.
    |
    */
    'require_paired_devices' => (bool) env('FOODCOURT_REQUIRE_PAIRING', false),
    'public_url' => env('FOODCOURT_PUBLIC_API_URL'),

    /*
    |--------------------------------------------------------------------------
    | Update management
    |--------------------------------------------------------------------------
    |
    | service: this deployment is the central update service. Off everywhere else, and always off on a PC's built-in
    | server, so clients have no release or device routes at all. trusted_keys lists PUBLIC Ed25519 keys only
    | ("id:base64,id2:base64"); the private key never comes near this server. api_contract is raised when an API change
    | would break an older desktop app, and a paired terminal compares it before it updates itself. app_version is
    | passed in by the desktop launcher.
    |
    */
    'updates' => [
        'service' => (bool) env('FOODCOURT_UPDATE_SERVICE', false),
        'trusted_keys' => env('FOODCOURT_UPDATE_TRUSTED_KEYS', ''),
        'storage_path' => env('FOODCOURT_UPDATE_STORAGE', storage_path('app/update-packages')),
        'download_ttl_seconds' => (int) env('FOODCOURT_UPDATE_DOWNLOAD_TTL', 600),
    ],
    'api_contract' => 1,
    'app_version' => env('FOODCOURT_APP_VERSION'),

];
