---
project_name: 'classlite_new'
user_name: 'Ducdo'
date: '2026-07-14'
sections_completed: ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'code_quality', 'workflow_rules', 'critical_rules']
status: 'complete'
rule_count: 83
optimized_for_llm: true
---

# Project Context for AI Agents

_Critical rules and constraints for implementing ClassLite v2. Every entry exists because an LLM will get it wrong without explicit guidance. If a rule says "never" or "only", treat it as a hard constraint._

---

## Technology Stack & Constraints

### Frontend — Dashboard (classlite-web/)

| Technology | Version | Constraint |
|---|---|---|
| React | 19 | React 19 APIs only. No `forwardRef` (refs are plain props). No `"use client"` directives (this is Vite/SPA, not Next.js). `use()` hook is stable and preferred. No legacy context patterns. |
| Vite | 8 (Rolldown) | Rolldown replaces esbuild/Rollup. No `rollupOptions.output` patterns from Vite <=5. Verify all plugins are Rolldown-compatible before adding. Flag new plugins for human review. |
| TypeScript | Strict mode | `strict: true` in tsconfig — no relaxation. No `any`, no `// @ts-ignore`, no type assertions without justifying comment. `tsc --noEmit` must pass clean. |
| Tailwind CSS | Latest + `@tailwindcss/vite` | All styling via Tailwind utility classes only. No custom CSS files. No `style={{}}` inline props. |
| shadcn/ui | Radix-based | Components are copied into `src/components/ui/` — never imported from an external package. Never hand-edit generated shadcn files. |
| React Router | v7 | Full rewrite from v6. No JSX `<Routes>`/`<Route>` trees. Use v7 file-based conventions with typed routes. Specify framework vs. library mode per architecture doc. |
| TanStack Query | Latest | Owns ALL server state (any data from the API). Never duplicate API data in Zustand. No `useEffect` for data fetching. No raw `fetch` or `axios` bypassing Query. |
| Zustand | Latest | UI-only ephemeral state (modals, sidebars, language). Never store server/API data. One store per concern. |
| React Hook Form | Latest | Standard forms only. Writing editor is EXEMPT — uses document-editing pattern with debounced TanStack Query mutations. |
| Zod | Auto-generated | Single validation library. Generated from OpenAPI via `openapi-zod-client`. No `yup`, no manual validators, no parallel schema systems. RHF uses `zodResolver`. |
| openapi-typescript | Latest | All API request/response types are auto-generated from the OpenAPI spec. Never hand-write TypeScript interfaces for API types. |
| react-i18next | Latest | All user-facing strings through i18n. Translation files: `en.json`, `vi.json`. Keys are dot-separated and feature-scoped. |
| Sentry SDK | Latest | Error tracking + performance. Cross-service correlation via `request_id`. |

### Frontend — Landing Site (classlite-landing/)

| Technology | Version | Constraint |
|---|---|---|
| Astro | Latest stable | Static HTML, zero JS by default. Deployed to Cloudflare Pages. SEO-optimized. |
| Tailwind CSS | Shared config | Same design tokens as dashboard. |

### Backend (classlite-api/)

| Technology | Version | Constraint |
|---|---|---|
| Go | 1.22+ | stdlib `net/http` only — no Gin, Echo, Chi, or Fiber. Go 1.22+ `ServeMux` supports method routing and path params natively. No third-party HTTP router imports. |
| PostgreSQL | Latest | Row-Level Security (RLS) for multi-tenancy. `SET LOCAL app.current_tenant_id` per request. Null-guard prevents data leaks. |
| pgx | v5 | Native pgx v5 pool and scan API only. Never use `database/sql` directly. Never mix pgx v4 and v5 APIs. |
| sqlc | Latest | All database queries: write `.sql` files → `sqlc generate` → use generated Go code. No raw SQL strings in application code. No ORM (no gorm, no ent). Never hand-edit generated files in `store/generated/`. |
| golang-migrate | Latest | SQL migration files: `{YYYYMMDDHHMMSS}_{description}.up.sql` / `.down.sql`. Version-controlled. |
| log/slog | stdlib | Structured JSON logging only. No third-party loggers (no logrus, no zap). |
| Auth | Roll-your-own | bcrypt for passwords + JWT (httpOnly secure cookie on `.classlite.app`) + Google OAuth via `golang.org/x/oauth2`. No third-party auth providers (no Auth0, no Clerk). Access token: 15-min. Refresh token: 7-day (30-day with Remember Me), stored in DB. |
| Resend | Latest | Transactional emails with `classlite.app` sending domain. |
| Google Gemini | Latest | AI features only. Async via PostgreSQL job queue (SELECT...FOR UPDATE SKIP LOCKED). Never synchronous in request handlers. |
| Cloudflare R2 | S3-compatible | File storage via presigned URL direct uploads. No API proxy for file uploads. Key pattern: `{center_id}/{feature}/{uuid}.{ext}`. |
| Sentry SDK | Latest | Cross-service correlation via `request_id` propagated through context. |

### Infrastructure

| Component | Constraint |
|---|---|
| Monorepo | Three independent directories: `classlite-landing/`, `classlite-web/`, `classlite-api/`. No monorepo tooling (no Turborepo, Nx, or Lerna). Each sub-project builds independently. |
| Docker | `docker-compose.yml` at root for local dev (Postgres + pgAdmin). `Dockerfile` in `classlite-api/` for Railway deployment. |
| Deployment | Landing + Dashboard → Cloudflare Pages. API → Railway. Auto-deploy on main push via GitHub Actions. |
| CI/CD | GitHub Actions per service. Migrations → test → lint → build pipeline. |

### Code Generation Pipeline

_These are generated artifacts — never hand-edit them:_

| Tool | Input | Output | Trigger |
|---|---|---|---|
| sqlc | `.sql` query files + `sqlc.yaml` | Type-safe Go structs in `store/generated/` | Schema or query change |
| openapi-typescript | `api.yaml` (OpenAPI spec) | TypeScript API types in `lib/api/` | API spec change |
| openapi-zod-client | `api.yaml` (OpenAPI spec) | Zod validation schemas | API spec change |
| Script | `scripts/codegen.sh` | Runs all generators | Manual or CI |

## Language-Specific Rules

_Named rules with code examples. `// correct` and `// incorrect — never` are hard constraints._

### TypeScript

#### TS-1: Explicit nulls, never undefined for optional API fields
*Why:* `JSON.stringify` drops `undefined` keys. OpenAPI contract requires explicit `null` for absent values. Missing field vs. null field have different semantics.

```ts
// correct
const payload = { middleName: user.middleName ?? null };

// incorrect — never
const payload = { middleName: user.middleName ?? undefined };
```

#### TS-2: Auto-generated types are read-only — never use them as form state
*Why:* Generated API types represent the wire format. Form state needs different shapes (partial, draft, validation). Mixing them creates coupling to the spec in UI components.

```ts
// correct — Zod schema defines form shape, RHF infers type
const studentFormSchema = z.object({ name: z.string().min(1), ... });
type StudentFormValues = z.infer<typeof studentFormSchema>;

// incorrect — never
import { StudentDTO } from '@/lib/api/generated';
type StudentForm = Partial<StudentDTO>; // don't derive form types from generated API types
```

#### TS-3: Query key factories per feature — never flat string arrays
*Why:* Without structured keys, `invalidateQueries` silently fails or over-invalidates. Partial key matching requires hierarchical structure.

```ts
// correct
export const studentKeys = {
  all: ['students'] as const,
  list: (filters: StudentFilters) => [...studentKeys.all, 'list', filters] as const,
  detail: (id: string) => [...studentKeys.all, 'detail', id] as const,
};

// incorrect — never
useQuery({ queryKey: ['students'], ... })
useQuery({ queryKey: ['student', id], ... })
```

