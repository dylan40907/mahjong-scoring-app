-- Finish what `20260909010000_close_rpc_surface.sql` meant to do.
--
-- That migration revoked EXECUTE from `anon` and reported the surface closed.
-- It was not. A function in Postgres is executable by PUBLIC unless somebody
-- says otherwise, and every role - `anon` included - is a member of PUBLIC, so
-- taking away anon's own grant left it holding the same permission through
-- the group. `has_function_privilege('anon', ...)` answered true for all of
-- them afterwards, and the advisor said so the next time anyone ran it.
--
-- Nothing leaked in between: every one of these reads `auth.uid()`, which is
-- null when signed out, and answers nothing. This is the defence in depth that
-- migration intended, made real - PUBLIC loses EXECUTE, and `authenticated`
-- and `service_role` keep the explicit grants they already hold.
--
-- `is_friend` and `is_participant` are left alone, deliberately. The read
-- policies on sessions, hands and photos call them, and those policies apply
-- to every role. Revoking them from PUBLIC would turn a signed-out read that
-- currently comes back empty into a permission error from inside a policy -
-- and they only ever answer a question about `auth.uid()`, which is nobody.
--
-- `search_profiles` was created with the revoke from PUBLIC in place, and is
-- the reason this was noticed: it was the only function the advisor did not
-- list as callable by `anon`.

revoke execute on function public.accept_friend(uuid) from public;
revoke execute on function public.block_user(uuid) from public;
revoke execute on function public.claim_handle(text) from public;
revoke execute on function public.friend_list() from public;
revoke execute on function public.remove_friend(uuid) from public;
revoke execute on function public.request_friend(text) from public;
revoke execute on function public.view_profile(text) from public;
revoke execute on function public.view_profile_by_id(uuid) from public;

-- A trigger function, never an endpoint. Triggers do not check EXECUTE when
-- they fire, so the signup trigger keeps working with nobody holding it.
revoke execute on function public.handle_new_user() from public;
