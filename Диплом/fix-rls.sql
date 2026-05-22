-- Удаляем старые политики
DROP POLICY IF EXISTS "projects_select" ON public.projects;
DROP POLICY IF EXISTS "projects_insert" ON public.projects;
DROP POLICY IF EXISTS "projects_update" ON public.projects;
DROP POLICY IF EXISTS "projects_delete" ON public.projects;
DROP POLICY IF EXISTS "members_select" ON public.project_members;
DROP POLICY IF EXISTS "members_insert" ON public.project_members;
DROP POLICY IF EXISTS "members_delete" ON public.project_members;
DROP POLICY IF EXISTS "tasks_select" ON public.tasks;
DROP POLICY IF EXISTS "tasks_insert" ON public.tasks;
DROP POLICY IF EXISTS "tasks_update" ON public.tasks;
DROP POLICY IF EXISTS "tasks_delete" ON public.tasks;

-- PROJECTS
CREATE POLICY "projects_select" ON public.projects FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "projects_insert" ON public.projects FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "projects_update" ON public.projects FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "projects_delete" ON public.projects FOR DELETE USING (auth.uid() = owner_id);

-- PROJECT_MEMBERS
CREATE POLICY "members_select" ON public.project_members FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "members_insert" ON public.project_members FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "members_delete" ON public.project_members FOR DELETE USING (auth.uid() = user_id);

-- TASKS
CREATE POLICY "tasks_select" ON public.tasks FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "tasks_insert" ON public.tasks FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "tasks_update" ON public.tasks FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "tasks_delete" ON public.tasks FOR DELETE USING (auth.uid() = owner_id);
