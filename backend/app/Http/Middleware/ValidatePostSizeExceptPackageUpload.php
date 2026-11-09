<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Middleware\ValidatePostSize;
use Illuminate\Http\Request;

/**
 * Same size limit as before for every request, except the release package upload: that route is owner-only, streams the raw
 * body to disk instead of loading it, and keeps the file only if it matches the signed manifest's size and hash.
 */
class ValidatePostSizeExceptPackageUpload extends ValidatePostSize
{
    public function handle($request, Closure $next)
    {
        /** @var Request $request */
        if ($request->isMethod('PUT') && config('foodcourt.updates.service') && $request->is('api/update-admin/releases/*/packages/*/payload')) {
            return $next($request);
        }

        return parent::handle($request, $next);
    }
}