#### TS-4: Query functions unwrap the API envelope — components never see it
*Why:* API returns `{ data, meta }`. Without unwrapping, components end up with `.data.data` scattered everywhere.

```ts
// correct — unwrap in the query function
const fetchStudents = async (filters) => {
  const response = await api.get('/students', { params: filters });
  return response.data; // unwrapped — components receive Student[]
};

// incorrect — never
const fetchStudents = async () => {
  return api.get('/students'); // raw envelope leaks into components
};
```

#### TS-5: 401 handling lives in the fetch layer — never in components
*Why:* This stack uses silent token refresh on 401. Per-component redirect logic breaks the refresh contract and causes race conditions.

```ts
// correct — handled in query-client.ts fetch wrapper
// 401 → attempt refresh → retry original request → only redirect on refresh failure

// incorrect — never
if (error.status === 401) router.push('/login'); // not in components, hooks, or query functions
```

#### TS-6: Dates stay as ISO strings until i18n formatter
*Why:* `new Date()` in render paths causes timezone mismatches, hydration bugs, and locale-inconsistent output. The i18n layer handles all formatting.

```ts
// correct
<td>{t('date', { val: enrollment.startDate })}</td>

// incorrect — never
<td>{new Date(enrollment.startDate).toLocaleDateString()}</td>
```

#### TS-7: Feature boundary imports — barrel files only, never reach into another feature
*Why:* ESLint `no-restricted-imports` enforces this in CI. Cross-feature deep imports create hidden coupling that breaks when features refactor internally.

```ts
// correct — from inside features/billing/
import { StudentCard } from '@/features/students';

// incorrect — never
import { StudentCard } from '@/features/students/components/StudentCard';
```

### Go

#### GO-1: TenantContext required on every store method — no exceptions
*Why:* Missing `TenantContext` means `SET LOCAL app.current_tenant_id` never runs. RLS silently passes based on whatever was last set in the connection pool. **This is a data leak across tenants.** Highest-severity trap in the stack.

```go
// correct
func (s *StudentStore) GetByID(ctx context.Context, tc TenantContext, id uuid.UUID) (*Student, error)

// incorrect — never (compiles clean, leaks data)
func (s *StudentStore) GetByID(ctx context.Context, id uuid.UUID) (*Student, error)
```

#### GO-2: Custom error types — never stdlib errors from service/store layers
*Why:* Handler layer does a type switch to produce the `{ error: { code, message, requestId } }` envelope with correct HTTP status. Stdlib errors collapse everything to 500.

```go
// correct
return nil, NotFoundError{Resource: "student", ID: id.String()}   // → 404
return nil, ForbiddenError{Reason: "not a class member"}          // → 403
return nil, ValidationError{Fields: []FieldError{...}}            // → 422

// incorrect — never
return nil, fmt.Errorf("student not found")     // becomes 500
return nil, errors.New("access denied")          // becomes 500
```

#### GO-3: Strict layer dependencies — no skipping layers

```
Request → Handler → Service → Store → DB
              ↑           ↑         ↑
        HTTP only    Business    Data access
        No DB calls  logic only  TenantContext required
                     No HTTP     No business logic
                     awareness
```

Handlers MUST NOT call Store methods directly. Workers import Service directly (peer entry point). HTTP status mapping happens ONLY in handlers — no `http.StatusNotFound` below the handler layer.

#### GO-4: Context propagation — never create new contexts
*Why:* `request_id` is injected into context by middleware. Creating `context.Background()` in store/service methods breaks log correlation, Sentry breadcrumbs, and request tracing.

```go
// correct — propagate incoming context
func (s *GradingService) Grade(ctx context.Context, tc TenantContext, id uuid.UUID) error {
    return s.store.GetSubmission(ctx, tc, id) // same ctx flows through
}

// incorrect — never
func (s *GradingService) Grade(ctx context.Context, tc TenantContext, id uuid.UUID) error {
    return s.store.GetSubmission(context.Background(), tc, id) // breaks correlation
}
```

#### GO-5: No `omitempty` on response struct JSON tags
*Why:* Frontend contract requires explicit `null` for absent values. `omitempty` silently drops null pointer fields, making the response shape unpredictable.

```go
// correct
Email *string `json:"email"`

// incorrect — never
Email *string `json:"email,omitempty"`
```

#### GO-6: pgx v5 idioms — never database/sql patterns
*Why:* pgx v5 has its own pool, error types, and scan API. Mixing with database/sql causes subtle bugs.

```go
// correct
import "github.com/jackc/pgx/v5"
if errors.Is(err, pgx.ErrNoRows) { ... }
pool, _ := pgxpool.New(ctx, connString)

// incorrect — never
import "database/sql"
if errors.Is(err, sql.ErrNoRows) { ... }  // wrong error type
db, _ := sql.Open("postgres", connString)  // wrong driver
```

#### GO-7: JSONB fields — typed structs with schema_version, never map[string]interface{}
*Why:* Untyped maps have no upgrade path. Schema migration happens in the store layer before returning to service — service never sees legacy versions.

```go
// correct
type StudentMetadata struct {
    SchemaVersion int    `json:"schemaVersion"`
    LearningStyle string `json:"learningStyle"`
}

// incorrect — never
Metadata map[string]interface{} `json:"metadata"`
```

### Cross-Language

#### XL-1: Generated code is read-only
*Why:* Files with generation headers (`// Code generated`, auto-generated sqlc output, openapi-typescript output) must never be hand-edited. If the output is wrong, fix the upstream source (`.sql` file, `api.yaml` spec) and regenerate.

#### XL-2: Pagination is page + pageSize, not offset/limit
*Why:* API contract uses `?page=2&pageSize=10`. SQL conversion: `OFFSET (page-1)*pageSize LIMIT pageSize`. Agents trained on offset/limit patterns will skip the conversion.

#### XL-3: File uploads use presigned R2 URLs — never multipart POST to API
*Why:* No file data flows through the Go server. The flow is: `POST /api/uploads/presign` → direct PUT to R2 → `POST /api/uploads/confirm`.

## Framework-Specific Rules

### React Framework Rules

#### FW-1: React Router v7 loaders prefetch into Query cache — never own data
*Why:* Both RR v7 and TanStack Query can fetch data. Without a clear boundary, you get duplicate caching and invalidation logic. TanStack Query owns all server state.

```ts
// correct — loader prefetches into Query cache, component reads from Query
// routes/courses.tsx
export async function loader({ params }: LoaderFunctionArgs) {
  await queryClient.prefetchQuery(coursesQuery(params.centerId))
  return null // loader returns nothing — Query owns the data
}
export default function CoursesRoute() {
  const { data } = useSuspenseQuery(coursesQuery(centerId))
}

// incorrect — never
export async function loader() {
  return fetch('/api/courses').then(r => r.json()) // loader owns data, bypasses Query
}
```

Route loaders are for: redirects, auth checks, prefetching into Query cache. Loaders never return application data.

#### FW-2: TanStack Query — optimistic update triple is mandatory
*Why:* Skipping rollback on optimistic writes leaves stale data in cache on failure. The triple ensures UI consistency.

```ts
// correct — full optimistic triple
useMutation({
  mutationFn: updateCourse,
  onMutate: async (updated) => {
    await queryClient.cancelQueries({ queryKey: courseKeys.detail(updated.id) })
    const previous = queryClient.getQueryData(courseKeys.detail(updated.id))
    queryClient.setQueryData(courseKeys.detail(updated.id), updated)
    return { previous }
  },
  onError: (_err, updated, ctx) => {
    queryClient.setQueryData(courseKeys.detail(updated.id), ctx?.previous)
  },
  onSettled: (_d, _e, updated) => {
    queryClient.invalidateQueries({ queryKey: courseKeys.detail(updated.id) })
  },
})

// incorrect — never skip rollback
useMutation({
  mutationFn: updateCourse,
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['courses'] }) // no rollback
})
```

