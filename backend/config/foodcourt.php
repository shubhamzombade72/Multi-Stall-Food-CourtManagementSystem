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

];
