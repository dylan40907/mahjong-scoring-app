-- Photographs cannot be deleted from SQL.
--
-- The previous version of this function tried to clear the caller's folder out
-- of `storage.objects` before removing the user. Supabase refuses that:
--
--   42501: Direct deletion from storage tables is not allowed.
--          Use the Storage API instead.
--
-- which the whole function inherits, so deleting an account failed entirely.
-- Storage cleanup belongs to the client, which calls `storage.remove()` before
-- this and can report what it could not clear. Everything else still cascades
-- from `auth.users`.
--
-- Worth noting for anyone extending this: the failure was invisible from the
-- migration alone. It only appeared by calling the function against the real
-- project.

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in';
  end if;

  -- Profile, sessions, hands, rulesets, friendships, shares and entitlements
  -- all reference auth.users on delete cascade, so this is the whole account.
  delete from auth.users where id = me;
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;