#### FW-3: Explicit staleTime on every query — default 0 is not acceptable
*Why:* `staleTime: 0` means every component mount triggers a background refetch. In a multi-tenant app, this generates excessive requests. Set a project default in `QueryClient` config; deviations require a comment.

```ts
// correct — project default in query-client.ts
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30 * 1000 } }, // 30s default
})

// correct — override with justification
useQuery({ ...courseQuery, staleTime: 0 }) // real-time: session attendance needs instant updates
```

#### FW-4: useEffect is banned for server-state concerns
*Why:* React 19 + TanStack Query eliminates legitimate `useEffect` data fetching. Mixing them creates race conditions and competes with Query's cache.

```ts
// correct — TanStack Query handles everything
const { data, isLoading } = useQuery(studentKeys.detail(id))

// incorrect — never
useEffect(() => {
  fetch(`/api/students/${id}`).then(r => r.json()).then(setStudent)
}, [id])
```

Permitted `useEffect` uses: DOM imperative operations, third-party library integration, subscription cleanup. Never for fetching, loading state, or mutation triggers.

#### FW-5: Zustand stores are isolated — never import store inside store
*Why:* Cross-store imports create circular dependencies and break React 19 concurrent mode hydration. Compose stores at the component boundary.

```ts
// correct — consume both stores in component
function EditorToolbar() {
  const isFullscreen = useUIStore(s => s.isFullscreen)
  const saveStatus = useEditorStore(s => s.saveStatus)
}

// incorrect — never
// useEditorStore.ts
import { useUIStore } from './useUIStore' // circular risk
```

Additional: Zustand selectors must be stable references or use shallow equality. Inline selectors producing new references every render cause infinite loops with concurrent rendering.

#### FW-6: Never trigger Query invalidation from Zustand store actions
*Why:* Zustand manages UI state. Cache invalidation is the Query client's concern. Mixing them creates hidden coupling that's nearly impossible to debug. Invalidation happens in `useMutation` callbacks or the component layer.

#### FW-7: Component placement — three tiers, never blur them
*Why:* Agents dump domain components into `ui/` or create shadcn-like components alongside primitives.

```
src/components/ui/Button.tsx           ← shadcn primitives only (auto-generated, never hand-edit)
src/components/shared/Layout.tsx       ← app-wide layout (load-bearing, modify with caution)
src/components/domain/BandScoreChart.tsx ← business-aware, reusable across features (no feature imports)
src/features/grading/components/GradingCard.tsx ← feature-local (not reused elsewhere)
```

Never place domain or feature components in `components/ui/`. If a shadcn component needs behavioral extension, wrap it in `domain/` — don't fork `ui/`.

#### FW-8: React 19 form actions vs RHF — clear boundary
*Why:* React 19 ships native form actions. Agents will mix them with RHF on complex forms with multi-field Zod validation.

Rule: All forms with validation use RHF + `zodResolver`. Native React 19 form actions are not used. The **writing editor** is the sole exemption from RHF — it uses document-editing pattern with debounced TanStack Query mutations and a "Saved/Saving..." indicator. Never apply form validation, submit buttons, or blocking modals to the writing editor.

### UX Framework Rules

#### UX-1: Loading / Empty / Error trilogy — implement all three, every screen, no exceptions
*Why:* Inconsistent state handling breaks user trust. A spinner where the spec says skeleton, or a blank container for empty state, makes the app feel unfinished.

- **Loading:** Skeleton components that mirror the shape of loaded content. A list gets list-shaped skeletons, not a centered spinner. A chart gets a skeleton rectangle at chart dimensions.
- **Empty:** Icon/illustration + short headline + one action (if actionable). Role-appropriate tone — student gets encouragement, owner gets onboarding prompt. Never generic "No data found."
- **Error:** Human message, not HTTP codes or stack traces. One retry action. All error strings in i18n — never hardcoded English.

#### UX-2: i18n — Vietnamese is co-primary, not a translation afterthought
*Why:* Vietnamese is the primary language for most end users. A missing `vi.json` key is a broken experience for half the user base.

- Every new string added in both `en.json` AND `vi.json` in the same change
- Dynamic values use i18next interpolation with proper plural handling: `t('sessions.count', { count: n })`
- Never concatenate translated strings with raw values
- Role-specific strings use role-scoped keys: `t('dashboard.owner.welcome')` not `t('dashboard.welcome')` with conditional logic

#### UX-3: Role-based rendering — separate components, not conditional branches
*Why:* One mega-component with three role branches becomes unmaintainable and risks cross-role data leakage.

- Route-level protection in the router (student cannot navigate to `/billing`)
- Role-specific dashboards are separate components: `OwnerDashboard`, `TeacherDashboard`, `StudentDashboard`
- Use `useRole()` hook or `<RoleGate role="owner">` wrapper — never inline `if (user.role === 'owner')` throughout JSX
- Shared UI with role-specific behavior uses the role hook, not prop-drilling

#### UX-4: Mobile variants are intentional designs, not CSS overrides
*Why:* Some screens have fundamentally different component trees on mobile, not just different padding. Agents must check whether the screen has a mobile spec before building.

- Use Tailwind responsive prefixes (`md:`, `lg:`) systematically — no magic pixel values, no inline styles
- Complex screens (e.g., session detail) may render entirely different component trees on mobile

### Go Framework Rules

#### GFW-1: All handlers are methods on typed structs — never free functions
*Why:* The middleware chain passes dependencies through the handler struct. Free functions can't access dependencies without globals or closures, which fractures dependency injection.

```go
// correct
type StudentHandler struct {
    svc *StudentService
}
func (h *StudentHandler) List(w http.ResponseWriter, r *http.Request) { ... }

// incorrect — never
func HandleListStudents(w http.ResponseWriter, r *http.Request) { ... }
```

#### GFW-2: Middleware signature — always http.Handler, never http.HandlerFunc
*Why:* `http.Handler` interface is composable. `http.HandlerFunc` as parameter type breaks the middleware chain.

```go
// correct
func AuthMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ctx := tenant.NewContext(r.Context(), tenantID)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

// incorrect — never
func AuthMiddleware(next http.HandlerFunc) http.HandlerFunc { ... }
```

#### GFW-3: TenantContext extraction — always from context, never from headers
*Why:* Middleware validates and injects tenant identity into context. Reading headers directly in handlers bypasses validation and type safety.

```go
// correct
tc, ok := tenant.FromContext(r.Context())

// incorrect — never
tenantID := r.Header.Get("X-Tenant-ID")
```

#### GFW-4: Context value keys — typed constants in ctxkey package, never string literals
*Why:* String literal context keys collide across packages and are undetectable at compile time.

```go
// correct
ctx.Value(ctxkey.TenantID) // unexported typed constant

// incorrect — never
ctx.Value("tenant_id") // string key, collision risk
```

#### GFW-5: JSON responses always use envelope — never bare encode
*Why:* API contract requires `{ "data": ..., "meta": ... }` for success and `{ "error": { "code", "message", "requestId" } }` for errors.

```go
// correct
type Envelope struct {
    Data any        `json:"data"`
    Meta *MetaBlock `json:"meta,omitempty"`
}
w.Header().Set("Content-Type", "application/json")
json.NewEncoder(w).Encode(Envelope{Data: courses, Meta: meta})

// incorrect — never
json.NewEncoder(w).Encode(courses) // bare array/object, no envelope
```

#### GFW-6: Middleware that reads r.Body must restore it
*Why:* Any middleware inspecting the body (logging, HMAC verification) leaves an empty body for downstream handlers. Silent failure under load.

