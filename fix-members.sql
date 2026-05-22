-- Разрешаем поиск пользователей по email (для добавления участников)
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;

CREATE POLICY "profiles_select" ON public.profiles
    FOR SELECT USING (
        -- Пользователь видит свой профиль
        auth.uid() = id
        OR
        -- Любой авторизованный может искать по email (для приглашений)
        auth.uid() IS NOT NULL
    );

-- Добавляем колонку members в projects (массив email-ов)
ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS members TEXT[] DEFAULT '{}';

-- Разрешаем участникам видеть проекты где они добавлены
DROP POLICY IF EXISTS "projects_select" ON public.projects;

CREATE POLICY "projects_select" ON public.projects
    FOR SELECT USING (
        auth.uid() = owner_id
        OR
        (SELECT email FROM public.profiles WHERE id = auth.uid()) = ANY(members)
    );
