-- ============================================
-- NIKOMI — Supabase Database Setup
-- Выполни этот SQL в Supabase SQL Editor
-- ============================================

-- 1. Таблица пользователей (расширяет auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'creator' CHECK (role IN ('creator', 'member')),
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Таблица проектов
CREATE TABLE IF NOT EXISTS public.projects (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'planning', 'completed', 'paused')),
    start_date DATE,
    deadline DATE,
    owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Таблица участников проекта
CREATE TABLE IF NOT EXISTS public.project_members (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'member')),
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, user_id)
);

-- 4. Таблица задач
CREATE TABLE IF NOT EXISTS public.tasks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'todo' CHECK (status IN ('todo', 'inprogress', 'done')),
    priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    due_date DATE,
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Таблица заметок
CREATE TABLE IF NOT EXISTS public.notes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Таблица приглашений
CREATE TABLE IF NOT EXISTS public.invitations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
    invited_email TEXT NOT NULL,
    invited_by UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    token TEXT UNIQUE DEFAULT gen_random_uuid()::TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ROW LEVEL SECURITY (RLS) — Защита данных
-- ============================================

-- Включаем RLS для всех таблиц
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- PROFILES: пользователь видит только свой профиль
CREATE POLICY "profiles_select" ON public.profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "profiles_insert" ON public.profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

-- PROJECTS: владелец и участники видят проект
CREATE POLICY "projects_select" ON public.projects
    FOR SELECT USING (
        auth.uid() = owner_id OR
        EXISTS (
            SELECT 1 FROM public.project_members
            WHERE project_id = projects.id AND user_id = auth.uid()
        )
    );

CREATE POLICY "projects_insert" ON public.projects
    FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "projects_update" ON public.projects
    FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "projects_delete" ON public.projects
    FOR DELETE USING (auth.uid() = owner_id);

-- PROJECT_MEMBERS: участники видят других участников своих проектов
CREATE POLICY "members_select" ON public.project_members
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.projects
            WHERE id = project_id AND owner_id = auth.uid()
        ) OR user_id = auth.uid()
    );

CREATE POLICY "members_insert" ON public.project_members
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.projects
            WHERE id = project_id AND owner_id = auth.uid()
        )
    );

CREATE POLICY "members_delete" ON public.project_members
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.projects
            WHERE id = project_id AND owner_id = auth.uid()
        ) OR user_id = auth.uid()
    );

-- TASKS: владелец задачи и участники проекта
CREATE POLICY "tasks_select" ON public.tasks
    FOR SELECT USING (
        auth.uid() = owner_id OR
        EXISTS (
            SELECT 1 FROM public.project_members
            WHERE project_id = tasks.project_id AND user_id = auth.uid()
        ) OR
        EXISTS (
            SELECT 1 FROM public.projects
            WHERE id = tasks.project_id AND owner_id = auth.uid()
        )
    );

CREATE POLICY "tasks_insert" ON public.tasks
    FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "tasks_update" ON public.tasks
    FOR UPDATE USING (
        auth.uid() = owner_id OR
        EXISTS (
            SELECT 1 FROM public.project_members
            WHERE project_id = tasks.project_id AND user_id = auth.uid()
        )
    );

CREATE POLICY "tasks_delete" ON public.tasks
    FOR DELETE USING (auth.uid() = owner_id);

-- NOTES: только владелец
CREATE POLICY "notes_select" ON public.notes
    FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "notes_insert" ON public.notes
    FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "notes_update" ON public.notes
    FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "notes_delete" ON public.notes
    FOR DELETE USING (auth.uid() = owner_id);

-- INVITATIONS
CREATE POLICY "invitations_select" ON public.invitations
    FOR SELECT USING (
        auth.uid() = invited_by OR
        invited_email = (SELECT email FROM auth.users WHERE id = auth.uid())
    );

CREATE POLICY "invitations_insert" ON public.invitations
    FOR INSERT WITH CHECK (auth.uid() = invited_by);

-- ============================================
-- ФУНКЦИИ И ТРИГГЕРЫ
-- ============================================

-- Автоматически создаём профиль при регистрации
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, name, email, role)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'name', ''),
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'role', 'creator')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Триггер на создание пользователя
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Автообновление updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON public.projects
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_tasks_updated_at
    BEFORE UPDATE ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_notes_updated_at
    BEFORE UPDATE ON public.notes
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================
-- ГОТОВО! Теперь настрой Authentication
-- ============================================