```go
// correct
body, _ := io.ReadAll(r.Body)
r.Body = io.NopCloser(bytes.NewBuffer(body)) // restore for downstream
next.ServeHTTP(w, r)

// incorrect — never
body, _ := io.ReadAll(r.Body) // body is now empty for all downstream handlers
```

#### GFW-7: Job queue workers import Service directly — peer entry point
*Why:* Workers are a peer entry point to HTTP handlers, not subordinate to them. Workers import services, never handlers. Job state machine: `pending` → `processing` → `complete` | `failed`.

```go
// correct — worker imports service
type AIGradeWorker struct {
    gradingSvc *GradingService
}

// incorrect — never
type AIGradeWorker struct {
    handler *GradingHandler // workers don't go through HTTP layer
}
```

## Testing Rules

### Test Architecture — Mock Boundaries

```
                    FRONTEND                                    BACKEND
┌─────────────────────────────────┐     ┌──────────────────────────────────────┐
│  Component Tests                │     │  Handler Tests (integration)         │
│  ├─ Real QueryClient            │     │  ├─ httptest.NewRecorder             │
│  ├─ Real Zustand stores         │     │  ├─ Real middleware chain            │
│  ├─ MSW mocks HTTP boundary ◄───┤     │  ├─ Real service + store + DB       │
│  └─ Never mock useQuery         │     │  └─ Assert full envelope + status    │
│                                 │     │                                      │
│  The ONE mock seam:             │     │  Service Tests (unit)                │
│  HTTP boundary via MSW          │     │  ├─ Mock store interface ◄── ONE seam│
│                                 │     │  └─ Assert business rules            │
│                                 │     │                                      │
│                                 │     │  Store Tests (integration)           │
│                                 │     │  ├─ Real DB in transaction           │
│                                 │     │  ├─ Never mock pgx/database/sql     │
│                                 │     │  └─ RLS adversarial tests here       │
└─────────────────────────────────┘     └──────────────────────────────────────┘
```

**One mock seam per side.** Frontend: MSW at the HTTP boundary. Backend: store interface in service tests. No other mock layers permitted.

### Frontend Testing Rules

#### TEST-FE-1: Never mock TanStack Query — mock the HTTP boundary with MSW
*Why:* Mocking `useQuery` bypasses cache invalidation, stale-time logic, and loading state transitions — the exact behaviors worth testing.

```ts
// correct — real QueryClient, MSW intercepts HTTP
function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  )
}

test('renders loading → data states', async () => {
  server.use(
    http.get('/api/v1/students', () => HttpResponse.json({ data: mockStudents }))
  )
  renderWithQuery(<StudentList />)
  expect(screen.getByTestId('skeleton')).toBeInTheDocument() // loading
  await screen.findByText('Alice')                            // data
})

// incorrect — never
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn().mockReturnValue({ data: mockStudents, isLoading: false }),
}))
```

One `QueryClient` per test. Always `retry: false` in tests.

#### TEST-FE-2: Three-state coverage mandatory — loading, success, error
*Why:* Agents write happy-path only. Every component that fetches data must have three separate named test cases.

```ts
describe('StudentList', () => {
  test('renders skeleton while loading', () => { ... })
  test('renders student rows on success', async () => { ... })
  test('renders error alert on network failure', async () => {
    server.use(http.get('/api/v1/students', () => HttpResponse.error()))
    renderWithQuery(<StudentList />)
    await screen.findByRole('alert')
  })
})
```

#### TEST-FE-3: Reset Zustand stores between tests — state leaks across tests
*Why:* Zustand stores are module-level singletons. State from test N bleeds into test N+1.

```ts
// correct — every store exports `initialState` AND a `reset()` action.
// beforeEach calls the action, which set()s back to the initial slice.
import { useSessionStore } from '@/stores/sessionStore'

beforeEach(() => {
  useSessionStore.getState().reset()
})
```

Rule: Every Zustand store MUST export `initialState` AND expose a `reset()` action that sets state back to `initialState`. `beforeEach` calls `reset()`.

**Why a `reset()` action and not `setState(initialState, true)`?** Zustand v5 strict-types the replace overload to require the full state shape (including actions). A data-only `initialState` then fails to compile, and casting through with `setState(initialState as never, true)` wipes the actions at runtime — subsequent `getState().someAction()` calls crash with "is not a function." The `reset()` action sidesteps both: it lives on the store (preserving its action surface) and resets the data slice via a partial `set()`.

#### TEST-FE-4: i18n — test key resolution, never hardcode English strings
*Why:* Hardcoded English couples tests to one locale and hides missing translation keys.

```ts
// correct — resolve via i18n, assert key existence
test('submit button renders with correct label', () => {
  renderWithI18n(<EnrollmentForm />)
  const expectedLabel = i18n.t('enrollment.form.submit')
  expect(screen.getByRole('button', { name: expectedLabel })).toBeInTheDocument()
})

test('all enrollment keys exist in both locales', () => {
  const keys = ['enrollment.form.submit', 'enrollment.form.studentId']
  keys.forEach(key => {
    expect(i18n.exists(key)).toBe(true)
  })
})

// incorrect — never
expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument()
```

Every component test should run with real translation files loaded. Assert key existence for both `en` and `vi`.

#### TEST-FE-5: Accessibility — axe-core + role queries, not aria-label grep
*Why:* Adding `aria-label` to make `getByLabelText` pass doesn't verify the element is actually accessible.

```ts
// correct — structural audit + semantic queries
import { axe } from 'vitest-axe'

test('form has no accessibility violations', async () => {
  const { container } = renderWithQuery(<EnrollmentForm />)
  expect(await axe(container)).toHaveNoViolations()
})

test('student ID field reachable by label', () => {
  render(<EnrollmentForm />)
  expect(screen.getByRole('textbox', { name: i18n.t('enrollment.form.studentId') }))
    .toBeInTheDocument()
})
```

#### TEST-FE-6: Role-based rendering — test what's absent, not just present
*Why:* Agents test that owners see admin controls but never test that students can't. Hidden data in the DOM is a security issue.

```ts
describe('DashboardPage', () => {
  test('owner sees billing controls', () => { ... })
  test('student cannot see billing controls in DOM', () => {
    renderAsRole('student', <DashboardPage />)
    expect(screen.queryByTestId('billing-section')).not.toBeInTheDocument()
    // not just visually hidden — absent from DOM entirely
  })
})
```

For every role-gated component, test all three roles. Assert owner-only data is absent from DOM (not just hidden) for unauthorized roles.

### Backend Testing Rules

#### TEST-BE-1: RLS adversarial tests — read AND write isolation, every table
*Why:* Agents test "tenant sees own data" but skip "tenant cannot see/modify other tenant's data." Write isolation is especially tricky — `UPDATE` affecting 0 rows is not an error in PostgreSQL.

```go
// correct — cross-tenant read isolation
func TestRLS_Students_CrossTenantRead(t *testing.T) {
    db := test.SetupDB(t)
    tenantA := fixtures.CreateTenant(t, db, "tenant-a")
    tenantB := fixtures.CreateTenant(t, db, "tenant-b")
    fixtures.CreateStudent(t, db, tenantB.ID, "Bob")

    ctxA := test.TenantContext(t, db, tenantA.ID)
    students, err := queries.ListStudents(ctxA, db)
    require.NoError(t, err)
    assert.Empty(t, students, "RLS VIOLATION: tenantA can read tenantB data")
}

// correct — cross-tenant write isolation
func TestRLS_Students_CrossTenantWrite(t *testing.T) {
    db := test.SetupDB(t)
    tenantA := fixtures.CreateTenant(t, db, "tenant-a")
    tenantB := fixtures.CreateTenant(t, db, "tenant-b")
    studentB := fixtures.CreateStudent(t, db, tenantB.ID, "Bob")

    ctxA := test.TenantContext(t, db, tenantA.ID)
    queries.UpdateStudentName(ctxA, db, sqlc.UpdateStudentNameParams{
        ID: studentB.ID, Name: "Hacked",
    })

    // Re-fetch as tenantB — verify no mutation
    ctxB := test.TenantContext(t, db, tenantB.ID)
    student, _ := queries.GetStudent(ctxB, db, studentB.ID)
    assert.Equal(t, "Bob", student.Name, "RLS VIOLATION: cross-tenant write succeeded")
}
```

