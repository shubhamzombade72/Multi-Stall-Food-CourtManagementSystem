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

];
