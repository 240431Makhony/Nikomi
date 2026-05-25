-- ============================================
-- NIKOMI — SQL fixes
-- Выполни в Supabase Dashboard → SQL Editor
-- ============================================

-- 1. Триггер для автосоздания профиля при регистрации
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, role, created_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    'user',
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

-- 2. Добавить avatar_url в profiles если нет
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- 3. Исправить RLS для tasks — разрешить UPDATE назначенным исполнителям
DROP POLICY IF EXISTS tasks_update ON public.tasks;
CREATE POLICY tasks_update ON public.tasks
FOR UPDATE USING (
  auth.uid() = owner_id
  OR assignee = (SELECT email FROM public.profiles WHERE id = auth.uid())
);

-- 4. Исправить RLS для tasks — разрешить SELECT назначенным исполнителям
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