Use deterministic test tenant IDs (`00000000-...-000000000001`, `...-000000000002`). Never `DISABLE ROW LEVEL SECURITY` in tests.

#### TEST-BE-2: Store tests use real DB in transactions — never mock pgx
*Why:* Store functions are thin sqlc wrappers. The only meaningful test is whether the SQL works against the actual schema with RLS.

```go
// correct — test.SetupDB is the ONLY way to get DB access in tests
func TestListStudents_Integration(t *testing.T) {
    db := test.SetupDB(t) // transaction-wrapped, auto-rollback via t.Cleanup
    tenant := fixtures.CreateTenant(t, db)
    fixtures.CreateStudents(t, db, tenant.ID, 3)

    ctx := test.TenantContext(t, db, tenant.ID)
    students, err := queries.New(db).ListStudents(ctx)
    require.NoError(t, err)
    assert.Len(t, students, 3)
}

// incorrect — never
mockDB := new(MockQuerier)
mockDB.On("ListStudents", mock.Anything).Return([]db.Student{...}, nil)
```

Never `t.Parallel()` on DB tests sharing a transaction. Direct `testPool` access in test files is prohibited — always go through `test.SetupDB(t)`.

#### TEST-BE-3: Handler tests are integration tests with real middleware
*Why:* Handlers contain almost no logic — HTTP binding and error mapping. Testing with mocked services tells you nothing. Must exercise through real middleware to test auth/tenant extraction.

```go
// correct — real middleware, real service, httptest recorder
func TestListStudentsHandler(t *testing.T) {
    db := test.SetupDB(t)
    tenant := fixtures.CreateTenant(t, db)
    fixtures.CreateStudents(t, db, tenant.ID, 2)

    srv := test.NewTestServer(t, db) // wires real middleware + handlers
    req := test.AuthenticatedRequest(t, "GET", "/api/students", tenant.ID, "teacher")
    rec := httptest.NewRecorder()
    srv.ServeHTTP(rec, req)

    assert.Equal(t, 200, rec.Code)
    // Assert full envelope shape
    var resp map[string]any
    json.NewDecoder(rec.Body).Decode(&resp)
    assert.Contains(t, resp, "data")
    assert.Contains(t, resp, "meta")
}
```

Assert full `{data, meta}` envelope on success paths. Assert full `{error: {code, message, requestId}}` shape on error paths — not just status codes.

#### TEST-BE-4: Service tests mock the store interface — the one backend mock seam
*Why:* Services contain business logic and invariants. This is where you test rules like "a teacher can only see students enrolled in their classes."

```go
// correct — mock store interface, test business rules
func TestGradingService_TeacherCannotGradeOtherClassStudent(t *testing.T) {
    mockStore := new(MockGradingStore)
    mockStore.On("GetSubmission", mock.Anything, mock.Anything, submissionID).
        Return(&store.Submission{ClassID: otherClassID}, nil)

    svc := service.NewGradingService(mockStore)
    err := svc.Grade(ctx, teacherTC, submissionID)

    assert.ErrorAs(t, err, &ForbiddenError{})
}
```

#### TEST-BE-5: Job queue workers — test ProcessTask directly, never enqueue + sleep
*Why:* Enqueue + poll tests the queue infrastructure, not your logic. Worker handlers are plain functions.

```go
// correct — call handler directly, inject mock Gemini client
func TestGradeSubmissionHandler(t *testing.T) {
    db := test.SetupDB(t)
    tenant := fixtures.CreateTenant(t, db)
    submission := fixtures.CreateSubmission(t, db, tenant.ID)

    mockGemini := &MockGeminiClient{}
    mockGemini.On("Grade", mock.Anything, submission.Content).
        Return(&gemini.GradingResult{Grade: "A"}, nil)

    handler := workers.NewGradeSubmissionHandler(db, mockGemini)
    err := handler.ProcessTask(test.TenantContext(t, db, tenant.ID), submission.ID)
    require.NoError(t, err)
}

// incorrect — never
client.Enqueue(task)
time.Sleep(2 * time.Second) // polling anti-pattern
```

### UX Testing Rules

#### TEST-UX-1: i18n test coverage — both locales, both visual and semantic
*Why:* Vietnamese strings are often longer than English. A screen reader speaking English labels to a Vietnamese user is a failure that looks like a pass.

- Run component tests with both `en` and `vi` locales
- Assert `aria-label` attributes are translated (not just visible labels)
- Assert date/time formats render correctly per locale

#### TEST-UX-2: Keyboard navigation tested as flows, not attribute checklists
*Why:* Checking `tabIndex` and `role` attributes is like checking road markings without driving the road.

- Tab order follows visual reading order
- Focus traps in modals, focus returns to trigger on close (agents skip this every time)
- `aria-live` regions announce async content changes (loading complete, error appeared)
- Page titles change on route navigation for screen readers
- Skip-to-content links function on every page

#### TEST-UX-3: Writing editor has its own test suite
*Why:* Testing it like a form input is the wrong frame entirely. It's a document editor with autosave.

- Autosave triggers after debounce interval — assert "Saving..." → "Saved" indicator
- Autosave failure shows non-blocking warning (not a modal, user keeps cursor position)
- Draft recovery on page reload
- Standard keyboard shortcuts (bold, italic, undo, redo) function and are announced to screen readers

#### TEST-UX-4: Mobile variants are structural tests, not just viewport checks
*Why:* Some screens have fundamentally different component trees on mobile, not just different padding.

- Touch targets minimum 44x44px
- Navigation drawer is keyboard accessible
- No viewport zoom on input focus (minimum 16px font on inputs)
- Tables/grids have horizontal scroll or responsive reflow, not invisible overflow

### Test Meta-Rules

- **beforeEach, not beforeAll** for test data. Shared data creates coupling between tests. Transaction rollback makes per-test setup cheap.
- **Never test sqlc-generated code itself.** Test that your queries produce correct results against your schema. sqlc guarantees the code; you guarantee the SQL.
- **E2E tests verify user flows, not business logic.** If a Playwright test checks a calculation or permission rule, the service layer is under-tested.
- **For every positive assertion, write a corresponding negative assertion.** If you assert a button is visible, assert it's visible for the correct role. If you assert content loads, assert it loads with correct i18n for this locale.

## Code Quality & Style Rules

### Behavioral Rules

#### CQ-1: Dead code is rejected — no commented-out code, no if-false blocks
*Why:* Agents leave commented-out code as "backup." It rots immediately, confuses future agents, and signals indecision. Feature flags replace dead branches.

```ts
// incorrect — never
// const oldHandler = () => { ... } // keeping just in case
if (false) { legacyFlow() }

// correct — delete it. Git has history.
```

```go
// incorrect — never
// func oldMigration() { ... }

// correct — remove entirely. Use feature flags for conditional behavior.
```

Unused exports in TS: ESLint `no-unused-vars` set to error, not warn. Go: `deadcode` enabled in `golangci-lint`.

#### CQ-2: Comment policy — document the why, not the what
*Why:* Agents over-comment obvious code and under-comment non-obvious decisions.

- **Go:** Godoc required on all exported identifiers. First line is a complete sentence starting with the identifier name.
- **TypeScript:** JSDoc required on all exported functions and types (param + return).
- **Inline comments:** Only for non-obvious decisions or trade-offs. Never for self-evident code (`// increment counter`).
- **TODOs:** `// TODO(author): GH-{issue}` format only. Orphaned TODOs without issue references are rejected.

