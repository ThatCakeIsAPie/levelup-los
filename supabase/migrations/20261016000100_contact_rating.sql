-- Hot / Warm / Cold for new contacts (src/data/rating.ts).
--
-- * list_entries.rating gains 'cold' (it was 'warm' or 'hot').
-- * pipeline_cards gets the same rating column. The old `hot` flag stays (the
--   move_pipeline_card() RPC and older clients still send it) and is kept in
--   step by a trigger: a new rating sets hot = (rating = 'hot'); a changed
--   hot flag alone sets the rating to 'hot', or clears a 'hot' rating.
--
-- RLS is unchanged: both are ordinary columns of tables that already have
-- their policies.

alter table public.list_entries drop constraint list_entries_rating_check;
alter table public.list_entries
  add constraint list_entries_rating_check check (rating in ('hot', 'warm', 'cold'));

alter table public.pipeline_cards
  add column rating text check (rating in ('hot', 'warm', 'cold'));

update public.pipeline_cards set rating = 'hot' where hot;

create function public.pipeline_cards_sync_rating() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.rating is not null then
      new.hot := new.rating = 'hot';
    elsif new.hot then
      new.rating := 'hot';
    end if;
  elsif new.rating is distinct from old.rating then
    new.hot := coalesce(new.rating = 'hot', false);
  elsif new.hot is distinct from old.hot then
    new.rating := case
      when new.hot then 'hot'
      when old.rating = 'hot' then null
      else old.rating
    end;
  end if;
  return new;
end $$;

create trigger pipeline_cards_sync_rating
  before insert or update on public.pipeline_cards
  for each row execute function public.pipeline_cards_sync_rating();
