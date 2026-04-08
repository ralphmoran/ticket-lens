# TicketLens Console — Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **ALSO REQUIRED before any UI/component work:** Invoke `ui-ux-pro-max` skill and `frontend-design` skill. Use Chrome Devtools MCP for visual inspection.
> **After each task:** Run `code-reviewer` agent. After each phase: run `code-simplifier`.

**Goal:** Install Inertia.js + Vue 3, establish the bitwise permission system (PHP enum, TS mirror, models, service, middleware), add auth (login/register), and wire up the base ConsoleLayout — everything needed before any module can be built.

**Architecture:** Standard Laravel web guard (session + CSRF) serves Inertia responses. No Sanctum or token auth for the Console — the existing bearer-token CLI routes (`/v1/...`) are untouched. `PermissionService::effective()` OR's user + group bits; result is shared with every Inertia page via `HandleInertiaRequests`. Frontend receives a single `effectivePermissions` integer and checks `(bits & PERMISSION) !== 0`.

**Tech Stack:** PHP 8.4, Laravel 11, Inertia.js `^2.0`, Vue 3 `<script setup>`, `@vitejs/plugin-vue`, Tailwind CSS v4, PHPUnit (feature + unit), Vite 8.

---

## File Map

### New files
| File | Responsibility |
|---|---|
| `app/Enums/Permission.php` | Bitwise constants + tier composites |
| `resources/js/permissions.ts` | TS mirror of Permission.php |
| `resources/js/composables/usePermissions.ts` | `can(bit)` composable |
| `app/Models/Group.php` | Group model + `users()` BelongsToMany |
| `app/Models/License.php` | License model + `user()` BelongsTo |
| `app/Services/PermissionService.php` | `effective(User): int` + `can(User, int): bool` |
| `app/Http/Middleware/HasPermission.php` | Route-level permission guard |
| `app/Http/Middleware/HandleInertiaRequests.php` | Shares auth user + effectivePermissions |
| `app/Http/Controllers/Auth/LoginController.php` | Show + handle login form |
| `app/Http/Controllers/Auth/RegisterController.php` | Show + handle register form |
| `resources/views/app.blade.php` | Inertia root template |
| `resources/js/Pages/Auth/Login.vue` | Login page |
| `resources/js/Pages/Auth/Register.vue` | Register page |
| `resources/js/Layouts/ConsoleLayout.vue` | Sidebar + nav shell |
| `resources/js/Pages/Console/Index.vue` | `/console` landing (redirects to `/console/analytics`) |
| `database/migrations/*_add_console_fields_to_users_table.php` | Adds `tier`, `permissions` to users |
| `database/migrations/*_create_groups_table.php` | `groups` + `group_user` pivot |
| `database/migrations/*_create_licenses_table.php` | `licenses` table |
| `database/migrations/*_create_usage_logs_table.php` | `usage_logs` table (for Analytics module) |

### Modified files
| File | Change |
|---|---|
| `package.json` | Add `@inertiajs/vue3`, `vue`, `@vitejs/plugin-vue` |
| `vite.config.js` | Add `@vitejs/plugin-vue` plugin |
| `app/Models/User.php` | Add `tier`, `permissions` attributes, `groups()` + `license()` relationships |
| `database/factories/UserFactory.php` | Add `tier` + `permissions` defaults |
| `bootstrap/app.php` | Register `HandleInertiaRequests` in web stack, alias `permission` middleware |
| `routes/web.php` | Add auth routes + console routes |

### Test files
| File | Tests |
|---|---|
| `tests/Unit/Services/PermissionServiceTest.php` | effective() with no groups / one group / multiple groups / downgrade preserves admin |
| `tests/Feature/Console/PermissionMiddlewareTest.php` | HasPermission blocks/allows based on bitmask |
| `tests/Feature/Console/AuthTest.php` | Login, register, redirect, logout |
| `tests/Feature/Console/InertiaShareTest.php` | effectivePermissions in Inertia shared data |
| `tests/Feature/Console/ConsoleLayoutTest.php` | Authenticated /console redirects to /console/analytics |

---

## Task 1: Install npm + composer dependencies

**Files:**
- Modify: `package.json`
- Modify: `vite.config.js`

- [ ] **Step 1: Install npm packages**

```bash
cd ~/Desktop/Projects/ticketlens-api
npm install @inertiajs/vue3 vue @vitejs/plugin-vue
```

Expected output includes: `added N packages`

- [ ] **Step 2: Require Inertia Laravel adapter**

```bash
composer require inertiajs/inertia-laravel
```

Expected: `Package operations: 1 install`

- [ ] **Step 3: Publish Inertia middleware**

```bash
php artisan inertia:middleware
```

Expected: `INFO  Inertia middleware [app/Http/Middleware/HandleInertiaRequests.php] created successfully.`

- [ ] **Step 4: Update vite.config.js to add Vue plugin**

```js
// vite.config.js — full replacement
import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
    plugins: [
        laravel({
            input: ['resources/css/app.css', 'resources/js/app.js'],
            refresh: true,
        }),
        tailwindcss(),
        vue(),
    ],
    resolve: {
        alias: { '@': '/resources/js' },
    },
    server: {
        watch: { ignored: ['**/storage/framework/views/**'] },
    },
});
```

- [ ] **Step 5: Verify build**

```bash
npm run build
```

Expected: Build completes with no errors. Ignore asset size warnings.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vite.config.js composer.json composer.lock app/Http/Middleware/HandleInertiaRequests.php
git commit -m "chore: install Inertia.js, Vue 3, and plugin-vue"
```

---

## Task 2: Inertia root template + app.js bootstrap

**Files:**
- Create: `resources/views/app.blade.php`
- Modify: `resources/js/app.js`

- [ ] **Step 1: Create Inertia root template**

```blade
{{-- resources/views/app.blade.php --}}
<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title inertia>TicketLens Console</title>
    @vite(['resources/css/app.css', 'resources/js/app.js'])
    @inertiaHead
</head>
<body class="bg-gray-950 text-gray-100 antialiased">
    @inertia
</body>
</html>
```

- [ ] **Step 2: Replace resources/js/app.js with Inertia bootstrap**

```js
// resources/js/app.js
import { createApp, h } from 'vue'
import { createInertiaApp } from '@inertiajs/vue3'
import { resolvePageComponent } from 'laravel-vite-plugin/inertia-helpers'

createInertiaApp({
    title: title => title ? `${title} — TicketLens Console` : 'TicketLens Console',
    resolve: name => resolvePageComponent(
        `./Pages/${name}.vue`,
        import.meta.glob('./Pages/**/*.vue'),
    ),
    setup({ el, App, props, plugin }) {
        createApp({ render: () => h(App, props) })
            .use(plugin)
            .mount(el)
    },
    progress: { color: '#22C55E' },
})
```

- [ ] **Step 3: Add a smoke-test route to routes/web.php**

```php
// routes/web.php — add below existing welcome route
Route::get('/inertia-test', fn () => inertia('Test'))->name('inertia.test');
```

- [ ] **Step 4: Create the test page**

```vue
<!-- resources/js/Pages/Test.vue -->
<script setup>
</script>
<template>
  <div class="p-8 text-green-400 font-mono">Inertia + Vue 3 ✓</div>
