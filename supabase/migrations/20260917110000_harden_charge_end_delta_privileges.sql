-- bydmate_capture_session_end_delta(uuid) was callable by anon.
--
-- Its own revoke line (originally in 20260717130000, carried forward unchanged by
-- 20260914120000) only did `revoke all ... from public`. Supabase's default privileges
-- grant EXECUTE to anon and authenticated explicitly at function-creation time, and a
-- PUBLIC-only revoke does not remove those explicit per-role grants -- the same gap
-- documented in AGENTS.md and fixed for 19 other functions on 2026-09-11.
--
-- Verified live (2026-09-17): has_function_privilege('anon', ..., 'execute') = true.
-- Practical risk is low -- the function is `security invoker` and every table it reads
-- or writes is RLS-scoped to auth.uid(), which is null for anon, so an anonymous call
-- is expected to be a no-op rather than an information or mutation leak -- but it should
-- still be closed to match the project's own convention.

revoke all on function public.bydmate_capture_session_end_delta(uuid) from public, anon, authenticated;
grant execute on function public.bydmate_capture_session_end_delta(uuid) to authenticated, service_role;
