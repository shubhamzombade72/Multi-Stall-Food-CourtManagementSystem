<?php

namespace App\Services\Update;

/**
 * Checks a release manifest before the service accepts it. The private key never comes here; only the public keys listed
 * in FOODCOURT_UPDATE_TRUSTED_KEYS ("id:base64,id2:base64"). Without sodium or without a trusted key nothing is accepted.
 */
class ManifestVerifier
{
    public const VERSION_PATTERN = '/^\d{1,4}\.\d{1,4}\.\d{1,6}$/';

    /** @return array{0: ?array, 1: ?string} parsed manifest and problem */
    public static function verify(string $raw, string $signatureBase64, string $keyId): array
    {
        if (!function_exists('sodium_crypto_sign_verify_detached')) {
            return [null, 'This server cannot check signatures (the sodium extension is missing).'];
        }
        $key = self::trustedKeys()[$keyId] ?? null;
        if (!$key) {
            return [null, 'The signing key is not trusted by this service.'];
        }
        $signature = base64_decode($signatureBase64, true);
        if ($signature === false || strlen($signature) !== SODIUM_CRYPTO_SIGN_BYTES) {
            return [null, 'The signature is malformed.'];
        }
        if (!sodium_crypto_sign_verify_detached($signature, $raw, $key)) {
            return [null, 'The signature does not match the manifest.'];
        }
        $manifest = json_decode($raw, true);
        if (!is_array($manifest) || ($manifest['format'] ?? null) !== 1) {
            return [null, 'The manifest format is not supported.'];
        }
        foreach (['release_id', 'version', 'package_type', 'payload_sha256', 'payload_size', 'tree'] as $field) {
            if (!isset($manifest[$field])) {
                return [null, "The manifest has no {$field}."];
            }
        }
        if (!preg_match(self::VERSION_PATTERN, (string) $manifest['version'])) {
            return [null, 'The manifest version is not valid.'];
        }
        if (!in_array($manifest['package_type'], ['incremental', 'full'], true)) {
            return [null, 'The package type is not valid.'];
        }
        if ($manifest['package_type'] === 'incremental' && empty($manifest['source_version'])) {
            return [null, 'An incremental package must name its source version.'];
        }
        if (!preg_match('/^[a-f0-9]{64}$/', (string) $manifest['payload_sha256'])) {
            return [null, 'The manifest payload hash is not valid.'];
        }

        return [$manifest, null];
    }

    public static function trustedKeys(): array
    {
        $keys = [];
        foreach (array_filter(explode(',', (string) config('foodcourt.updates.trusted_keys'))) as $entry) {
            [$id, $b64] = array_pad(explode(':', trim($entry), 2), 2, '');
            $raw = base64_decode($b64, true);
            if ($id !== '' && $raw !== false && strlen($raw) === 32) {
                $keys[$id] = $raw;
            }
        }

        return $keys;
    }
}