</template>
```

- [ ] **Step 5: Write a feature test for the Inertia response**

```php
// tests/Feature/Console/InertiaBootstrapTest.php
<?php

namespace Tests\Feature\Console;

use Tests\TestCase;

class InertiaBootstrapTest extends TestCase
{
    public function test_inertia_test_route_returns_inertia_response(): void
    {
        $response = $this->withHeaders(['X-Inertia' => 'true'])
            ->get('/inertia-test');

        $response->assertOk();
        $response->assertJson(['component' => 'Test']);
    }
}
```

- [ ] **Step 6: Run test to verify it fails (Test.vue exists but Inertia response not yet configured)**

```bash
cd ~/Desktop/Projects/ticketlens-api && php artisan test tests/Feature/Console/InertiaBootstrapTest.php
```

Expected: FAIL — `HandleInertiaRequests` middleware not yet registered in web stack.

- [ ] **Step 7: Register HandleInertiaRequests in bootstrap/app.php web middleware**

In `bootstrap/app.php`, inside `->withMiddleware(function (Middleware $middleware)`, add:

```php
$middleware->web(append: [
    \App\Http\Middleware\HandleInertiaRequests::class,
]);
```

- [ ] **Step 8: Run test to verify it passes**

```bash
php artisan test tests/Feature/Console/InertiaBootstrapTest.php
```

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add resources/views/app.blade.php resources/js/app.js bootstrap/app.php routes/web.php resources/js/Pages/Test.vue tests/Feature/Console/InertiaBootstrapTest.php
git commit -m "feat: add Inertia root template and Vue 3 bootstrap"
```

---

## Task 3: Permission enum (PHP) + TypeScript mirror

**Files:**
- Create: `app/Enums/Permission.php`
- Create: `resources/js/permissions.ts`
- Test: `tests/Unit/Enums/PermissionTest.php`

- [ ] **Step 1: Write the failing unit test**

```php
// tests/Unit/Enums/PermissionTest.php
<?php

namespace Tests\Unit\Enums;

use App\Enums\Permission;
use Tests\TestCase;

class PermissionTest extends TestCase
{
    public function test_each_bit_is_a_distinct_power_of_two(): void
    {
        $bits = [
            Permission::SCHEDULES,
            Permission::DIGESTS,
            Permission::SUMMARIZE,
            Permission::COMPLIANCE,
            Permission::EXPORT,
            Permission::MULTI_ACCOUNT,
            Permission::SAVINGS_ANALYTICS,
            Permission::ADMIN_USERS,
            Permission::ADMIN_LICENSES,
            Permission::ADMIN_REVENUE,
        ];

        $this->assertCount(count($bits), array_unique($bits));

        foreach ($bits as $bit) {
            $this->assertSame(1, substr_count(decbin($bit), '1'), "Bit {$bit} is not a power of two");
        }
    }

    public function test_tier_free_has_only_savings_analytics(): void
    {
        $this->assertSame(Permission::SAVINGS_ANALYTICS, Permission::TIER_FREE);
    }

    public function test_tier_pro_includes_schedules_digests_summarize_analytics(): void
    {
        $this->assertSame(
            Permission::SCHEDULES | Permission::DIGESTS | Permission::SUMMARIZE | Permission::SAVINGS_ANALYTICS,
            Permission::TIER_PRO
        );
    }

    public function test_tier_team_includes_all_tier_pro_bits_plus_compliance_export_multi_account(): void
    {
        $this->assertSame(
            Permission::TIER_PRO | Permission::COMPLIANCE | Permission::EXPORT | Permission::MULTI_ACCOUNT,
            Permission::TIER_TEAM
        );
    }

    public function test_admin_mask_covers_all_admin_bits(): void
    {
        $this->assertSame(
            Permission::ADMIN_USERS | Permission::ADMIN_LICENSES | Permission::ADMIN_REVENUE,
            Permission::ADMIN_MASK
        );
    }

    public function test_tier_map_keys_match_tier_strings(): void
    {
        $this->assertArrayHasKey('free', Permission::TIER_MAP);
        $this->assertArrayHasKey('pro', Permission::TIER_MAP);
        $this->assertArrayHasKey('team', Permission::TIER_MAP);
        $this->assertArrayHasKey('enterprise', Permission::TIER_MAP);
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
php artisan test tests/Unit/Enums/PermissionTest.php
```

Expected: FAIL — `App\Enums\Permission` not found.

- [ ] **Step 3: Create app/Enums/Permission.php**

```php
<?php

namespace App\Enums;

final class Permission
{
    const SCHEDULES         = 1 << 0;  //   1
    const DIGESTS           = 1 << 1;  //   2
    const SUMMARIZE         = 1 << 2;  //   4
    const COMPLIANCE        = 1 << 3;  //   8
    const EXPORT            = 1 << 4;  //  16
    const MULTI_ACCOUNT     = 1 << 5;  //  32
    const SAVINGS_ANALYTICS = 1 << 6;  //  64
    const ADMIN_USERS       = 1 << 7;  // 128
    const ADMIN_LICENSES    = 1 << 8;  // 256
    const ADMIN_REVENUE     = 1 << 9;  // 512

    // Tier composites — never stored in DB
    const TIER_FREE       = self::SAVINGS_ANALYTICS;                                                       //  64
    const TIER_PRO        = self::SCHEDULES | self::DIGESTS | self::SUMMARIZE | self::SAVINGS_ANALYTICS;   //  71
    const TIER_TEAM       = self::TIER_PRO | self::COMPLIANCE | self::EXPORT | self::MULTI_ACCOUNT;        // 127
    const TIER_ENTERPRISE = self::TIER_TEAM;                                                               // 127

    const ADMIN_MASK = self::ADMIN_USERS | self::ADMIN_LICENSES | self::ADMIN_REVENUE; // 896

    const TIER_MAP = [
        'free'       => self::TIER_FREE,
        'pro'        => self::TIER_PRO,
        'team'       => self::TIER_TEAM,
        'enterprise' => self::TIER_ENTERPRISE,
    ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
php artisan test tests/Unit/Enums/PermissionTest.php
```

Expected: PASS (5 tests)

- [ ] **Step 5: Create resources/js/permissions.ts**

```ts
// resources/js/permissions.ts
export const PERMISSIONS = {
    SCHEDULES:         1 << 0,  //   1
    DIGESTS:           1 << 1,  //   2
    SUMMARIZE:         1 << 2,  //   4
    COMPLIANCE:        1 << 3,  //   8
    EXPORT:            1 << 4,  //  16
    MULTI_ACCOUNT:     1 << 5,  //  32
    SAVINGS_ANALYTICS: 1 << 6,  //  64
    ADMIN_USERS:       1 << 7,  // 128
    ADMIN_LICENSES:    1 << 8,  // 256
    ADMIN_REVENUE:     1 << 9,  // 512
} as const

export type PermissionKey = keyof typeof PERMISSIONS
export type PermissionValue = (typeof PERMISSIONS)[PermissionKey]
```

- [ ] **Step 6: Commit**

```bash
git add app/Enums/Permission.php resources/js/permissions.ts tests/Unit/Enums/PermissionTest.php
git commit -m "feat: add bitwise Permission enum and TypeScript mirror"
```

---

## Task 4: Migration — add tier + permissions to users

**Files:**
- Create: `database/migrations/2026_04_07_000001_add_console_fields_to_users_table.php`
- Test: `tests/Feature/Console/UserSchemaTest.php`

- [ ] **Step 1: Write the failing test**

```php
// tests/Feature/Console/UserSchemaTest.php
<?php

namespace Tests\Feature\Console;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class UserSchemaTest extends TestCase
{
    use RefreshDatabase;

    public function test_users_table_has_tier_column(): void
    {
        $this->assertTrue(Schema::hasColumn('users', 'tier'));
    }

    public function test_users_table_has_permissions_column(): void
    {
        $this->assertTrue(Schema::hasColumn('users', 'permissions'));
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
php artisan test tests/Feature/Console/UserSchemaTest.php
```

Expected: FAIL — columns don't exist yet.

- [ ] **Step 3: Create migration**

```bash
php artisan make:migration add_console_fields_to_users_table
```

Edit the generated file — replace its content with:

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('tier')->default('free')->after('email');
            $table->unsignedInteger('permissions')->default(0)->after('tier');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['tier', 'permissions']);
        });
    }
};
```

- [ ] **Step 4: Run migration**

```bash
php artisan migrate
```

Expected: Migration runs without error.

- [ ] **Step 5: Run tests to verify they pass**

```bash
php artisan test tests/Feature/Console/UserSchemaTest.php
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add database/migrations/ tests/Feature/Console/UserSchemaTest.php
git commit -m "feat: add tier and permissions columns to users table"
```

---

## Task 5: Migration — groups + group_user tables

**Files:**
- Create: `database/migrations/2026_04_07_000002_create_groups_table.php`
- Test: add to `tests/Feature/Console/UserSchemaTest.php`

- [ ] **Step 1: Add failing tests to UserSchemaTest.php**

Append to the class in `tests/Feature/Console/UserSchemaTest.php`:

```php
public function test_groups_table_exists(): void
{
    $this->assertTrue(Schema::hasTable('groups'));
}

