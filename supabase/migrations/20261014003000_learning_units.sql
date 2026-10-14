-- Choose how reading and podcasts are measured (client: src/stores/crmStore.ts
-- Learning.unit, LearningGoal.readingUnit / podcastUnit).
--
--  * learning.unit: reading ('pages' kind) in minutes, pages or chapters;
--    podcasts in minutes or episodes; null for workshops and conferences.
--    Existing rows (and library completions, which leave it out) stay null,
--    which reads as pages for reading and episodes for podcasts.
--  * learning_goals.reading_unit / podcast_unit: what the `pages` and
--    `podcasts` targets count. Null = pages / episodes, as before.

alter table public.learning
  add column unit text,
  add constraint learning_unit_fits_kind check (
    unit is null
    or (kind = 'pages' and unit in ('minutes', 'pages', 'chapters'))
    or (kind = 'podcast' and unit in ('minutes', 'episodes'))
  );

alter table public.learning_goals
  add column reading_unit text check (reading_unit in ('minutes', 'pages', 'chapters')),
  add column podcast_unit text check (podcast_unit in ('minutes', 'episodes'));