#### CQ-3: No magic values — named constants only
*Why:* Agents inline numbers and strings throughout logic, making them invisible to search and impossible to change safely.

```ts
// correct
const MAX_FILE_SIZE_MB = 10
const POLLING_INTERVAL_MS = 30_000
if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) { ... }

// incorrect — never
if (file.size > 10485760) { ... }
```

```go
// correct
const maxPageSize = 100
const defaultPageSize = 20

// incorrect — never
if pageSize > 100 { pageSize = 100 }
```

No boolean traps: use named parameters or options objects, never positional booleans like `showModal(true)`.

#### CQ-4: Abbreviation quality — full words, no cryptic shortcuts
*Why:* Agents trained on terse codebases produce `mgr`, `svc`, `ctrl`, `tmp`, `val`, `res`. These save a few characters and cost clarity.

**Banned abbreviations:** `mgr`, `svc`, `ctrl`, `tmp`, `val`, `res`, `resp`, `req` (in variable names — `r *http.Request` is fine in Go handler signatures)

**Allowed exceptions:** `ctx` (Go context), `err` (Go errors), `i`/`j`/`k` (loop indices only), `id` (identifier), `db` (database), `tx` (transaction)

**File names must reflect their primary export.** No `utils.ts`, `helpers.go`, `misc.ts`, `common.go`. If a file needs a generic name, its contents should be redistributed to specific files.

#### CQ-5: Error message format — consistent across languages
*Why:* Inconsistent error messages make debugging and log correlation harder.

```go
// correct — Go: lowercase, no trailing punctuation, wrap with context
return fmt.Errorf("get student %s: %w", id, err)

// incorrect — never
return fmt.Errorf("Failed to get student: %s", err.Error())
```

HTTP error response bodies always use the standard shape:
```json
{ "error": { "code": "STUDENT_NOT_FOUND", "message": "...", "requestId": "..." } }
```
Error `code` is always `UPPER_SNAKE_CASE`. User-facing error `message` uses i18n keys resolved server-side, never raw English strings.

### Naming Quick Reference

_Mechanical conventions for lookup — not behavioral rules. Tooling (goimports, ESLint, Prettier) enforces formatting; this table resolves ambiguity._

| Artifact | Convention | Example |
|---|---|---|
| **Database** | | |
| Tables | snake_case, plural | `users`, `center_members` |
| Columns | snake_case | `created_at`, `target_band` |
| Foreign keys | `{table_singular}_id` | `user_id`, `class_id` |
| Indexes | `idx_{table}_{columns}` | `idx_users_email` |
| Migrations | `{YYYYMMDDHHMMSS}_{description}` | `20260601120000_add_classes.up.sql` |
| **API** | | |
| Endpoints | plural, kebab-case | `/api/classes`, `/api/ai-credits` |
| JSON fields | camelCase | `centerId`, `targetBand` |
| Query params | snake_case | `?class_id=123&sort_by=created_at` |
| Error codes | UPPER_SNAKE_CASE | `STUDENT_NOT_FOUND` |
| **Go** | | |
| Packages | single lowercase word | `handler`, `service`, `store` |
| Exported types | PascalCase | `ClassService`, `TenantContext` |
| Unexported | camelCase | `validateBandScore` |
| Files | snake_case | `auth_handler.go`, `grading_service.go` |
| **TypeScript / React** | | |
| Component files | PascalCase | `ClassDetail.tsx`, `GradingView.tsx` |
| Hook files | camelCase, `use` prefix | `useClasses.ts`, `useAuth.ts` |
| Utility files | camelCase | `formatBand.ts` |
| Feature directories | kebab-case | `knowledge-hub/`, `ai-grading/` |
| Constants | UPPER_SNAKE_CASE | `MAX_FILE_SIZE`, `POLLING_INTERVAL` |
| Test files | same name + `.test` | `ClassDetail.test.tsx` |
| i18n keys | dot-separated, feature-scoped | `grading.aiSuggestion.accept` |
| **Infrastructure** | | |
| Monorepo directories | kebab-case | `classlite-web/`, `classlite-api/` |
| Environment variables | UPPER_SNAKE_CASE | `DATABASE_URL`, `JWT_SECRET` |
| Docker services | kebab-case | `classlite-api`, `postgres` |

## Development Workflow Rules

### Change Propagation Chain

```
api.yaml (OpenAPI spec — source of truth)
    ↓ scripts/codegen.sh
    ├── classlite-api/store/generated/     → Go server types
    ├── classlite-web/src/generated/       → TypeScript API types
    └── classlite-web/src/lib/api-client/  → Zod validation schemas

*.sql query files (sqlc source of truth)
    ↓ scripts/codegen.sh (sqlc)
    └── classlite-api/store/generated/     → Go DB layer

*.sql migrations (schema source of truth)
    ↓ scripts/migrate.sh
    └── Database state (affects sqlc generation)
```

**Strict ordering:** Migrations before sqlc. `api.yaml` changes before any implementation. Generated code is always a consequence, never a starting point.

### Workflow Rules

#### WF-1: API change sequence — no step skippable, no step reorderable
*Why:* Skipping or reordering produces code that compiles locally against stale types but breaks in CI or production.

```
1. Edit classlite-api/api.yaml              ← source of truth, always first
2. Run scripts/codegen.sh                   ← regenerates ALL derived artifacts
3. Implement backend handler (classlite-api) ← Go types now exist
4. Implement frontend consumer (classlite-web) ← TS types + Zod schemas now exist
```

If `api.yaml` diff is absent but handler or frontend types changed → something is wrong. Trace back to the spec.

#### WF-2: Migration file discipline — never edit existing migrations
*Why:* Migrations are applied sequentially and immutably. Editing an applied migration has no effect. Down migrations must exactly reverse up migrations for rollback safety.

- Every schema change = new migration file pair, never edit existing
- Naming: `{YYYYMMDDHHMMSS}_{descriptive_snake_case}.up.sql` / `.down.sql`
- Check next sequence: `ls classlite-api/migrations/ | tail -5`
- Run via `scripts/migrate.sh` only — never raw `psql` or `golang-migrate` directly
- Seed data lives in `scripts/seed.sh` only — never in migration files
- No speculative migrations — only create when the feature is fully scoped and approved

#### WF-3: codegen.sh — when to run, when not to

**Must run when:**
- `classlite-api/api.yaml` is modified
- Any file in `classlite-api/queries/*.sql` is modified
- `classlite-api/sqlc.yaml` is modified

**Do not run when:** only backend logic, tests, migrations, or frontend component code changes. Unnecessary runs obscure diffs.

**Schema change sequence:** write migration → `scripts/migrate.sh` → update `.sql` queries → `scripts/codegen.sh`. Reversing steps 2 and 3 generates Go code against a schema that doesn't exist yet.

**Final heuristic:** If you touched a `.sql` file or ran `migrate.sh` at any point during a task, `codegen.sh` must be the last script you run before considering implementation complete.

#### WF-4: Cross-service changes must be atomic
*Why:* Auto-deploy on main push means API goes live before frontend if shipped separately. Breaking API change + separate frontend PR = production breakage.

**Breaking changes** (modified response shape, removed field, changed route): single commit/PR touching both services.

```
Atomic commit includes:
  classlite-api/api.yaml           ← spec change
  classlite-api/store/generated/   ← codegen output
  classlite-web/src/generated/     ← codegen output
  classlite-api/internal/handler/  ← backend implementation
  classlite-web/src/features/      ← frontend consumer
```

**Additive-only changes** (new endpoint, new optional field): may ship API-first since existing frontend won't break.

#### WF-5: Deployment order — API-first for breaking changes
*Why:* `classlite-web` consumes `classlite-api`. Breaking API changes must be deployed to Railway before Cloudflare Pages rebuilds.

