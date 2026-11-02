<?php

namespace Tests\Feature;

use App\Models\User;
use Tests\TestCase;

class AuthTest extends TestCase
{
    public function test_user_can_login_with_correct_credentials(): void
    {
        $response = $this->postJson('/api/auth/login', [
            'email' => 'owner@foodcourt.com',
            'password' => 'password123',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('success', true);
        $this->assertNotEmpty($response->json('data.token'));
        $this->assertEquals('owner', $response->json('data.user.role'));
    }

    public function test_login_fails_with_invalid_password(): void
    {
        $response = $this->postJson('/api/auth/login', [
            'email' => 'owner@foodcourt.com',
            'password' => 'wrongpassword',
        ]);

        $response->assertStatus(422);
    }

    public function test_authenticated_user_can_access_me_endpoint(): void
    {
        $user = User::where('email', 'cashier@foodcourt.com')->first();

        $response = $this->actingAs($user)->getJson('/api/auth/me');

        $response->assertStatus(200);
        $response->assertJsonPath('data.user.email', 'cashier@foodcourt.com');
        $this->assertEquals('cashier', $response->json('data.user.role'));
    }
}

