<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Additive only: terminals (counter, kitchen and waiter PCs) paired to a shared host. The device token is
 * kept as a SHA-256 hash; the plain token exists only on the paired computer.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('paired_devices', function (Blueprint $table) {
            $table->id();
            $table->string('name', 100);
            $table->string('token_hash', 64)->unique();
            $table->foreignId('paired_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('last_seen_at')->nullable();
            $table->timestamp('revoked_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('paired_devices');
    }
};
