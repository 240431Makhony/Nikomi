-- Добавить колонку avatar_url в таблицу profiles
-- Выполни этот SQL в Supabase Dashboard → SQL Editor

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Поля для workflow проверки задач.
-- Заметка review_note используется, когда владелец проекта возвращает задачу на доработку.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS review_note TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS review_requested_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS review_rejected_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- Обновить constraint статусов: без этого Supabase отвечает 400
-- "violates check constraint tasks_status_check" при отправке на проверку.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
CHECK (status IN ('todo', 'inprogress', 'review', 'done'));

-- Если RLS включен, владельцу проекта нужно видеть и проверять задачи своего проекта,
-- даже когда owner_id задачи принадлежит исполнителю.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'tasks'
          AND policyname = 'Project owners can view project tasks'
    ) THEN
        CREATE POLICY "Project owners can view project tasks"
        ON tasks FOR SELECT
        USING (
            owner_id = auth.uid()
            OR assignee = auth.jwt() ->> 'email'
            OR EXISTS (
                SELECT 1 FROM projects
                WHERE projects.id = tasks.project_id
                AND projects.owner_id = auth.uid()
            )
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'tasks'
          AND policyname = 'Project owners can update project tasks'
    ) THEN
        CREATE POLICY "Project owners can update project tasks"
        ON tasks FOR UPDATE
        USING (
            owner_id = auth.uid()
            OR assignee = auth.jwt() ->> 'email'
            OR EXISTS (
                SELECT 1 FROM projects
                WHERE projects.id = tasks.project_id
                AND projects.owner_id = auth.uid()
            )
        )
        WITH CHECK (
            owner_id = auth.uid()
            OR assignee = auth.jwt() ->> 'email'
            OR EXISTS (
                SELECT 1 FROM projects
                WHERE projects.id = tasks.project_id
                AND projects.owner_id = auth.uid()
            )
        );
    END IF;
END $$;
