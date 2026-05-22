-- Добавить колонку avatar_url в таблицу profiles
-- Выполни этот SQL в Supabase Dashboard → SQL Editor

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
