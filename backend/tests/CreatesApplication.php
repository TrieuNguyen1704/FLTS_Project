<?php

namespace Tests;

use Illuminate\Foundation\Application;

trait CreatesApplication
{
    public function createApplication(): Application
    {
        $app = require __DIR__.'/../bootstrap/app.php';
        $app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();

        // Docker supplies MySQL variables to the API process. Tests must always
        // override them before RefreshDatabase resolves a connection so the
        // demo database is never migrated or truncated by PHPUnit.
        $app['config']->set('database.default', 'sqlite');
        $app['config']->set('database.connections.sqlite.database', ':memory:');

        return $app;
    }
}
