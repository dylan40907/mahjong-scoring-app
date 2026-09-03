-- Deleting your own account, from inside the app.
--
-- Google Play requires both an in-app route to delete an account and a public
-- URL that does the same; Apple requires the in-app route. It is a listing
-- blocker rather than a nicety, and it is the kind of thing that is easy to
-- leave until review bounces you.
--
-- Removing a row from `auth.users` needs privileges the client does not have
-- and must not be given, so this is a security-definer function that deletes
-- exactly one user - the caller. Every table referencing `auth.users` cascades,
-- so the profile, sessions, hands, rulesets, friendships, shares and
-- entitlements all go with it.
--
-- Photographs in storage do not cascade and are removed explicitly first.

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

  -- Objects live under `<user id>/…`, so this is the caller's own folder and
  -- nobody else's.
  delete from storage.objects
   where bucket_id = 'hand-photos'
     and (storage.foldername(name))[1] = me::text;

  delete from auth.users where id = me;
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;
