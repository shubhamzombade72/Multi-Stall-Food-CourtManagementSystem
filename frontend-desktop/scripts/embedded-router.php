<?php

/**
 * Router for PHP's built-in server when it is launched by the desktop app. Same job as Laravel's own
 * Foundation/resources/server.php, but the public path is explicit instead of getcwd(): the app starts PHP
 * in the user's data folder (see electron/embedded-server.cjs), not in public/.
 */
$_SERVER['SCRIPT_NAME'] = '/index.php';
$_SERVER['SCRIPT_FILENAME'] = __DIR__.'/backend/public/index.php';

require_once __DIR__.'/backend/public/index.php';
