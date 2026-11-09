<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Additive only: central update management. These tables are used only where FOODCOURT_UPDATE_SERVICE=true; because the
 * same migrations run on every client's own database they exist there too, empty and unused. No business table is touched.
 * Tokens and enrollment codes are kept as SHA-256 hashes, like paired_devices.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('update_releases', function (Blueprint $table) {
            $table->id();
            $table->string('version', 20)->unique();
            $table->string('channel', 10)->default('stable')->index(); // stable | beta | testing
            $table->string('status', 30)->default('RELEASE_CREATED')->index(); // RELEASE_CREATED | RELEASE_PUBLISHED
            $table->json('notes')->nullable(); // features, bug_fixes, performance, database_changes, security
            $table->string('min_supported_version', 20)->nullable();
            $table->boolean('required')->default(false);
            $table->json('app_compatibility')->nullable();
            $table->json('database_compatibility')->nullable();
            $table->timestamp('release_date')->nullable();
            $table->timestamp('published_at')->nullable();
            $table->timestamp('unpublished_at')->nullable();
            $table->foreignId('created_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('update_packages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('release_id')->constrained('update_releases')->cascadeOnDelete();
            $table->string('package_type', 12); // incremental | full
            $table->string('source_version', 20)->nullable(); // null for a full package
            $table->longText('manifest_raw'); // the exact signed bytes
            $table->string('manifest_sha256', 64);
            $table->string('signature', 200);
            $table->string('signing_key_id', 40);
            $table->string('package_sha256', 64);
            $table->unsignedBigInteger('package_size');
            $table->string('storage_name', 120)->nullable();
            $table->timestamp('uploaded_at')->nullable();
            $table->timestamps();
            $table->unique(['release_id', 'package_type', 'source_version']);
        });

        Schema::create('update_clients', function (Blueprint $table) {
            $table->id();
            $table->string('device_id', 64)->unique();
            $table->string('name', 100);
            $table->string('customer_label', 120)->nullable();
            $table->string('token_hash', 64)->unique();
            $table->string('machine_fingerprint', 64)->nullable();
            $table->string('status', 12)->default('authorized')->index(); // authorized | suspended | revoked
            $table->string('channel', 10)->default('stable');
            $table->string('mode', 12)->nullable(); // embedded | remote, as last reported
            $table->string('reported_app_version', 20)->nullable();
            $table->string('reported_schema_fingerprint', 64)->nullable();
            $table->string('verified_app_version', 20)->nullable(); // set only by a validated completion
            $table->string('verified_schema_fingerprint', 64)->nullable();
            $table->json('last_health')->nullable();
            $table->timestamp('last_check_at')->nullable();
            $table->timestamp('last_success_at')->nullable();
            $table->timestamp('last_failure_at')->nullable();
            $table->timestamps();
        });

        Schema::create('update_enrollment_codes', function (Blueprint $table) {
            $table->id();
            $table->string('code_hash', 64)->unique();
            $table->string('customer_label', 120)->nullable();
            $table->string('channel', 10)->default('stable');
            $table->timestamp('expires_at');
            $table->timestamp('used_at')->nullable();
            $table->foreignId('client_id')->nullable()->constrained('update_clients')->nullOnDelete();
            $table->foreignId('created_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('update_deployments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('release_id')->constrained('update_releases')->cascadeOnDelete();
            $table->string('scope', 10); // all | selected
            $table->json('excluded_client_ids')->nullable();
            $table->string('status', 12)->default('active')->index(); // active | cancelled
            $table->string('note', 500)->nullable();
            $table->foreignId('created_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('update_deployment_targets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('deployment_id')->constrained('update_deployments')->cascadeOnDelete();
            $table->foreignId('client_id')->constrained('update_clients')->cascadeOnDelete();
            $table->foreignId('release_id')->constrained('update_releases')->cascadeOnDelete();
            $table->foreignId('package_id')->nullable()->constrained('update_packages')->nullOnDelete();
            $table->string('status', 30)->default('UPDATE_AVAILABLE')->index();
            $table->string('decision', 10)->nullable(); // approved | rejected
            $table->string('proof_nonce', 64)->nullable();
            $table->string('last_error', 1000)->nullable();
            $table->timestamp('approved_at')->nullable();
            $table->timestamp('download_started_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();
            $table->unique(['deployment_id', 'client_id']);
        });

        Schema::create('update_download_tokens', function (Blueprint $table) {
            $table->id();
            $table->string('token_hash', 64)->unique();
            $table->foreignId('target_id')->constrained('update_deployment_targets')->cascadeOnDelete();
            $table->foreignId('package_id')->constrained('update_packages')->cascadeOnDelete();
            $table->foreignId('client_id')->constrained('update_clients')->cascadeOnDelete();
            $table->timestamp('expires_at');
            $table->timestamp('first_used_at')->nullable();
            $table->timestamps();
        });

        Schema::create('update_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('client_id')->nullable()->constrained('update_clients')->nullOnDelete();
            $table->foreignId('target_id')->nullable()->constrained('update_deployment_targets')->nullOnDelete();
            $table->foreignId('release_id')->nullable()->constrained('update_releases')->nullOnDelete();
            $table->string('category', 20)->index(); // lifecycle | download | migration | install | recovery | health | security
            $table->string('status', 30)->nullable();
            $table->boolean('is_error')->default(false)->index();
            $table->string('message', 1000)->nullable();
            $table->json('details')->nullable();
            $table->timestamp('client_time')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('update_events');
        Schema::dropIfExists('update_download_tokens');
        Schema::dropIfExists('update_deployment_targets');
        Schema::dropIfExists('update_deployments');
        Schema::dropIfExists('update_enrollment_codes');
        Schema::dropIfExists('update_clients');
        Schema::dropIfExists('update_packages');
        Schema::dropIfExists('update_releases');
    }
};
