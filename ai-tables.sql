-- ============================================
-- NIKOMI — Таблицы для AI (Gemini)
-- Выполни в Supabase SQL Editor когда будешь
-- подключать нейронку
-- ============================================

-- 1. История диалогов с AI
CREATE TABLE IF NOT EXISTS public.ai_conversations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Декомпозиция проекта (результат работы AI для админа)
CREATE TABLE IF NOT EXISTS public.ai_decompositions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    -- Что пользователь описал нейронке
    input_description TEXT NOT NULL,
    -- Что нейронка вернула (JSON со списком задач, этапов, сроков)
    result JSONB,
    -- Статус: pending / done / applied (применено к проекту)
    status TEXT DEFAULT 'done' CHECK (status IN ('pending', 'done', 'applied')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Дневной план участника (результат распределения нагрузки)
CREATE TABLE IF NOT EXISTS public.ai_daily_plans (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    plan_date DATE NOT NULL DEFAULT CURRENT_DATE,
    -- JSON с расписанием на день: [{time, task_id, duration, note}]
    schedule JSONB,
    -- Общая нагрузка в часах
    total_hours NUMERIC(4,1),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- Один план на пользователя в день
    UNIQUE(user_id, plan_date)
);

-- ============================================
-- RLS политики
-- ============================================

ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_decompositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_daily_plans ENABLE ROW LEVEL SECURITY;

-- Диалоги — только свои
CREATE POLICY "ai_conv_select" ON public.ai_conversations
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "ai_conv_insert" ON public.ai_conversations
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ai_conv_delete" ON public.ai_conversations
    FOR DELETE USING (auth.uid() = user_id);

-- Декомпозиции — только владелец проекта
CREATE POLICY "ai_decomp_select" ON public.ai_decompositions
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "ai_decomp_insert" ON public.ai_decompositions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Дневные планы — только свои
CREATE POLICY "ai_plan_select" ON public.ai_daily_plans
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "ai_plan_insert" ON public.ai_daily_plans
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ai_plan_update" ON public.ai_daily_plans
    FOR UPDATE USING (auth.uid() = user_id);
