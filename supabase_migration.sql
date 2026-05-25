-- ============================================
-- NIKOMI — SQL fixes (выполни всё целиком)
-- Supabase Dashboard → SQL Editor → Run
-- ============================================

-- 1. Синхронизировать пользователей из auth в profiles (добавит тех кого нет)
INSERT INTO public.profiles (id, name, email, role, created_at)
SELECT 
    au.id,
    COALESCE(au.raw_user_meta_data->>'name', split_part(au.email, '@', 1)),
    au.email,
    'member',
    au.created_at
FROM auth.users au
WHERE NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = au.id
);

-- 2. Триггер — автосоздание профиля при регистрации
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, role, created_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    'member',
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = COALESCE(EXCLUDED.name, profiles.name);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. avatar_url в profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- 4. RLS profiles — любой авторизованный может читать профили (нужно для поиска по email и показа имён)
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
FOR SELECT USING (auth.role() = 'authenticated');

-- 5. RLS profiles — обновлять только свой профиль
DROP POLICY IF EXISTS profiles_update ON public.profiles;
CREATE POLICY profiles_update ON public.profiles
FOR UPDATE USING (auth.uid() = id);

-- 6. RLS profiles — вставка только своего профиля
DROP POLICY IF EXISTS profiles_insert ON public.profiles;
CREATE POLICY profiles_insert ON public.profiles
FOR INSERT WITH CHECK (auth.uid() = id);

-- 7. RLS tasks UPDATE — владелец задачи ИЛИ исполнитель ИЛИ владелец проекта
DROP POLICY IF EXISTS tasks_update ON public.tasks;
CREATE POLICY tasks_update ON public.tasks
FOR UPDATE USING (
    auth.uid() = owner_id
    OR assignee = (SELECT email FROM public.profiles WHERE id = auth.uid())
    OR project_id IN (
        SELECT id FROM public.projects WHERE owner_id = auth.uid()
    )
);

-- 8. RLS tasks SELECT — видят задачи: владелец, исполнитель, участник проекта, владелец проекта
DROP POLICY IF EXISTS tasks_select ON public.tasks;
CREATE POLICY tasks_select ON public.tasks
FOR SELECT USING (
    auth.uid() = owner_id
    OR assignee = (SELECT email FROM public.profiles WHERE id = auth.uid())
    OR project_id IN (
        SELECT id FROM public.projects
        WHERE owner_id = auth.uid()
           OR members @> ARRAY[(SELECT email FROM public.profiles WHERE id = auth.uid())]::text[]
    )
);

-- 9. RLS tasks INSERT — только авторизованный
DROP POLICY IF EXISTS tasks_insert ON public.tasks;
CREATE POLICY tasks_insert ON public.tasks
FOR INSERT WITH CHECK (auth.uid() = owner_id);

-- 10. RLS tasks DELETE — только владелец задачи или владелец проекта
DROP POLICY IF EXISTS tasks_delete ON public.tasks;
CREATE POLICY tasks_delete ON public.tasks
FOR DELETE USING (
    auth.uid() = owner_id
    OR project_id IN (
        SELECT id FROM public.projects WHERE owner_id = auth.uid()
    )
);