- Additive changes: order is less critical, but default to API-first
- Never manually trigger deployments in reverse order
- `scripts/seed.sh` is local/staging only — never run against production

#### WF-6: CI pipelines are per-service — broken neighbors are invisible
*Why:* `ci-api.yml`, `ci-web.yml`, `ci-landing.yml` run independently. An `api.yaml` change may pass `ci-api` but break `ci-web`.

Rule: After any change to `api.yaml`, shared types, or generated artifacts, verify all three CI pipelines pass — not just the one you touched.

#### WF-9: External/manual setup tasks — append to docs/manual-setup.md
*Why:* External work (OAuth apps, DNS, DB provisioning, secrets, third-party dashboard config) can't be committed as code, and gets forgotten between the story that introduces it and the deploy that needs it. `docs/manual-setup.md` is the single source of truth — losing an entry means finding out at cutover time.

**Trigger — must update when a change introduces any of:**
- New env var required in a non-dev environment (add to the relevant section's Dev/Staging/Prod grid)
- New third-party service (Google API scope, Resend, R2, Sentry, Polar, etc.)
- New DNS record or subdomain
- New Cloudflare Pages / Railway configuration step
- New secret to generate (`openssl rand`, API keys, HMAC keys)
- New one-time migration/backfill/manual DB op

**How:**
- Add tasks to the matching section, or create a new `## Section` if none fits
- Use `[x]` / `[ ]` / `[-]` (N/A) per environment column
- Cite the originating story in the section header (e.g. `## Google Meet OAuth (Story 2.5c)`)
- Reference env-var names exactly as they appear in `.env.example`

**Do not:**
- Duplicate rows across sections — one canonical row per task
- Add code-level tasks (migrations, feature flags, tests) — those belong in the story, not here
- Retroactively mark prod columns `[x]` before the actual prod cutover

#### WF-7: Service boundary — no cross-service source imports
*Why:* Services are separate deployable units. The contract boundary is the OpenAPI spec and generated clients.

```
FORBIDDEN:
  classlite-web/src/ importing from ../../classlite-api/
  classlite-api/ importing from ../../classlite-web/

CORRECT:
  classlite-web/src/ imports from ./src/generated/ (codegen output only)
```

#### WF-8: Per-story testing workflow — TEA skill chain
*Why:* Tests written after dev "feels done" drift from intent; tests written first tighten the AC and prevent rework. The system-level test design (`_bmad-output/test-artifacts/test-design/`) already decomposed every epic into risk-scored, prioritized scenarios. This rule turns that into a per-story protocol so coverage never trails implementation.

**Authoritative test artifacts (read these first when picking up a story):**
- `_bmad-output/test-artifacts/test-design/test-design-qa.md` — coverage matrix P0–P3, scenarios per epic
- `_bmad-output/test-artifacts/test-design/test-design-architecture.md` — full risk register; check whether the story touches a risk score ≥6
- `_bmad-output/test-artifacts/test-design/classlite_new-handoff.md` — story-level AC patterns per epic

**Per-story protocol:**

```
1. Pre-dev → /bmad-tea AT (ATDD)
   - Generates RED-phase acceptance tests for the story's P0/P1 ACs
   - MANDATORY if the story touches ANY risk score ≥6 from the handoff
   - Skippable for P2/P3 stories at engineer discretion

2. During dev → no TEA invocation
   - Dev implements to turn the red tests green
   - Dev adds unit/service/store/component tests inline (per TEST-FE-*, TEST-BE-* rules above)

3. Post-dev → /bmad-tea TA (Test Automate)
   - Expands P2/P3 scenarios, fixtures, MSW fault injection, role-negative coverage
   - Produces DoD summary

4. Post-dev → /bmad-tea RV (Review Tests)
   - Catches hard waits, hidden assertions, missing cleanup, flake risk
```

**Per-epic protocol (at epic boundary, not per story):**

```
5. /bmad-tea TR (Trace) — AC-to-test traceability + coverage gap report
6. /bmad-tea NR (NFR Audit) — consumes evidence artifacts from stages 1-3
7. /bmad-tea GATE — PASS / CONCERNS / FAIL decision before epic merges to main
```

**Hard rule:** A story whose ACs map to any risk score ≥6 in the handoff MUST have ATDD red tests on the branch before transitioning to `in-progress`. Stories without ATDD on their high-risk ACs fail gate review at the epic boundary.

**Mock seams are NOT overridden by this workflow.** AT, TA, and RV all honor TEST-FE-1 (MSW at HTTP boundary) and TEST-BE-1..5 (store interface as backend seam, real DB in transactions, etc.).

**When the test design becomes stale** (epic scope changes materially, new BLOCKER decisions land, risk profile shifts): re-run `/bmad-tea TD` for that epic before continuing — never patch tests against a stale design.

### Git Conventions

| Convention | Pattern | Example |
|---|---|---|
| Branch naming | `<service>/<type>/<short-desc>` | `api/feat/student-endpoint`, `web/fix/grading-modal` |
| Service prefixes | `api/`, `web/`, `landing/`, `infra/` | Matches monorepo directory names |
| Type prefixes | `feat/`, `fix/`, `refactor/`, `chore/` | Standard categories |
| Commit scope | Prefix with service name when cross-cutting | `api: add student endpoint` |

### Decision Tree — Quick Reference

```
Changing API contract?
  YES → api.yaml first → codegen.sh → backend → frontend (atomic PR)
  NO  ↓

Changing DB schema?
  YES → new migration pair → migrate.sh → update .sql queries → codegen.sh
  NO  ↓

Touching generated file paths?
  YES → STOP. Fix the source (api.yaml or .sql file), then rerun codegen.sh
  NO  ↓

Proceed normally. codegen.sh is NOT needed.
```

## Critical Don't-Miss Rules

### Authentication & Session Security

#### SEC-1: Role authorization is service-layer — RLS does NOT enforce roles
*Why:* RLS enforces tenant isolation (GO-1). But a revoked teacher whose JWT hasn't expired still passes RLS. Role checks must happen in the service layer against the DB, not by trusting JWT claims alone.

```go
// correct — re-validate role from DB for mutating operations
user, err := s.userStore.GetByID(ctx, tc, claims.UserID)
if err != nil || user.Role != domain.RoleTeacher {
    return ForbiddenError{Reason: "insufficient role"}
}

// incorrect — never trust JWT claims alone for authorization
role := claims["role"].(string)
if role != "teacher" { return ErrForbidden } // stale if role changed
```

Read-only operations may use JWT role claims for UI rendering. Mutating operations must re-validate from DB.

#### SEC-2: Refresh token rotation with reuse detection
*Why:* Without rotation, a stolen refresh token gives a 7-day (or 30-day) window. Without reuse detection, token theft is undetectable.

On every `/auth/refresh`:
1. Validate token exists in DB and is not revoked
2. Issue new access + refresh tokens
3. DELETE old refresh token row immediately
4. If old token not found (rowsAffected == 0) → reuse attack detected → revoke ALL tokens for that `user_id`, force re-login

DB schema requires: `token_hash`, `user_id`, `family_id`, `expires_at`, `revoked_at`. Remember Me flag is sealed into the token's DB record at login time — not inferable later.

#### SEC-3: Google OAuth callback must verify tenant binding
*Why:* OAuth callback runs before RLS context is set. A user with a Google account on `tenant-a.classlite.app` must not authenticate at `tenant-b.classlite.app`. This check must be explicit — RLS cannot catch it.

#### SEC-4: httpOnly cookie — all four attributes, no exceptions
*Why:* Missing any attribute weakens the security model. Agents will omit `SameSite` or `Secure` during local development and forget to restore them.

```go
http.SetCookie(w, &http.Cookie{
    Name:     "access_token",
    Value:    signedJWT,
    HttpOnly: true,              // never accessible to JavaScript
    Secure:   true,              // HTTPS only
    SameSite: http.SameSiteStrictMode,
    Domain:   ".classlite.app",  // all subdomains (known risk — operator-controlled only)
    Path:     "/",
    MaxAge:   900,               // 15 min, matches JWT exp
})
```

For state-mutating endpoints (`POST`, `PUT`, `DELETE`, `PATCH`): validate `Origin` header against allowlist. Do not rely on CORS alone.

### CORS Configuration

#### SEC-5: Never wildcard origin with credentials — explicit allowlist only
*Why:* `Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: true` is browser-blocked. Agents trying to "fix" CORS errors will escalate to `*`, breaking auth entirely.

```go
// correct — explicit allowlist, reflect only if matched
allowed := map[string]bool{
    "https://classlite.app":     true,
    "https://app.classlite.app": true,
}
origin := r.Header.Get("Origin")
if allowed[origin] {
    w.Header().Set("Access-Control-Allow-Origin", origin)
    w.Header().Set("Access-Control-Allow-Credentials", "true")
    w.Header().Set("Vary", "Origin") // mandatory — Cloudflare caches wrong origin without it
}
```

CORS preflight must not leak tenant existence — return same headers regardless of whether the subdomain exists.

### Multi-Tenant Security Beyond RLS

#### SEC-6: Job queue workers must re-establish tenant context on dequeue
*Why:* This is the async equivalent of GO-1. Workers cannot inherit context from the enqueuing request. A missing `SET LOCAL` in the worker means RLS is not enforced on async operations — the most likely place for cross-tenant data leaks.

```go
// correct — worker re-establishes tenant context from job payload
func (w *AIGradeWorker) Process(ctx context.Context, job AIJob) error {
    tc := TenantContext{CenterID: job.CenterID, UserID: job.UserID}
    // SET LOCAL app.current_tenant_id before any DB operation
    return w.gradingSvc.Grade(ctx, tc, job.SubmissionID)
}

// incorrect — never assume context carries over from enqueue time
```

#### SEC-7: tenant_id derived from subdomain only — never from request body
*Why:* A `tenant_id` field in the request body is a trust boundary violation. The tenant context is established by middleware from the resolved subdomain, before handler execution.

If a `tenant_id` field exists in a request struct for deserialization, it must be explicitly overwritten by the middleware-derived value — never trusted.

#### SEC-8: R2 presigned URLs — scope, expiry, content-type lock
*Why:* R2 has no RLS. The object key IS the access boundary. An unlocked presigned URL allows MIME-sniff attacks and cross-tenant file access.

- Object key `{center_id}` MUST match authenticated user's `center_id` from JWT — never trust client-supplied path prefix
- Lock `Content-Type` to validated MIME type in presigned request
- Max expiry: 5 minutes (not default 15)
- Validate file extension against allowlist BEFORE generating presigned URL (server-side)
- POST-upload confirm must verify actual stored object's `Content-Type` from R2 metadata

#### SEC-9: Soft deletes + RLS — policies must filter deleted records
*Why:* If RLS policies don't include `AND deleted_at IS NULL`, soft-deleted records from other tenants can surface in queries that lack the soft-delete filter.

RLS policies on tables with soft deletes must include the filter. Alternatively, use a separate archive table.

### Input Validation & Rate Limiting

#### SEC-10: Rate limiting — per-route granularity, not global only
*Why:* Auth endpoints need tighter limits for credential stuffing prevention. AI endpoints need cost-based limits.

```go
// per-route rate limits
"/api/auth/login":           {Requests: 5,   Window: 1 * time.Minute}
"/api/auth/forgot-password": {Requests: 3,   Window: 15 * time.Minute}
"/api/ai/*":                 {Requests: 20,  Window: 1 * time.Minute}  // Gemini cost
"/api/*":                    {Requests: 200, Window: 1 * time.Minute}  // default
```

Rate limit key: `IP + user_id` when authenticated. Pure IP limiting is bypassable behind shared NAT.

#### SEC-11: Email injection — sanitize all header fields for Resend
*Why:* User-supplied display name or subject passed directly to email payload allows CRLF header injection.

- Validate email with `net/mail.ParseAddress`
- Strip `\r\n` from all header fields (To, Subject, From name)
- Cap subject length (200 chars)

### Performance Gotchas

#### PERF-1: SET LOCAL requires an explicit transaction — even for reads
*Why:* `SET LOCAL` scoping only works within a transaction boundary. Outside a transaction, it has no effect or unpredictable scope depending on connection pooling. Every request handler that touches the DB must open a transaction before setting RLS context — even GET handlers.

#### PERF-2: N+1 on dashboard queries — aggregate in SQL, not application code
*Why:* Teacher dashboard fetching class list then looping for student counts = N+1. Authorization for list operations must be expressed in query predicates, not post-fetch loops.

```sql
-- correct — single query with aggregation
SELECT c.*, COUNT(e.student_id) AS student_count
FROM classes c
LEFT JOIN enrollments e ON e.class_id = c.id
WHERE c.teacher_id = $1
GROUP BY c.id

-- incorrect — never loop queries
```

Every dashboard endpoint must be profiled with `EXPLAIN ANALYZE` before merge. Add composite indexes on RLS-filtered query patterns (`center_id + class_id`, `center_id + status + created_at`).

#### PERF-3: Gemini calls never block HTTP handlers
*Why:* Gemini can take 60s+. HTTP handler deadline is 10s max.

```
POST /api/ai/jobs → returns HTTP 202 + { job_id, status: "pending" }
GET  /api/ai/jobs/:id → client polls for result
```

Never `await` Gemini response inside a request handler. Job queue workers handle all AI calls.

#### PERF-4: Locale preference in JWT claims, not per-request DB lookup
*Why:* Vietnamese/English locale preference stored per-user adds a DB hit on every request if loaded live. Embed in JWT claims — trade-off is "takes effect on next login" which is acceptable UX.

### Architectural Edge Cases

#### EDGE-1: Tenant slug uniqueness — DB-level unique index, not just application validation
*Why:* Application-level uniqueness has a race condition under concurrent signups. The `tenants` table must have a unique index on the slug column.

#### EDGE-2: Token invalidation on role change has a 15-minute window
*Why:* If an owner demotes a teacher, existing JWTs still carry the old role for up to 15 minutes (access token TTL). Document this as an accepted product decision, or implement a server-side token revocation list. Agents must not assume JWT expiry handles this.

#### EDGE-3: Wildcard TLS certificate covers one subdomain level only
*Why:* `*.classlite.app` covers `tenant.classlite.app` but not `tenant.app.classlite.app`. Tenant slugs must be single-label (no dots).

#### EDGE-4: Gemini API key — never logged, never in client context
*Why:* Agents will log full job payloads at debug level, leaking prompt content and user PII.

```go
// correct — log metadata only
slog.Debug("ai job enqueued", "job_id", job.ID, "center_id", job.CenterID, "model", job.Model)

// incorrect — never log prompt content, user data, or API keys
slog.Debug("ai job payload", "job", job)
```

`GEMINI_API_KEY` lives in environment only. Must not appear in: config structs serialized to JSON, health-check endpoints, error responses, or database rows.

---

## Usage Guidelines

**For AI Agents:**

- Read this file before implementing any code
- Follow ALL rules exactly as documented — "never" means never
- When in doubt, prefer the more restrictive option
- If a rule conflicts with a user request, flag the conflict before proceeding
- Generated code paths are read-only — fix the source, never the output

**For Humans:**

- Keep this file lean and focused on agent needs
- Update when technology stack or architectural decisions change
- Review quarterly for outdated rules
- Remove rules that become obvious over time or are enforced by tooling

Last Updated: 2026-07-14
