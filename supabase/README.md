# VAZORA — Supabase (Phase 2A)

Dedicated Supabase project for VAZORA. Do not reuse any existing/healthcare project.

## 1. Create the project (dashboard)

1. Supabase dashboard → **New project** → name it `vazora`.
2. Keep the auto-generated `anon` and `service_role` keys; never commit them.
3. Authentication → Providers → enable **Email** (password). Email confirmation may be left on.

## 2. Apply migrations

```bash
# install CLI if needed: brew install supabase/tap/supabase
supabase link --project-ref <PROJECT_REF>
supabase db push
```

or paste `supabase/migrations/0001_phase2a_foundation.sql` into the SQL editor.

`supabase db push` creates the private `contract-documents` storage bucket via
the `storage.buckets` insert and all RLS/storage policies.

## 3. Required environment variables

See `.env.example`. Summary:

| Variable | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server | public anon key (RLS enforced) |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | admin tooling (e.g. reading demo leads) |
| `VAZORA_DATA_PROVIDER` | server | `mock` (default) or `supabase` |

Without them the app fails gracefully with a configuration message — it never
silently falls back to mock data in production.

## 4. Storage path convention

`contract-documents` bucket object names:

```
{organization_id}/{contract_id}/{document_id}_{file_name}
```

RLS storage policies check membership on the first path segment, so guessing a
path of another organization yields nothing.

## 5. Tenant isolation test

`supabase/tests/rls-isolation.sql` builds User A/Alpha and User B/Beta and
asserts cross-tenant denial (read/update/storage/demo-lead) plus public
`demo_requests` insert. Run it in the SQL editor on a dev project; everything
is wrapped in a transaction and rolled back.

## 6. Service-role usage

The service role bypasses RLS by design. Use it **only** in trusted server
code (e.g. an internal lead-inspection route protected by a separate admin
check) and never expose it to the browser.

## 8. Phase 2B — AI extraction configuration (no keys committed)

The extraction pipeline is provider-independent. Configure ONLY via env:

| Variable | Purpose | Example |
| --- | --- | --- |
| `VAZORA_EXTRACTION_PROVIDER` | adapter id | `openai-compat` |
| `VAZORA_AI_BASE_URL` | OpenAI-compatible endpoint (optional) | `https://api.openai.com/v1` |
| `VAZORA_AI_API_KEY` | server-only API key | (your key, never in chat/repo) |
| `VAZORA_EXTRACTION_MODEL` | model id | `gpt-4o-mini` |

Adapters currently shipped: `openai-compat` (works with any OpenAI-compatible API — OpenAI, Azure OpenAI, xAI, Moonshot/Kimi). Additional dedicated adapters (Anthropic, Gemini, etc.) can implement `ContractExtractionProvider` and register with `registerExtractionProvider("<id>", factory)`.

### Evaluation harness

```bash
# Fixture mode (default): `test-fixture + VAZORA_TEST_FIXTURE=1` —
# deterministic against ground truth. Output labeled TEST FIXTURE.
node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/evaluate-extraction.ts

# Live evaluation — real provider, real latency, real usage and cost metadata.
# Output labeled LIVE MODEL. No fallback to fixture.
VAZORA_EVAL_LIVE=1 \
VAZORA_EXTRACTION_PROVIDER=openai-compat \
VAZORA_EXTRACTION_MODEL=gpt-4o-mini \
VAZORA_AI_API_KEY=sk-... \
node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/evaluate-extraction.ts
```

Repeat for stability tests: `VAZORA_EVAL_REPEATS=3`.

### App runtime

The Analyze Contract button in the live workspace uses the same config. Without it,
the user sees "AI extraction is not configured" — never fake results.

`supabase/drafts/phase1-full-schema-draft.sql` contains the Phase 2B+ schema
(clauses, obligations, evidence, risks, claims, agent events, embeddings). It
is kept out of `migrations/` intentionally so `supabase db push` does not apply
it before its phase.
