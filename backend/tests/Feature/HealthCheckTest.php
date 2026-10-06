<?php

namespace Tests\Feature;

use Tests\TestCase;

class HealthCheckTest extends TestCase
{
    public function test_api_health_endpoint(): void
    {
        $response = $this->getJson('/api/health');
        $response->assertOk()->assertJson(['status' => 'ok', 'service' => 'laravel-api']);
    }
}
