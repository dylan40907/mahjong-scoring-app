-- Two things the security advisor caught, one of which mattered.
--
-- `find_profile` was the original lookup and `view_profile` replaced it. It has
-- no privacy clause - it predates the idea - so it answered for a private
-- profile exactly as it did for a public one, and it was callable without
-- signing in at all. Nothing had referenced it since `view_profile` landed; the
-- only thing keeping it was that dropping it never came up.
drop function if exists public.find_profile(text);

-- The rest is defence in depth. Every one of these reads `auth.uid()`, which is
-- null for `anon`, so an unauthenticated call already returns nothing or fails
-- on a not-null violation - but "safe because the query happens to match no
-- rows" is a weaker guarantee than "not callable", and it is one refactor away
-- from stopping being true.
--
-- `authenticated` deliberately keeps EXECUTE: these are the app's API, and
-- `is_friend` and `is_participant` are called from inside the RLS policies
-- themselves, so revoking those would take every table's read policy with it.
-- The app never calls anything as `anon`; even an anonymous sign-in is the
-- `authenticated` role with `is_anonymous` set.
revoke execute on function public.accept_friend(uuid) from anon;
revoke execute on function public.block_user(uuid) from anon;
revoke execute on function public.claim_handle(text) from anon;
revoke execute on function public.delete_own_account() from anon;
revoke execute on function public.friend_list() from anon;
revoke execute on function public.is_friend(uuid) from anon;
revoke execute on function public.is_participant(text) from anon;
revoke execute on function public.remove_friend(uuid) from anon;
revoke execute on function public.request_friend(text) from anon;
revoke execute on function public.view_profile(text) from anon;
revoke execute on function public.view_profile_by_id(uuid) from anon;

-- A trigger function that was never meant to be an endpoint. It is invoked by
-- the trigger as the definer regardless of who can call it by name.
revoke execute on function public.handle_new_user() from anon, authenticated;
