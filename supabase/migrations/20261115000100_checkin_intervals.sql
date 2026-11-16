-- Prospect check-in intervals: how many months pass before Home's Today card asks for a check-in with a
-- prospect, by how warm they are (Hot, Warm, Cold) and for someone in Not interested. Each person who
-- can use the pipeline sets their own four; a person who hasn't uses the nearest upline's who has (walking
-- up the sponsor line), and nobody up the line means the app's defaults (Hot 3, Warm 6, Cold 12, Not
-- interested 12; src/data/pipeline/checkIns.ts). Same storage and inheritance as the team goals: new
-- nullable columns on pipeline_team_settings (one row per person; read by the sponsor line and whoever can
-- see the person, written only by its own person), resolved up the chain by the client
-- (effectiveSettings, src/data/pipeline/rules.ts). All four are set together or all are null, so one set is
-- always taken from one person. public.my_checkin_months() is the database's copy of that resolution.

alter table public.pipeline_team_settings
  add column checkin_hot_months integer
    constraint pipeline_team_settings_checkin_hot_range check (checkin_hot_months between 1 and 36),
  add column checkin_warm_months integer
    constraint pipeline_team_settings_checkin_warm_range check (checkin_warm_months between 1 and 36),
  add column checkin_cold_months integer
    constraint pipeline_team_settings_checkin_cold_range check (checkin_cold_months between 1 and 36),
  add column checkin_not_interested_months integer
    constraint pipeline_team_settings_checkin_not_interested_range
      check (checkin_not_interested_months between 1 and 36),
  add constraint pipeline_team_settings_checkin_all_or_none check (
    (checkin_hot_months is null) = (checkin_warm_months is null)
    and (checkin_warm_months is null) = (checkin_cold_months is null)
    and (checkin_cold_months is null) = (checkin_not_interested_months is null));

comment on table public.pipeline_team_settings is
  'A person''s first-meeting goal, conversion targets and prospect check-in months (Hot, Warm, Cold, Not interested): each set is null (inherit from the nearest upline) or complete.';
comment on column public.pipeline_team_settings.checkin_hot_months is
  'Months between check-ins with a Hot prospect (1 to 36); the four checkin_* columns are all set or all null.';

-- The check-in months the caller uses: the nearest person in their own sponsor line (themselves first)
-- who set them, all four from that one person. No row: nobody up the line set them (the defaults apply).
-- Reads through the table's row access, so it only ever sees the caller's own line.
create function public.my_checkin_months()
returns table (from_person_id text, hot integer, warm integer, cold integer, not_interested integer)
language sql stable security invoker set search_path = ''
as $$
  select s.person_id, s.checkin_hot_months, s.checkin_warm_months, s.checkin_cold_months,
         s.checkin_not_interested_months
    from public.sponsor_chain(public.current_person_id()) c
    join public.pipeline_team_settings s on s.person_id = c.person_id
   where s.checkin_hot_months is not null
   order by c.depth desc
   limit 1
$$;
revoke execute on function public.my_checkin_months() from public, anon;
grant execute on function public.my_checkin_months() to authenticated;
