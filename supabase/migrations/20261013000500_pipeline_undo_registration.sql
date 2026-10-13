-- Undoing a registration happens in the database, like the registering.
--
-- move_pipeline_card(..., 'registered') makes the prospect an apprentice
-- (stage, start date, stage history, activity). Until now, undoing it (you
-- delete your own latest move within the hour) only put the card back; the
-- app had to write the person back to prospect itself, in a separate request
-- that could fail or be lost on its own. Now deleting a move into Registered
-- also puts the person back to prospect, in the same statement: the stage,
-- an empty start date, a "prospect" entry in the stage history and a
-- "Pipeline → prospect" activity entry. Only someone who is still an
-- apprentice is changed (if they were promoted or edited meanwhile, they
-- stay as they are). The app shows the same change without writing it.

create or replace function public.pipeline_moves_after_delete() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor text := public.current_person_id();
begin
  if old.from_column is null then
    delete from public.pipeline_cards c
     where c.person_id = old.person_id and c.column_id = old.to_column;
  else
    update public.pipeline_cards c
       set column_id = old.from_column,
           entered_at = coalesce((select max(m.moved_at) from public.pipeline_moves m
                                  where m.person_id = old.person_id), c.entered_at),
           updated_at = now()
     where c.person_id = old.person_id and c.column_id = old.to_column;
  end if;

  if old.to_column = 'registered' then
    update public.people p
       set biz_class = 'prospect',
           pipeline_stage = 'prospect',
           business_start_date = null,
           stage_history = coalesce(p.stage_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
             'stage', 'prospect',
             'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
     where p.id = old.person_id and p.biz_class = 'apprentice';
    if found then
      insert into public.activity (workspace_id, actor_name, actor_id, entity_type, entity_id,
                                   related_person_id, kind, summary, meta)
      values (old.workspace_id,
              coalesce((select p.name from public.people p where p.id = v_actor), 'Someone'), v_actor,
              'person', old.person_id, old.person_id, 'stage_changed', 'Pipeline → prospect',
              jsonb_build_object('from', 'apprentice', 'to', 'prospect'));
    end if;
  end if;
  return old;
end $$;

revoke execute on function public.pipeline_moves_after_delete() from public, anon, authenticated;
