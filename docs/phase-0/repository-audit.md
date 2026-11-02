# Phase 0: Repository & Codebase Audit Report

**Date:** 2026-11-02  
**System Role:** Principal Architect  
**Status:** Complete  

---

## 1. Current Repository State

A full file-tree and Git inspection was conducted on the workspace directory `d:\New folder\Multi-Stall-Food-CourtManagementSystem`.

### 1.1 Git Status & Configuration
- **Repository Initialized:** Yes, Git repository is initialized on branch `main`.
- **Commit History:** Zero commits (`No commits yet`).
- **Remote Origin:** `https://github.com/shubhamzombade72/Multi-Stall-Food-CourtManagementSystem.git`
- **Tracked Files:** None.
- **Untracked / Legacy Files:** None. The repository is completely clean and ready for structured engineering foundations.
- **Merge Conflicts / Dirty State:** None.

---

## 2. Monorepo vs. Multi-Repo Architecture Evaluation

### 2.1 The Problem
A complete food court platform consists of four distinct software clients and services:
1. Central Backend API & Business Engine.
2. Desktop Application (Cashier POS, Stall Management, Owner Operations).
3. Customer QR Web Application (Browser-based, zero install).
4. Unified Android Application (Waiter, Kitchen Display, Store, Management).
5. Comprehensive Engineering Documentation & API Specifications.

### 2.2 Evaluation of Approaches

| Criteria | Polyrepo (Separate Repositories) | Monorepo (Single Unified Repository) |
|---|---|---|
| **Contract Synchronization** | API drift occurs frequently between backend and mobile/desktop teams. | Backend API DTOs, TypeScript interfaces, and OpenAPI specs update synchronously. |
| **Commit Traceability** | Features touching backend, frontend, and mobile require 3–4 disconnected PRs. | Full end-to-end features can be traced and reviewed in atomic commits. |
| **Operational Overhead** | Managing 4 CI/CD pipelines, 4 issue trackers, and separate version tags. | Single source of truth, unified task boards, unified documentation tree. |
| **Offline Synchronization** | Hard to maintain schema version alignment between local client and server. | Client local SQLite schemas and backend Postgres schemas are co-versioned. |

### 2.3 Architectural Recommendation
**Recommendation: Unified Monorepo with Domain-Specific Workspaces.**  
This approach guarantees that API contracts, documentation, and client applications evolve together without version mismatch.

---

## 3. Recommended Directory Structure

```plaintext
Multi-Stall-Food-CourtManagementSystem/
├── .github/                      # CI/CD Workflows, issue templates, PR checks
├── backend/                      # Laravel 11/12 Core Business Backend (Modular Monolith)
│   ├── app/
│   │   ├── Domain/               # Domain-driven modules (Orders, Kitchen, Billing, Inventory, Settlements)
│   │   ├── Http/
│   │   │   ├── Controllers/Api/  # Versioned REST APIs (v1)
│   │   │   ├── Middleware/       # Role, permission, and stall-isolation checks
│   │   │   └── Requests/         # Form validation requests
│   │   ├── Models/               # Eloquent Models with explicit constraints
│   │   ├── Services/             # Business action classes (no logic in controllers)
│   │   └── Events/               # Realtime events (OrderCreated, TicketStatusChanged)
│   ├── config/                   # Application configurations
│   ├── database/
│   │   ├── migrations/           # Normalized PostgreSQL migrations
│   │   └── seeders/              # Deterministic test seeders (stalls, menus, tables)
│   ├── routes/
│   │   ├── api.php               # RESTful API routes
│   │   └── channels.php          # Realtime broadcasting authorization
│   ├── tests/                    # Pest / PHPUnit Unit and Feature tests
│   └── composer.json
│
├── frontend-desktop/             # React 18/19 + Vite + TypeScript + Tailwind CSS
│   ├── src/
│   │   ├── components/           # Reusable UI design system (buttons, tables, dialogs)
│   │   ├── features/             # Cashier POS, Owner Analytics, Stall Settings
│   │   ├── services/             # TanStack Query hooks & Axios client
│   │   ├── store/                # Redux Toolkit state slices
│   │   └── types/                # Strict TypeScript domain interfaces
│   ├── package.json
│   └── vite.config.ts
│
├── frontend-customer/            # Mobile-first QR Ordering Web App (React + Vite + TS)
│   ├── src/
│   │   ├── components/           # Lightweight, touch-optimized food court menu components
│   │   ├── features/             # Table session, Multi-stall cart, Order tracking
│   │   └── services/             # Lightweight API client
│   ├── package.json
│   └── vite.config.ts
│
├── mobile-app/                   # React Native + Expo (Unified Android App)
│   ├── src/
│   │   ├── screens/              # Role-based screens (Waiter, Kitchen KDS, Store, Manager)
│   │   ├── navigation/           # Dynamic RBAC navigation trees
│   │   ├── offline/              # SQLite / MMKV local persistence & sync engine
│   │   ├── services/             # Local LAN and Cloud sync clients
│   │   └── store/                # Redux Toolkit state
│   ├── app.json                  # Expo configuration
│   └── package.json
│
├── docs/                         # Formal Engineering Documentation
│   ├── phase-0/                  # Discovery, Environment & Risk Audits
│   ├── prd/                      # Product Requirements Document
│   ├── architecture/             # Architecture Specifications & ADRs
│   ├── database/                 # ERDs, Data Dictionaries, Migration Strategies
│   ├── api/                      # OpenAPI 3.1 Specs & Endpoint Docs
│   ├── security/                 # Threat Model & Permission Matrices
│   ├── testing/                  # QA Plans, Test Matrices, E2E Scenarios
│   └── deployment/               # Setup Guides, Backup & Disaster Recovery
│
├── .editorconfig                 # Standard cross-IDE editor formatting rules
├── .gitignore                    # Comprehensive ignore rules (PHP, Node, Expo, IDE)
└── README.md                     # Root project documentation and onboarding guide
```

---

## 4. Git Hygiene & Branching Strategy

To maintain strict engineering rigor, the following standards will be enforced:
1. **Branching Strategy:**
   - `main`: Production-ready, fully tested code only.
   - `develop`: Staging integration branch.
   - `feature/<module-name>`: Scoped task branches.
2. **Conventional Commits:**
   - Format: `type(scope): concise description`
   - Allowed types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`.
3. **Protection Rules:**
   - Direct pushes to `main` prohibited once CI/CD is active.
   - All PRs require automated test verification.

