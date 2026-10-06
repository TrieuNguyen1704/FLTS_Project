<?php

use Monolog\Handler\StreamHandler;
use Monolog\Handler\NullHandler;

return [
    'default' => env('LOG_CHANNEL', 'stack'),
    'channels' => [
        'stack' => ['driver' => 'stack', 'channels' => ['single']],
        'single' => ['driver' => 'single', 'path' => storage_path('logs/laravel.log'), 'level' => 'debug', 'replace_placeholders' => true],
        'null' => ['driver' => 'monolog', 'handler' => NullHandler::class],
        'emergency' => ['path' => storage_path('logs/laravel.log')],
    ],
];
