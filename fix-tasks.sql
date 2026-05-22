-- Добавляем нужные колонки в tasks
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS assignee TEXT;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Обновляем RLS для tasks — участники проекта тоже видят задачи
DROP POLICY IF EXISTS "tasks_select" ON public.tasks;
CREATE POLICY "tasks_select" ON public.tasks
    FOR SELECT USING (
        auth.uid() = owner_id
        OR
        assignee = (SELECT email FROM public.profiles WHERE id = auth.uid())
        OR
        project_id IN (
            SELECT id FROM public.projects
            WHERE (SELECT email FROM public.profiles WHERE id = auth.uid()) = ANY(members)
        )
    );

-- Участники могут обновлять задачи в своих проектах
DROP POLICY IF EXISTS "tasks_update" ON public.tasks;
CREATE POLICY "tasks_update" ON public.tasks
    FOR UPDATE USING (
        auth.uid() = owner_id
        OR
        assignee = (SELECT email FROM public.profiles WHERE id = auth.uid())
        OR
        project_id IN (
            SELECT id FROM public.projects
            WHERE (SELECT email FROM public.profiles WHERE id = auth.uid()) = ANY(members)
        )
    );
