-- "New contacts" merged into Contact: someone met in the marketplace is a
-- contact made, so the customer board's start band keeps only "Not contacted
-- yet" (client: src/data/customerPipeline/types.ts FIXED_CUSTOMER_COLUMNS).
--
--  * Cards in new_contact move to the Contact milestone column.
--  * Moves into or out of new_contact are rewritten to contact (band
--    "contact"), so those names count as Contact reached from the day they
--    were added. Nothing is deleted: deleting a move would undo it
--    (customer_moves_after_delete). A former "New contacts -> Contact" hop now
--    reads contact -> contact; reaches count once per name, so it adds nothing.
--  * move_customer_card() no longer accepts new_contact. The id and the
--    "New contacts" label stay reserved for steps.

update public.customer_cards set column_id = 'contact' where column_id = 'new_contact';

update public.customer_moves set to_column = 'contact', band = 'contact'
 where to_column = 'new_contact';
update public.customer_moves set from_column = 'contact' where from_column = 'new_contact';

-- Same as in 20261014000500_customer_pipeline.sql, without new_contact.
--
-- Move a list entry's card (or create it) and record the move. `p_to` is a
-- milestone, a fixed column, or a step on the list owner's or the caller's
-- sponsor line. Reaching First sale (or past it) makes the entry a customer
-- of the list's owner (with `p_customer_id` when the app already shows one);
-- reaching On Ditto marks that customer. Returns {"move": ..., "card": ...}.
create or replace function public.move_customer_card(
  p_entry_id text,
  p_to text,
  p_move_id text default null,
  p_customer_id text default null,
  p_next_step text default null,
  p_next_step_date date default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_me text := public.current_person_id();
  v_ws text := public.current_workspace_id();
  v_e public.list_entries;
  v_card public.customer_cards;
  v_had_card boolean;
  v_band text;
  v_customer text;
  v_created text;
  v_ditto boolean := false;
  v_move public.customer_moves;
begin
  if v_me is null or public.is_candidate() then
    raise exception 'Candidates don''t have a customer pipeline yet' using errcode = '42501';
  end if;
  select * into v_e from public.list_entries e where e.id = p_entry_id for update;
  if not found or not public.list_owner_visible(v_e.workspace_id, v_e.owner_id) then
    raise exception 'Name not found' using errcode = 'P0002';
  end if;

  v_band := case
    when p_to in ('contact', 'first_meeting', 'first_sale', 'on_ditto') then p_to
    when p_to = 'not_contacted' then 'start'
    when p_to in ('not_interested', 'do_not_contact') then 'out'
  end;
  if v_band is null then
    select s.band into v_band from public.customer_steps s
     where s.id = p_to and s.workspace_id = v_ws
       and (s.owner_id in (select c.person_id from public.sponsor_chain(v_e.owner_id) c)
            or s.owner_id in (select public.my_chain_ids()));
  end if;
  if v_band is null then
    raise exception 'That column isn''t on this board' using errcode = '22023';
  end if;

  select * into v_card from public.customer_cards c where c.entry_id = p_entry_id for update;
  v_had_card := found;
  if coalesce(v_card.column_id, 'not_contacted') = p_to then
    raise exception 'Already there' using errcode = '22023';
  end if;

  -- First sale: the name becomes a customer of the list's owner.
  v_customer := v_e.customer_id;
  if v_band in ('first_sale', 'on_ditto') and v_customer is null then
    v_created := coalesce(nullif(trim(p_customer_id), ''), gen_random_uuid()::text);
    insert into public.people (id, workspace_id, name, phone, email, biz_class, owner_id,
                               sponsor_id, joined_date, notes)
    values (v_created, v_ws, v_e.name, v_e.phone, v_e.email, 'customer', v_e.owner_id, null,
            public.workspace_today(v_ws),
            case when v_e.how_known is not null then 'From your list: ' || v_e.how_known end);
    update public.list_entries set customer_id = v_created where id = v_e.id;
    insert into public.activity (workspace_id, actor_name, actor_id, entity_type, entity_id,
                                 related_person_id, kind, summary)
    values (v_ws, coalesce((select p.name from public.people p where p.id = v_me), 'Someone'), v_me,
            'person', v_created, v_created, 'created', format('Added %s (Customer)', v_e.name));
    v_customer := v_created;
  end if;

  -- On Ditto: a subscription customer from today.
  if v_band = 'on_ditto' then
    update public.people p set ditto_since = public.workspace_today(v_ws)
     where p.id = v_customer and p.biz_class = 'customer' and p.ditto_since is null;
    v_ditto := found;
  end if;

  insert into public.customer_moves (id, workspace_id, entry_id, owner_id, from_column, to_column,
                                     band, moved_at, moved_by, created_customer_id, set_ditto)
  values (coalesce(nullif(trim(p_move_id), ''), gen_random_uuid()::text), v_ws, p_entry_id,
          v_e.owner_id, case when v_had_card then v_card.column_id end, p_to, v_band, now(), v_me,
          v_created, v_ditto)
  returning * into v_move;

  insert into public.customer_cards (entry_id, workspace_id, column_id, entered_at, next_step,
                                     next_step_date, updated_at)
  values (p_entry_id, v_ws, p_to, v_move.moved_at, nullif(trim(p_next_step), ''), p_next_step_date, now())
  on conflict (entry_id) do update
     set column_id = excluded.column_id,
         entered_at = excluded.entered_at,
         next_step = excluded.next_step,
         next_step_date = excluded.next_step_date,
         updated_at = now()
  returning * into v_card;

  return jsonb_build_object('move', to_jsonb(v_move), 'card', to_jsonb(v_card));
end $$;