public function test_groups_table_has_permissions_column(): void
{
    $this->assertTrue(Schema::hasColumn('groups', 'permissions'));
}

public function test_group_user_pivot_exists(): void
{
    $this->assertTrue(Schema::hasTable('group_user'));
}
```

- [ ] **Step 2: Run to verify failure**

```bash
php artisan test tests/Feature/Console/UserSchemaTest.php
```

Expected: 3 new FAILs.

- [ ] **Step 3: Create migration**

```bash
php artisan make:migration create_groups_table
```

Replace generated content:

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('groups', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->unsignedInteger('permissions')->default(0);
            $table->timestamps();
        });

        Schema::create('group_user', function (Blueprint $table) {
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('group_id')->constrained()->cascadeOnDelete();
            $table->primary(['user_id', 'group_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('group_user');
        Schema::dropIfExists('groups');
    }
};
```

- [ ] **Step 4: Run migration**

```bash
php artisan migrate
```

- [ ] **Step 5: Run tests**

```bash
php artisan test tests/Feature/Console/UserSchemaTest.php
```

Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add database/migrations/ tests/Feature/Console/UserSchemaTest.php
git commit -m "feat: add groups and group_user tables"
```

---

## Task 6: Migration — licenses table

**Files:**
- Create: `database/migrations/2026_04_07_000003_create_licenses_table.php`

- [ ] **Step 1: Add failing test**

Append to `tests/Feature/Console/UserSchemaTest.php`:

```php
public function test_licenses_table_exists(): void
{
    $this->assertTrue(Schema::hasTable('licenses'));
}

public function test_licenses_table_has_lemon_key_column(): void
{
    $this->assertTrue(Schema::hasColumn('licenses', 'lemon_key'));
}
```

- [ ] **Step 2: Run to verify failure**

```bash
php artisan test tests/Feature/Console/UserSchemaTest.php
```

Expected: 2 FAILs.

- [ ] **Step 3: Create migration**

```bash
php artisan make:migration create_licenses_table
```

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('licenses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('lemon_key', 255)->unique();
            $table->string('status', 20)->default('active'); // active|cancelled|expired|paused
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('licenses');
    }
};
```

- [ ] **Step 4: Run migration + tests**

```bash
php artisan migrate && php artisan test tests/Feature/Console/UserSchemaTest.php
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add database/migrations/ tests/Feature/Console/UserSchemaTest.php
git commit -m "feat: add licenses table"
```

---

## Task 7: Migration — usage_logs table

**Files:**
- Create: `database/migrations/2026_04_07_000004_create_usage_logs_table.php`

- [ ] **Step 1: Add failing test**

Append to `tests/Feature/Console/UserSchemaTest.php`:

```php
public function test_usage_logs_table_exists(): void
{
    $this->assertTrue(Schema::hasTable('usage_logs'));
}
```

- [ ] **Step 2: Run to verify failure**

```bash
php artisan test tests/Feature/Console/UserSchemaTest.php
```

Expected: 1 FAIL.

- [ ] **Step 3: Create migration**

