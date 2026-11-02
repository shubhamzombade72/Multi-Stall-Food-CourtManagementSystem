# Phase 0: Dependency Audit & Rationalization Report

**Date:** 2026-11-02  
**System Role:** Senior Software Architect  
**Status:** Complete  

---

## 1. Dependency Strategy & Philosophy

To build a reliable commercial product, every dependency introduced into the codebase must be justified against:
- **Security footprint:** Does it introduce supply-chain vulnerabilities?
- **Operational complexity:** Does it introduce another runtime service to monitor and maintain?
- **Maintenance cost:** Is it actively maintained with strong backward compatibility?
- **Performance:** Does it add bloat to client bundles or CPU/memory latency?

Dependencies are classified into:
1. **Required:** Essential for functional and non-functional requirements.
2. **Optional:** Adds convenience but can be deferred or swapped.
3. **Development Only:** Used exclusively in build, test, and linting stages.
4. **Production Only:** Infrastructure tools for production deployment.
5. **Unnecessary / Rejected:** Tools that introduce architectural flaws or unnecessary complexity.

---

## 2. Backend Stack (Laravel Modular Monolith)

### 2.1 Required Dependencies
| Package | Version | Classification | Architectural Justification |
|---|---|---|---|
| `laravel/framework` | `^11.0` or `^12.0` | Required | Core application framework providing MVC, ORM, queues, events, validation, and scheduling. |
| `laravel/sanctum` | `^4.0` | Required | Lightweight, robust API token authentication for SPA desktop, mobile Android, and customer QR sessions. |
| `laravel/reverb` | `^1.0` | Required | First-party, blazing-fast WebSocket server built directly into Laravel. Eliminates external Node.js socket servers. |
| `doctrine/dbal` | `^3.8` | Development / Required | Required for inspecting database schema and advanced migration modifications. |
| `spatie/laravel-permission` | `^6.0` | Required | Battle-tested Role-Based Access Control (RBAC) supporting multi-stall permission scopes. |
| `simplesoftwareio/simple-qrcode` | `^4.2` | Required | Dynamic, cryptographically signed SVG/PNG QR code generator for food court tables. |

### 2.2 Development & Quality Assurance Dependencies
| Package | Version | Classification | Architectural Justification |
|---|---|---|---|
| `pestphp/pest` | `^2.0` or `^3.0` | Development Only | Expressive, elegant PHP testing framework built on PHPUnit for unit, feature, and architecture tests. |
| `pestphp/pest-plugin-laravel`| `^2.0` or `^3.0` | Development Only | Native Laravel test bindings for Pest. |
| `laravel/pint` | `^1.14` | Development Only | Opinionated PHP code style fixer for strict team code hygiene. |
| `nunomaduro/larastan` | `^2.9` | Development Only | Static analysis tool (PHPStan wrapper) to catch type errors and potential runtime bugs before execution. |

### 2.3 Unnecessary / Rejected Backend Dependencies
| Package | Classification | Justification for Rejection |
|---|---|---|
| `express.js` / Node Backend | **REJECTED** | Dual-backend anti-pattern. Introducing an Express service alongside Laravel splits business logic, duplicates database connections, creates fragmented authentication, and increases production operational failure points. |
| `laravel/passport` | **REJECTED** | Heavyweight OAuth2 server (requires RSA keys, token client management). Unnecessary overhead when Sanctum provides stateful cookie auth for SPAs and secure bearer tokens for mobile. |
| `livewire` / `inertia` | **REJECTED** | Desktop and mobile require decoupled, high-performance REST APIs with independent offline client caching (TanStack Query + local SQLite). Monolithic server-driven HTML would break offline-first capabilities. |

---

## 3. Frontend Stack - Desktop POS & Central Administration

### 3.1 Required Dependencies
| Package | Version | Classification | Architectural Justification |
|---|---|---|---|
| `react` & `react-dom` | `^18.3` or `^19.0` | Required | Core UI rendering library. |
| `typescript` | `^5.5` | Required | Enforces strict compile-time type safety across API contracts and UI states. |
| `vite` | `^5.4` or `^6.0` | Required | High-speed frontend build tool and dev server. |
| `react-router-dom` | `^6.26` | Required | Client-side routing for Cashier POS, Kitchen, and Owner portals. |
| `@reduxjs/toolkit` | `^2.2` | Required | Predictable state container for complex multi-stall cart sessions, split billing, and cashier drawer states. |
| `@tanstack/react-query` | `^5.50` | Required | Asynchronous server-state management, automated background refetching, and query caching. |
| `tailwindcss` | `^3.4` or `^4.0` | Required | Utility-first CSS framework for fast, consistent, and lightweight UI styling. |
| `lucide-react` | `^0.400` | Required | Lightweight, uniform SVG icon set for touch screens and dashboards. |
| `laravel-echo` & `pusher-js` | Latest | Required | Client library for connecting to Laravel Reverb WebSocket channels for live order updates. |
| `react-hook-form` & `zod` | Latest | Required | High-performance, schema-driven form validation with zero re-render overhead. |
| `date-fns` | `^3.6` | Required | Modern, lightweight, tree-shakable date manipulation for reporting. |

