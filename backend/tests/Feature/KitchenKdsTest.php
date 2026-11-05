<?php

namespace Tests\Feature;

use App\Models\User;
use Tests\TestCase;

class KitchenKdsTest extends TestCase
{
    public function test_kitchen_display_endpoint_is_decommissioned(): void
    {
        $response = $this->getJson('/api/kitchen/tickets');
        $response->assertStatus(404);
    }
}
