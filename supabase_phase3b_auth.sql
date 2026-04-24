begin;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

alter default privileges in schema public
grant select, insert, update, delete on tables to authenticated;

alter default privileges in schema public
grant usage, select on sequences to authenticated;

grant execute on function public.is_store_member(uuid) to authenticated;
grant execute on function public.has_store_role(uuid, public.store_user_role[]) to authenticated;
grant execute on function public.shares_store_with_user(uuid) to authenticated;

create or replace function public.handle_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name text;
  v_display_name text;
begin
  v_full_name := coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name');
  v_display_name := coalesce(new.raw_user_meta_data ->> 'display_name', v_full_name, split_part(coalesce(new.email, ''), '@', 1));

  insert into public.profiles (
    id,
    email,
    full_name,
    display_name,
    active
  ) values (
    new.id,
    new.email,
    nullif(v_full_name, ''),
    nullif(v_display_name, ''),
    true
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    display_name = coalesce(excluded.display_name, public.profiles.display_name),
    active = true,
    updated_at = timezone('utc', now());

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_auth_user_created();

insert into public.profiles (
  id,
  email,
  full_name,
  display_name,
  active
)
select
  u.id,
  u.email,
  nullif(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'), ''),
  nullif(coalesce(u.raw_user_meta_data ->> 'display_name', u.raw_user_meta_data ->> 'full_name', split_part(coalesce(u.email, ''), '@', 1)), ''),
  true
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

commit;
