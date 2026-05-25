-- ============================================
-- NIKOMI — SQL fixes
-- Выполни в Supabase Dashboard → SQL Editor
-- ============================================

-- 1. Синхронизировать существующих пользователей из auth в profiles
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

-- 2. Триггер — всегда создаёт профиль с role='member'
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

-- 3. Разрешить авторизованным читать профили других (для поиска по email)
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
FOR SELECT USING (auth.role() = 'authenticated');

-- 4. Разрешить обновлять только свой профиль
DROP POLICY IF EXISTS profiles_update ON public.profiles;
CREATE POLICY profiles_update ON public.profiles
FOR UPDATE USING (auth.uid() = id);

-- 5. Разрешить вставку своего профиля
DROP POLICY IF EXISTS profiles_insert ON public.profiles;
CREATE POLICY profiles_insert ON public.profiles
FOR INSERT WITH CHECK (auth.uid() = id);

-- 6. Добавить avatar_url если нет
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- 7. Исправить RLS tasks — исполнитель может менять статус
DROP POLICY IF EXISTS tasks_update ON public.tasks;
CREATE POLICY tasks_update ON public.tasks
FOR UPDATE USING (
    auth.uid() = owner_id
    OR assignee = (SELECT email FROM public.profiles WHERE id = auth.uid())
);