### 3.2 Unnecessary / Rejected Desktop Dependencies
| Package | Classification | Justification for Rejection |
|---|---|---|
| `moment.js` | **REJECTED** | Deprecated, non-tree-shakable legacy library that adds unnecessary bundle bloat. |
| `antd` / `material-ui` | **REJECTED** | Heavy runtime CSS-in-JS overhead, rigid design constraints, and slow rendering on lower-power POS terminals. Custom Tailwind primitives are faster and cleaner. |

---

## 4. Customer QR Mobile Web Application

### 4.1 Required Dependencies
| Package | Version | Classification | Architectural Justification |
|---|---|---|---|
| `react` & `react-dom` | `^18.3` or `^19.0` | Required | Standardized with the desktop stack for component reusability. |
| `typescript` | `^5.5` | Required | Type safety. |
| `vite` | `^5.4` or `^6.0` | Required | Ultra-small bundle footprint for instant 3G/4G/Wi-Fi mobile browser loading. |
| `tailwindcss` | `^3.4` | Required | Zero runtime styling overhead on mobile browsers. |
| `zustand` or Redux Toolkit | Latest | Required | Lightweight local cart and table-session management. |
| `lucide-react` | Latest | Required | Minimalist UI iconography. |

### 4.2 Engineering Constraint for QR Web App
The customer QR web application must load in **under 1.5 seconds on 4G mobile networks**. No unnecessary analytics libraries, heavy font packages, or redundant dependencies will be bundled.

---

## 5. Android Application (React Native / Expo)

### 5.1 Required Dependencies
| Package | Version | Classification | Architectural Justification |
|---|---|---|---|
| `expo` | `^51.0` or `^52.0` | Required | Unified React Native development runtime with battle-tested native modules. |
| `react-native` | Matching Expo | Required | Cross-platform mobile runtime. |
| `@react-navigation/native` | `^6.0` | Required | Flexible, role-based navigation router. |
| `@tanstack/react-query` | `^5.50` | Required | Server-state caching and synchronization. |
| `@reduxjs/toolkit` | `^2.2` | Required | Local offline transaction queue and app state. |
| `expo-sqlite` or `react-native-mmkv` | Latest | Required | **CRITICAL for Offline-First:** High-speed encrypted local persistence for local transactions, menu cache, and pending sync batches. |
| `expo-camera` / `expo-barcode-scanner` | Latest | Required | Waiter / Staff QR scanning for table assignment and order verification. |
| `expo-notifications` | Latest | Required | Real-time push notifications for KDS order alerts and ready-for-pickup notifications. |

---

## 6. The Express.js vs. Laravel Reverb Architectural Verdict

The original prompt requested an evaluation of whether an Express.js / Node.js service is required.

### 6.1 Evaluation Comparison

| Architectural Dimension | Laravel 11/12 + Laravel Reverb (Recommended) | Separate Node.js / Express.js Service |
|---|---|---|
| **Architectural Model** | Unified Modular Monolith. Single backend source of truth. | Distributed Dual-Backend. Two distinct runtimes to maintain. |
| **Authentication & Authorization** | Reuses existing Laravel Sanctum sessions, Eloquent models, and Gate/Policy permissions natively. | Must either duplicate JWT validation logic or make synchronous HTTP calls back to Laravel on every socket connection. |
| **Event Pipeline** | Native `broadcast(new OrderCreated($order))` directly triggers WebSocket push over Unix socket / Redis. | Laravel must publish to Redis -> Node.js worker listens -> Node.js validates -> Node.js emits to sockets. |
| **Database Transactions** | Sockets emit exactly inside or after DB transaction commits (`afterCommit`). | Risk of Node emitting events before Laravel finishes committing complex multi-stall records. |
| **Operational Maintenance** | One codebase, one deployment script, zero node process management on the backend server. | Two runtime stacks (PHP-FPM + Node.js), two monitoring daemons, two logging channels, increased attack surface. |

### 6.2 Conclusion & Recommendation
**Express.js is officially REJECTED.**  
Laravel Reverb completely satisfies all real-time requirements (instant KDS updates, cashier updates, waiter notifications, table call alerts) with lower latency, zero architectural divergence, and unified authorization.

