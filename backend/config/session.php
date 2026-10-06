<?php

return [
    'driver' => env('SESSION_DRIVER', 'file'),
    'lifetime' => 120,
    'expire_on_close' => false,
    'files' => storage_path('framework/sessions'),
    'cookie' => 'flts_session',
    'path' => '/',
    'domain' => null,
    'secure' => false,
    'http_only' => true,
    'same_site' => 'lax',
];