```bash
php artisan make:migration create_usage_logs_table
```

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('usage_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('action', 50); // summarize|compliance|digest|schedule
            $table->unsignedInteger('tokens_saved')->default(0);
            $table->timestamp('logged_at');
            $table->index(['user_id', 'logged_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('usage_logs');
    }
};
```

- [ ] **Step 4: Run migration + tests**

```bash
php artisan migrate && php artisan test tests/Feature/Console/UserSchemaTest.php
```

Expected: PASS (all schema tests)

- [ ] **Step 5: Commit**

```bash
git add database/migrations/ tests/Feature/Console/UserSchemaTest.php
git commit -m "feat: add usage_logs table for Savings Analytics"
```

---

## Task 8: Group model + update User model

**Files:**
- Create: `app/Models/Group.php`
- Modify: `app/Models/User.php`
- Modify: `database/factories/UserFactory.php`
- Test: `tests/Unit/Models/UserGroupTest.php`

- [ ] **Step 1: Write failing tests**

```php
// tests/Unit/Models/UserGroupTest.php
<?php

namespace Tests\Unit\Models;

use App\Models\Group;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class UserGroupTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_has_groups_relationship(): void
    {
        $user = User::factory()->create();
        $this->assertInstanceOf(\Illuminate\Database\Eloquent\Collection::class, $user->groups);
    }

    public function test_group_has_users_relationship(): void
    {
        $group = Group::create(['name' => 'Admins', 'permissions' => 0]);
        $this->assertInstanceOf(\Illuminate\Database\Eloquent\Collection::class, $group->users);
    }

    public function test_user_can_be_assigned_to_group(): void
    {
        $user = User::factory()->create();
        $group = Group::create(['name' => 'Editors', 'permissions' => 3]);

        $user->groups()->attach($group);

        $this->assertTrue($user->groups->contains($group));
    }

    public function test_user_tier_defaults_to_free(): void
    {
        $user = User::factory()->create();
        $this->assertSame('free', $user->tier);
    }

    public function test_user_permissions_defaults_to_zero(): void
    {
        $user = User::factory()->create();
        $this->assertSame(0, $user->permissions);
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
php artisan test tests/Unit/Models/UserGroupTest.php
```

Expected: FAIL — Group model and relationships don't exist.

- [ ] **Step 3: Create app/Models/Group.php**

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Group extends Model
{
    protected $fillable = ['name', 'permissions'];

    protected function casts(): array
    {
        return ['permissions' => 'integer'];
    }

    public function users(): BelongsToMany
    {
        return $this->belongsToMany(User::class);
    }
}
```

- [ ] **Step 4: Update app/Models/User.php**

```php
<?php

namespace App\Models;

use App\Enums\Permission;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

#[Fillable(['name', 'email', 'password', 'tier', 'permissions'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable;

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password'          => 'hashed',
            'permissions'       => 'integer',
        ];
    }

    public function groups(): BelongsToMany
    {
        return $this->belongsToMany(Group::class);
    }

    public function license(): HasOne
    {
        return $this->hasOne(License::class);
    }
}
```

- [ ] **Step 5: Update database/factories/UserFactory.php — add tier and permissions defaults**

Open `database/factories/UserFactory.php` and add `tier` and `permissions` to the `definition()` array:

```php
'tier'        => 'free',
'permissions' => \App\Enums\Permission::TIER_FREE,
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
php artisan test tests/Unit/Models/UserGroupTest.php
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/Models/Group.php app/Models/User.php database/factories/UserFactory.php tests/Unit/Models/UserGroupTest.php
git commit -m "feat: add Group model and User relationships for permission system"
```

---

## Task 9: License model

**Files:**
- Create: `app/Models/License.php`
- Create: `database/factories/LicenseFactory.php`
- Test: `tests/Unit/Models/LicenseTest.php`

- [ ] **Step 1: Write failing tests**

```php
// tests/Unit/Models/LicenseTest.php
<?php

namespace Tests\Unit\Models;

use App\Models\License;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class LicenseTest extends TestCase
{
    use RefreshDatabase;

    public function test_license_belongs_to_user(): void
    {
        $user = User::factory()->create();
        $license = License::create([
            'user_id'   => $user->id,
            'lemon_key' => 'test-key-123',
            'status'    => 'active',
        ]);

        $this->assertTrue($license->user->is($user));
    }

    public function test_user_has_one_license(): void
    {
        $user = User::factory()->create();
        License::create([
            'user_id'   => $user->id,
            'lemon_key' => 'key-abc',
            'status'    => 'active',
        ]);

        $this->assertInstanceOf(License::class, $user->license);
    }

    public function test_license_status_defaults_to_active(): void
    {
        $user = User::factory()->create();
        $license = License::create(['user_id' => $user->id, 'lemon_key' => 'key-xyz']);

        $this->assertSame('active', $license->status);
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
php artisan test tests/Unit/Models/LicenseTest.php
```

Expected: FAIL — License model doesn't exist.

- [ ] **Step 3: Create app/Models/License.php**

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class License extends Model
{
    protected $fillable = ['user_id', 'lemon_key', 'status', 'expires_at'];

    protected function casts(): array
    {
        return ['expires_at' => 'datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
```

- [ ] **Step 4: Run tests**

```bash
php artisan test tests/Unit/Models/LicenseTest.php
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/Models/License.php tests/Unit/Models/LicenseTest.php
git commit -m "feat: add License model"
```

---

## Task 10: PermissionService

**Files:**
- Create: `app/Services/PermissionService.php`
- Test: `tests/Unit/Services/PermissionServiceTest.php`

- [ ] **Step 1: Write failing tests**

```php
// tests/Unit/Services/PermissionServiceTest.php
<?php

namespace Tests\Unit\Services;

use App\Enums\Permission;
use App\Models\Group;
use App\Models\User;
use App\Services\PermissionService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PermissionServiceTest extends TestCase
{
    use RefreshDatabase;

    private PermissionService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new PermissionService();
    }

    public function test_effective_returns_user_permissions_when_no_groups(): void
    {
        $user = User::factory()->create(['permissions' => Permission::TIER_PRO]);

        $this->assertSame(Permission::TIER_PRO, $this->service->effective($user));
    }

    public function test_effective_ors_group_permissions_with_user_permissions(): void
    {
        $user = User::factory()->create(['permissions' => Permission::SCHEDULES]);
        $group = Group::create(['name' => 'Ops', 'permissions' => Permission::DIGESTS]);
        $user->groups()->attach($group);

        $expected = Permission::SCHEDULES | Permission::DIGESTS;
        $this->assertSame($expected, $this->service->effective($user->fresh()));
    }

    public function test_effective_ors_multiple_group_permissions(): void
    {
        $user = User::factory()->create(['permissions' => 0]);
        $g1 = Group::create(['name' => 'G1', 'permissions' => Permission::SCHEDULES]);
        $g2 = Group::create(['name' => 'G2', 'permissions' => Permission::COMPLIANCE]);
        $user->groups()->attach([$g1->id, $g2->id]);

        $expected = Permission::SCHEDULES | Permission::COMPLIANCE;
        $this->assertSame($expected, $this->service->effective($user->fresh()));
    }

    public function test_can_returns_true_when_bit_is_set(): void
    {
        $user = User::factory()->create(['permissions' => Permission::TIER_PRO]);

        $this->assertTrue($this->service->can($user, Permission::SCHEDULES));
        $this->assertTrue($this->service->can($user, Permission::SAVINGS_ANALYTICS));
    }

    public function test_can_returns_false_when_bit_not_set(): void
    {
        $user = User::factory()->create(['permissions' => Permission::TIER_FREE]);

        $this->assertFalse($this->service->can($user, Permission::SCHEDULES));
        $this->assertFalse($this->service->can($user, Permission::ADMIN_REVENUE));
    }

    public function test_tier_upgrade_preserves_admin_bits(): void
    {
        // Simulate: user had admin bits + old tier; tier changes but admin bits stay
        $adminAndPro = Permission::ADMIN_USERS | Permission::TIER_PRO;
        $user = User::factory()->create(['permissions' => $adminAndPro]);

        $newPerms = ($user->permissions & Permission::ADMIN_MASK) | Permission::TIER_TEAM;
        $user->update(['permissions' => $newPerms]);

        $this->assertTrue($this->service->can($user->fresh(), Permission::ADMIN_USERS));
        $this->assertTrue($this->service->can($user->fresh(), Permission::MULTI_ACCOUNT));
    }

    public function test_tier_downgrade_removes_old_tier_bits(): void
    {
        // Team user downgraded to Free: team bits stripped, admin bits preserved
        $teamAndAdmin = Permission::TIER_TEAM | Permission::ADMIN_USERS;
        $user = User::factory()->create(['permissions' => $teamAndAdmin]);

        $newPerms = ($user->permissions & Permission::ADMIN_MASK) | Permission::TIER_FREE;
        $user->update(['permissions' => $newPerms]);

        $this->assertFalse($this->service->can($user->fresh(), Permission::SCHEDULES));
        $this->assertTrue($this->service->can($user->fresh(), Permission::SAVINGS_ANALYTICS));
        $this->assertTrue($this->service->can($user->fresh(), Permission::ADMIN_USERS));
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
php artisan test tests/Unit/Services/PermissionServiceTest.php
```

Expected: FAIL — `App\Services\PermissionService` not found.

- [ ] **Step 3: Create app/Services/PermissionService.php**

```php
<?php

namespace App\Services;

use App\Models\User;

class PermissionService
{
    public function effective(User $user): int
    {
        return $user->groups->reduce(
            fn(int $carry, $group) => $carry | $group->permissions,
            $user->permissions
        );
    }

    public function can(User $user, int $bit): bool
    {
        return ($this->effective($user) & $bit) !== 0;
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
php artisan test tests/Unit/Services/PermissionServiceTest.php
```

Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add app/Services/PermissionService.php tests/Unit/Services/PermissionServiceTest.php
git commit -m "feat: add PermissionService with effective() and can()"
```

---

## Task 11: HasPermission middleware

**Files:**
- Create: `app/Http/Middleware/HasPermission.php`
- Modify: `bootstrap/app.php`
- Test: `tests/Feature/Console/PermissionMiddlewareTest.php`

- [ ] **Step 1: Write failing feature tests**

```php
// tests/Feature/Console/PermissionMiddlewareTest.php
<?php

namespace Tests\Feature\Console;

use App\Enums\Permission;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

class PermissionMiddlewareTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Route::get('/test-schedules', fn () => 'ok')
            ->middleware(['auth', 'permission:' . Permission::SCHEDULES]);
    }

    public function test_unauthenticated_user_is_redirected(): void
    {
        $this->get('/test-schedules')->assertRedirect('/login');
    }

    public function test_user_without_permission_is_redirected_to_upgrade(): void
    {
        $user = User::factory()->create(['permissions' => Permission::TIER_FREE]);

        $this->actingAs($user)->get('/test-schedules')->assertRedirect('/upgrade');
    }

    public function test_user_with_permission_passes_through(): void
    {
        $user = User::factory()->create(['permissions' => Permission::TIER_PRO]);

        $this->actingAs($user)->get('/test-schedules')->assertOk()->assertSee('ok');
    }

    public function test_admin_with_all_bits_passes_any_permission(): void
    {
        $allBits = Permission::TIER_TEAM | Permission::ADMIN_MASK;
        $user = User::factory()->create(['permissions' => $allBits]);

        $this->actingAs($user)->get('/test-schedules')->assertOk();
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
php artisan test tests/Feature/Console/PermissionMiddlewareTest.php
```

Expected: FAIL — `permission` middleware alias not registered.

- [ ] **Step 3: Create app/Http/Middleware/HasPermission.php**

```php
<?php

namespace App\Http\Middleware;

use App\Services\PermissionService;
use Closure;
use Illuminate\Http\Request;

class HasPermission
{
    public function __construct(private readonly PermissionService $permissions) {}

    public function handle(Request $request, Closure $next, int $bit): mixed
    {
        if (!$request->user() || !$this->permissions->can($request->user(), $bit)) {
            return $request->expectsJson()
                ? response()->json(['error' => 'Forbidden'], 403)
                : redirect('/upgrade');
        }

        return $next($request);
    }
}
```

- [ ] **Step 4: Register alias in bootstrap/app.php — add to $middleware->alias() block**

In `bootstrap/app.php`, update the alias block:

```php
$middleware->alias([
    'auth.license' => \App\Http\Middleware\ValidateLicenseKey::class,
    'permission'   => \App\Http\Middleware\HasPermission::class,
]);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
php artisan test tests/Feature/Console/PermissionMiddlewareTest.php
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/Http/Middleware/HasPermission.php bootstrap/app.php tests/Feature/Console/PermissionMiddlewareTest.php
git commit -m "feat: add HasPermission middleware with 'permission' alias"
```

---

## Task 12: Auth controllers + routes

**Files:**
- Create: `app/Http/Controllers/Auth/LoginController.php`
- Create: `app/Http/Controllers/Auth/RegisterController.php`
- Modify: `routes/web.php`
- Test: `tests/Feature/Console/AuthTest.php`

- [ ] **Step 1: Write failing auth tests**

```php
// tests/Feature/Console/AuthTest.php
<?php

namespace Tests\Feature\Console;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthTest extends TestCase
{
    use RefreshDatabase;

    public function test_login_page_renders(): void
    {
        $this->get('/login')->assertOk()->assertInertia(
            fn ($page) => $page->component('Auth/Login')
        );
    }

    public function test_register_page_renders(): void
    {
        $this->get('/register')->assertOk()->assertInertia(
            fn ($page) => $page->component('Auth/Register')
        );
    }

    public function test_user_can_login_with_valid_credentials(): void
    {
        $user = User::factory()->create(['email' => 'test@example.com', 'password' => bcrypt('password')]);

        $this->post('/login', ['email' => 'test@example.com', 'password' => 'password'])
            ->assertRedirect('/console');
    }

    public function test_login_fails_with_invalid_credentials(): void
    {
        $this->post('/login', ['email' => 'bad@example.com', 'password' => 'wrong'])
            ->assertSessionHasErrors('email');
    }

    public function test_user_can_register(): void
    {
        $this->post('/register', [
            'name'                  => 'Jane Dev',
            'email'                 => 'jane@example.com',
            'password'              => 'password123',
            'password_confirmation' => 'password123',
        ])->assertRedirect('/console');

        $this->assertDatabaseHas('users', ['email' => 'jane@example.com']);
    }

    public function test_authenticated_user_cannot_view_login(): void
    {
        $this->actingAs(User::factory()->create())
            ->get('/login')
            ->assertRedirect('/console');
    }

    public function test_unauthenticated_user_is_redirected_from_console(): void
    {
        $this->get('/console')->assertRedirect('/login');
    }

    public function test_user_can_logout(): void
    {
        $this->actingAs(User::factory()->create())
            ->post('/logout')
            ->assertRedirect('/');
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
php artisan test tests/Feature/Console/AuthTest.php
```

Expected: Multiple FAILs — routes and controllers don't exist.

- [ ] **Step 3: Create app/Http/Controllers/Auth/LoginController.php**

```php
<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Inertia\Inertia;
use Inertia\Response;

class LoginController extends Controller
{
    public function show(): Response|RedirectResponse
    {
        if (Auth::check()) {
            return redirect('/console');
        }

        return Inertia::render('Auth/Login');
    }

    public function store(Request $request): RedirectResponse
    {
        $credentials = $request->validate([
            'email'    => ['required', 'email'],
            'password' => ['required'],
        ]);

        if (!Auth::attempt($credentials, $request->boolean('remember'))) {
            return back()->withErrors(['email' => 'These credentials do not match our records.']);
        }

        $request->session()->regenerate();

        return redirect()->intended('/console');
    }

    public function destroy(Request $request): RedirectResponse
    {
        Auth::logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return redirect('/');
    }
}
```

- [ ] **Step 4: Create app/Http/Controllers/Auth/RegisterController.php**

```php
<?php

namespace App\Http\Controllers\Auth;

use App\Enums\Permission;
use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Auth\Events\Registered;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Inertia\Inertia;
use Inertia\Response;

class RegisterController extends Controller
{
    public function show(): Response|RedirectResponse
    {
        if (Auth::check()) {
            return redirect('/console');
        }

        return Inertia::render('Auth/Register');
    }

    public function store(Request $request): RedirectResponse
    {
        $data = $request->validate([
            'name'     => ['required', 'string', 'max:255'],
            'email'    => ['required', 'email', 'max:255', 'unique:users'],
            'password' => ['required', 'confirmed', 'min:8'],
        ]);

        $user = User::create([
            'name'        => $data['name'],
            'email'       => $data['email'],
            'password'    => Hash::make($data['password']),
            'tier'        => 'free',
            'permissions' => Permission::TIER_FREE,
        ]);

        event(new Registered($user));
        Auth::login($user);

        return redirect('/console');
    }
}
```

- [ ] **Step 5: Add auth + console routes to routes/web.php**

```php
<?php

use App\Http\Controllers\Auth\LoginController;
use App\Http\Controllers\Auth\RegisterController;
use App\Http\Controllers\Console\IndexController;
use Illuminate\Support\Facades\Route;

// Remove or keep the welcome route
Route::get('/', fn () => redirect('/login'));

// Auth
Route::middleware('guest')->group(function () {
    Route::get('/login', [LoginController::class, 'show'])->name('login');
    Route::get('/register', [RegisterController::class, 'show'])->name('register');
    Route::post('/login', [LoginController::class, 'store']);
    Route::post('/register', [RegisterController::class, 'store']);
});

Route::post('/logout', [LoginController::class, 'destroy'])->middleware('auth')->name('logout');

// Console
Route::middleware('auth')->prefix('console')->name('console.')->group(function () {
    Route::get('/', [IndexController::class, 'index'])->name('index');
});

// Upgrade page placeholder
Route::get('/upgrade', fn () => inertia('Upgrade'))->name('upgrade');
```

- [ ] **Step 6: Create console IndexController**

```php
// app/Http/Controllers/Console/IndexController.php
<?php

namespace App\Http\Controllers\Console;

use App\Http\Controllers\Controller;
use Illuminate\Http\RedirectResponse;

class IndexController extends Controller
{
    public function index(): RedirectResponse
    {
        return redirect()->route('console.analytics');
    }
}
```

- [ ] **Step 7: Add placeholder Upgrade page**

```vue
<!-- resources/js/Pages/Upgrade.vue -->
<script setup>
</script>
<template>
  <div class="p-8 text-yellow-400 font-mono">Upgrade your plan to access this feature.</div>
</template>
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
php artisan test tests/Feature/Console/AuthTest.php
```

Expected: PASS (8 tests)

- [ ] **Step 9: Commit**

```bash
git add app/Http/Controllers/ routes/web.php resources/js/Pages/Upgrade.vue tests/Feature/Console/AuthTest.php
git commit -m "feat: add login, register, and logout with Inertia controllers"
```

---

## Task 13: HandleInertiaRequests — share auth user + effectivePermissions

**Files:**
- Modify: `app/Http/Middleware/HandleInertiaRequests.php`
- Test: `tests/Feature/Console/InertiaShareTest.php`

- [ ] **Step 1: Write failing test**

```php
// tests/Feature/Console/InertiaShareTest.php
<?php

namespace Tests\Feature\Console;

use App\Enums\Permission;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class InertiaShareTest extends TestCase
{
    use RefreshDatabase;

    public function test_inertia_shares_null_auth_when_unauthenticated(): void
    {
        $this->withHeaders(['X-Inertia' => 'true'])
            ->get('/login')
            ->assertInertia(fn ($page) => $page->where('auth.user', null));
    }

    public function test_inertia_shares_user_with_effective_permissions(): void
    {
        $user = User::factory()->create(['permissions' => Permission::TIER_PRO]);

        $this->actingAs($user)
            ->withHeaders(['X-Inertia' => 'true'])
            ->get('/login')  // guest-redirected, but shares data before redirect check
            ->assertOk();

        // Test via a valid auth route
        $this->actingAs($user)
            ->withHeaders(['X-Inertia' => 'true'])
            ->get('/inertia-test')
            ->assertInertia(fn ($page) => $page
                ->has('auth.user.id')
                ->has('auth.user.effectivePermissions')
                ->where('auth.user.effectivePermissions', Permission::TIER_PRO)
            );
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
php artisan test tests/Feature/Console/InertiaShareTest.php
```

Expected: FAIL — `auth.user.effectivePermissions` not shared.

- [ ] **Step 3: Update HandleInertiaRequests.php**

```php
<?php

namespace App\Http\Middleware;

use App\Services\PermissionService;
use Illuminate\Http\Request;
use Inertia\Middleware;

class HandleInertiaRequests extends Middleware
{
    protected $rootView = 'app';

    public function version(Request $request): ?string
    {
        return parent::version($request);
    }

    public function share(Request $request): array
    {
        $user = $request->user();
        $permissionService = app(PermissionService::class);

        return array_merge(parent::share($request), [
            'auth' => [
                'user' => $user ? [
                    'id'                   => $user->id,
                    'name'                 => $user->name,
                    'email'                => $user->email,
                    'tier'                 => $user->tier,
                    'effectivePermissions' => $permissionService->effective($user),
                ] : null,
            ],
            'flash' => [
                'success' => fn () => $request->session()->get('success'),
                'error'   => fn () => $request->session()->get('error'),
            ],
        ]);
    }
}
```

- [ ] **Step 4: Run tests**

```bash
php artisan test tests/Feature/Console/InertiaShareTest.php
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/Http/Middleware/HandleInertiaRequests.php tests/Feature/Console/InertiaShareTest.php
git commit -m "feat: share auth user with effectivePermissions via Inertia middleware"
```

---

## Task 14: Auth Vue pages — Login.vue + Register.vue

**Files:**
- Create: `resources/js/Pages/Auth/Login.vue`
- Create: `resources/js/Pages/Auth/Register.vue`

*(No server-side TDD here — the auth feature tests in Task 12 already cover the HTTP layer. These tasks build the UI forms that submit to those routes.)*

- [ ] **Step 1: Invoke ui-ux-pro-max skill before writing any UI**

Run: `Skill({ skill: "ui-ux-pro-max" })` in your session before proceeding.

- [ ] **Step 2: Create resources/js/Pages/Auth/Login.vue**

```vue
<script setup>
import { useForm } from '@inertiajs/vue3'

const form = useForm({
    email: '',
    password: '',
    remember: false,
})

const submit = () => form.post('/login')
</script>

<template>
  <div class="min-h-screen bg-gray-950 flex items-center justify-center">
    <div class="w-full max-w-sm space-y-6 px-4">

      <div class="text-center">
        <p class="font-mono text-green-400 text-xl font-bold">TicketLens</p>
        <p class="text-gray-400 text-sm mt-1">Console</p>
      </div>

      <form @submit.prevent="submit" class="space-y-4">
        <div>
          <label class="block text-sm text-gray-300 mb-1">Email</label>
          <input
            v-model="form.email"
            type="email"
            autocomplete="email"
            class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-gray-100 focus:outline-none focus:border-green-500"
          />
          <p v-if="form.errors.email" class="text-red-400 text-xs mt-1">{{ form.errors.email }}</p>
        </div>

        <div>
          <label class="block text-sm text-gray-300 mb-1">Password</label>
          <input
            v-model="form.password"
            type="password"
            autocomplete="current-password"
            class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-gray-100 focus:outline-none focus:border-green-500"
          />
          <p v-if="form.errors.password" class="text-red-400 text-xs mt-1">{{ form.errors.password }}</p>
        </div>

        <button
          type="submit"
          :disabled="form.processing"
          class="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-medium py-2 rounded transition-colors"
        >
          {{ form.processing ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>

      <p class="text-center text-sm text-gray-500">
        No account?
        <a href="/register" class="text-green-400 hover:underline">Register</a>
      </p>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Create resources/js/Pages/Auth/Register.vue**

```vue
<script setup>
import { useForm } from '@inertiajs/vue3'

const form = useForm({
    name: '',
    email: '',
    password: '',
    password_confirmation: '',
})

const submit = () => form.post('/register')
</script>

<template>
  <div class="min-h-screen bg-gray-950 flex items-center justify-center">
    <div class="w-full max-w-sm space-y-6 px-4">

      <div class="text-center">
        <p class="font-mono text-green-400 text-xl font-bold">TicketLens</p>
        <p class="text-gray-400 text-sm mt-1">Create your account</p>
      </div>

      <form @submit.prevent="submit" class="space-y-4">
        <div>
          <label class="block text-sm text-gray-300 mb-1">Name</label>
          <input
            v-model="form.name"
            type="text"
            autocomplete="name"
            class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-gray-100 focus:outline-none focus:border-green-500"
          />
          <p v-if="form.errors.name" class="text-red-400 text-xs mt-1">{{ form.errors.name }}</p>
        </div>

        <div>
          <label class="block text-sm text-gray-300 mb-1">Email</label>
          <input
            v-model="form.email"
            type="email"
            autocomplete="email"
            class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-gray-100 focus:outline-none focus:border-green-500"
          />
          <p v-if="form.errors.email" class="text-red-400 text-xs mt-1">{{ form.errors.email }}</p>
        </div>

        <div>
          <label class="block text-sm text-gray-300 mb-1">Password</label>
          <input
            v-model="form.password"
            type="password"
            autocomplete="new-password"
            class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-gray-100 focus:outline-none focus:border-green-500"
          />
          <p v-if="form.errors.password" class="text-red-400 text-xs mt-1">{{ form.errors.password }}</p>
        </div>

        <div>
          <label class="block text-sm text-gray-300 mb-1">Confirm Password</label>
          <input
            v-model="form.password_confirmation"
            type="password"
            autocomplete="new-password"
            class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-gray-100 focus:outline-none focus:border-green-500"
          />
        </div>

        <button
          type="submit"
          :disabled="form.processing"
          class="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-medium py-2 rounded transition-colors"
        >
          {{ form.processing ? 'Creating account…' : 'Create account' }}
        </button>
      </form>

      <p class="text-center text-sm text-gray-500">
        Already have an account?
        <a href="/login" class="text-green-400 hover:underline">Sign in</a>
      </p>
    </div>
  </div>
</template>
```

- [ ] **Step 4: Run the full auth test suite**

```bash
php artisan test tests/Feature/Console/AuthTest.php
```

Expected: PASS (all 8 tests — controllers were already tested; this confirms the pages render)

- [ ] **Step 5: Commit**

```bash
git add resources/js/Pages/Auth/
git commit -m "feat: add Login and Register Inertia pages"
```

---

## Task 15: usePermissions composable + ConsoleLayout + Console/Index

**Files:**
- Create: `resources/js/composables/usePermissions.ts`
- Create: `resources/js/Layouts/ConsoleLayout.vue`
- Create: `resources/js/Pages/Console/Index.vue`
- Create: `app/Http/Controllers/Console/AnalyticsController.php` (stub — returns Inertia page)
- Modify: `routes/web.php` — add `console.analytics` named route
- Test: `tests/Feature/Console/ConsoleLayoutTest.php`

- [ ] **Step 1: Write failing tests**

```php
// tests/Feature/Console/ConsoleLayoutTest.php
<?php

namespace Tests\Feature\Console;

use App\Enums\Permission;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ConsoleLayoutTest extends TestCase
{
    use RefreshDatabase;

    public function test_console_root_redirects_to_analytics(): void
    {
        $user = User::factory()->create(['permissions' => Permission::TIER_PRO]);

        $this->actingAs($user)
            ->get('/console')
            ->assertRedirect('/console/analytics');
    }

    public function test_console_analytics_returns_inertia_page(): void
    {
        $user = User::factory()->create(['permissions' => Permission::TIER_PRO]);

        $this->actingAs($user)
            ->get('/console/analytics')
            ->assertOk()
            ->assertInertia(fn ($page) => $page->component('Console/Analytics'));
    }

    public function test_free_user_can_access_analytics(): void
    {
        $user = User::factory()->create(['permissions' => Permission::TIER_FREE]);

        $this->actingAs($user)->get('/console/analytics')->assertOk();
    }

    public function test_free_user_cannot_access_schedules(): void
    {
        $user = User::factory()->create(['permissions' => Permission::TIER_FREE]);

        $this->actingAs($user)->get('/console/schedules')->assertRedirect('/upgrade');
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
php artisan test tests/Feature/Console/ConsoleLayoutTest.php
```

Expected: FAILs — routes and controller don't exist.

- [ ] **Step 3: Create analytics stub controller**

```php
// app/Http/Controllers/Console/AnalyticsController.php
<?php

namespace App\Http\Controllers\Console;

use App\Http\Controllers\Controller;
use Inertia\Inertia;
use Inertia\Response;

class AnalyticsController extends Controller
{
    public function index(): Response
    {
        return Inertia::render('Console/Analytics');
    }
}
```

- [ ] **Step 4: Add analytics + schedules routes to routes/web.php console group**

Update the `console` route group in `routes/web.php`:

```php
Route::middleware('auth')->prefix('console')->name('console.')->group(function () {
    Route::get('/', [IndexController::class, 'index'])->name('index');

    Route::get('/analytics', [\App\Http\Controllers\Console\AnalyticsController::class, 'index'])
        ->middleware('permission:' . \App\Enums\Permission::SAVINGS_ANALYTICS)
        ->name('analytics');

    Route::get('/schedules', fn () => inertia('Console/Schedules'))
        ->middleware('permission:' . \App\Enums\Permission::SCHEDULES)
        ->name('schedules');
});
```

- [ ] **Step 5: Create Console/Analytics.vue stub page**

```vue
<!-- resources/js/Pages/Console/Analytics.vue -->
<script setup>
import ConsoleLayout from '@/Layouts/ConsoleLayout.vue'
defineOptions({ layout: ConsoleLayout })
</script>
<template>
  <div class="p-6">
    <h1 class="text-lg font-mono text-green-400">Savings Analytics</h1>
    <p class="text-gray-400 mt-2 text-sm">Coming in Phase 2.</p>
  </div>
</template>
```

- [ ] **Step 6: Create resources/js/composables/usePermissions.ts**

```ts
// resources/js/composables/usePermissions.ts
import { usePage } from '@inertiajs/vue3'
import { PERMISSIONS } from '@/permissions'

export function usePermissions() {
    const page = usePage()
    const effectivePermissions: number = (page.props.auth as any)?.user?.effectivePermissions ?? 0

    const can = (bit: number): boolean => (effectivePermissions & bit) !== 0

    return { can, PERMISSIONS }
}
```

- [ ] **Step 7: Create resources/js/Layouts/ConsoleLayout.vue**

```vue
<script setup>
import { Link, router } from '@inertiajs/vue3'
import { usePermissions } from '@/composables/usePermissions'
import { PERMISSIONS } from '@/permissions'

const { can } = usePermissions()

const nav = [
    { label: 'Analytics',   href: '/console/analytics',  bit: PERMISSIONS.SAVINGS_ANALYTICS },
    { label: 'Schedules',   href: '/console/schedules',  bit: PERMISSIONS.SCHEDULES },
    { label: 'Digests',     href: '/console/digests',    bit: PERMISSIONS.DIGESTS },
    { label: 'Summarize',   href: '/console/summarize',  bit: PERMISSIONS.SUMMARIZE },
    { label: 'Compliance',  href: '/console/compliance', bit: PERMISSIONS.COMPLIANCE },
    { label: 'Team',        href: '/console/team',       bit: PERMISSIONS.MULTI_ACCOUNT },
    { label: 'Account',     href: '/console/account',    bit: null },
]

const adminNav = [
    { label: 'Clients',   href: '/console/admin/clients',  bit: PERMISSIONS.ADMIN_USERS },
    { label: 'Licenses',  href: '/console/admin/licenses', bit: PERMISSIONS.ADMIN_LICENSES },
    { label: 'Revenue',   href: '/console/admin/revenue',  bit: PERMISSIONS.ADMIN_REVENUE },
]
</script>

<template>
  <div class="min-h-screen bg-gray-950 flex">

    <!-- Sidebar -->
    <aside class="w-52 shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col py-6 px-4">
      <p class="font-mono text-green-400 font-bold text-sm mb-6 px-2">TicketLens</p>

      <nav class="space-y-0.5 flex-1">
        <template v-for="item in nav" :key="item.href">
          <Link
            v-if="item.bit === null || can(item.bit)"
            :href="item.href"
            class="flex items-center px-2 py-1.5 rounded text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
          >
            {{ item.label }}
          </Link>
          <span
            v-else
            class="flex items-center justify-between px-2 py-1.5 rounded text-sm text-gray-600 cursor-default"
          >
            {{ item.label }}
            <span class="text-[10px] text-gray-700 font-mono">PRO</span>
          </span>
        </template>

        <!-- Admin section -->
        <template v-if="can(PERMISSIONS.ADMIN_USERS)">
          <div class="pt-4 pb-1 px-2">
            <p class="text-[10px] text-gray-600 uppercase tracking-widest font-mono">Admin</p>
          </div>
          <Link
            v-for="item in adminNav"
            :key="item.href"
            :href="item.href"
            class="flex items-center px-2 py-1.5 rounded text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
          >
            {{ item.label }}
          </Link>
        </template>
      </nav>

      <button
        type="button"
        @click="() => router.post('/logout')"
        class="w-full text-left px-2 py-1.5 text-xs text-gray-600 hover:text-gray-400 transition-colors"
      >
        Sign out
      </button>
    </aside>

    <!-- Main -->
    <main class="flex-1 overflow-auto">
      <slot />
    </main>

  </div>
</template>
```

- [ ] **Step 8: Run tests**

```bash
php artisan test tests/Feature/Console/ConsoleLayoutTest.php
```

Expected: PASS

- [ ] **Step 9: Run full test suite to confirm nothing broken**

```bash
php artisan test
```

Expected: All tests pass. Note the count — it should be higher than the previous 44 (backend) + 5 (Phase 3 CLI compliance).

- [ ] **Step 10: Commit**

```bash
git add app/Http/Controllers/Console/ resources/js/composables/ resources/js/Layouts/ resources/js/Pages/Console/ routes/web.php tests/Feature/Console/ConsoleLayoutTest.php
git commit -m "feat: add ConsoleLayout, usePermissions composable, and analytics route"
```

---

## Phase 1 Complete ✓

Clean up test page before Phase 2:

- [ ] **Remove test route and page**

```bash
# Remove from routes/web.php:
# Route::get('/inertia-test', ...)

# Delete:
rm resources/js/Pages/Test.vue

git add routes/web.php resources/js/Pages/Test.vue
git commit -m "chore: remove Inertia bootstrap test page"
```

---

## Next: Phase 2

Phase 2 plan will be written before Phase 2 execution begins.  
Plan location: `docs/superpowers/plans/2026-04-07-console-phase2-client-modules.md`

Covers: Analytics (teaser/full), Schedules, Digests, Summarize, Compliance, Account modules.

Phase 3: Admin modules (Clients, Licenses, Revenue/MRR)  
Phase 4: LemonSqueezy webhook tier upgrade flow
