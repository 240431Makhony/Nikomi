// ============================================
// NIKOMI — Supabase Client
// ============================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================
// AUTH
// ============================================

export async function signUp(email, password, name, role) {
    // 1. Регистрируем пользователя
    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name, role } }
    });
    if (error) return { success: false, error: error.message };
    if (!data.user) return { success: false, error: 'Не удалось создать пользователя' };

    // 2. Создаём профиль вручную (на случай если триггер не работает)
    try {
        await supabase.from('profiles').upsert({
            id: data.user.id,
            name: name || email.split('@')[0],
            email: email,
            role: 'member', // всегда member — реальная роль определяется через проекты
        }, { onConflict: 'id', ignoreDuplicates: true });
    } catch (e) {
        console.warn('Profile upsert warning:', e);
    }

    return { success: true, user: data.user };
}

export async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { success: false, error: error.message };
    return { success: true, user: data.user, session: data.session };
}

export async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + '/auth-callback.html' }
    });
    if (error) return { success: false, error: error.message };
    return { success: true };
}

export async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) return { success: false, error: error.message };
    return { success: true };
}

export async function getCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

export async function getProfile(userId) {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
    if (error) return null;
    return data;
}

export function onAuthChange(callback) {
    return supabase.auth.onAuthStateChange((_event, session) => {
        callback(session?.user || null);
    });
}

// ============================================
// PROJECTS
// ============================================

export async function getProjects() {
    const user = await getCurrentUser();
    if (!user) return [];

    const profile = await getProfile(user.id);
    const email = profile?.email || user.email;

    const { data, error } = await supabase
        .from('projects')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) { console.error(error); return []; }

    return (data || []).filter(p =>
        p.owner_id === user.id ||
        (p.members && p.members.includes(email))
    );
}

export async function createProject(project) {
    const user = await getCurrentUser();
    if (!user) return { success: false, error: 'Не авторизован' };

    const { data, error } = await supabase
        .from('projects')
        .insert({ ...project, owner_id: user.id })
        .select()
        .single();

    if (error) return { success: false, error: error.message };
    return { success: true, project: data };
}

export async function updateProject(id, updates) {
    const { error } = await supabase
        .from('projects')
        .update(updates)
        .eq('id', id);
    if (error) return { success: false, error: error.message };
    return { success: true };
}

export async function deleteProject(id) {
    const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', id);
    if (error) return { success: false, error: error.message };
    return { success: true };
}

// ============================================
// TASKS
// ============================================

export async function getTasks(projectId = null) {
    const user = await getCurrentUser();
    if (!user) return [];

    const profile = await getProfile(user.id);
    const email = profile?.email || user.email;
    const projects = await getProjects();
    const accessibleProjectIds = (projects || []).map(p => p.id);

    let query = supabase
        .from('tasks')
        .select('*')
        .order('created_at', { ascending: false });

    if (projectId) query = query.eq('project_id', projectId);

    const { data, error } = await query;
    if (error) { console.error(error); return []; }

    // Показываем задачи:
    // - созданные мной
    // - назначенные мне
    // - из проектов где я владелец или участник
    return (data || []).filter(t =>
        t.owner_id === user.id ||
        t.assignee === email ||
        accessibleProjectIds.includes(t.project_id)
    );
}

export async function createTask(task) {
    const user = await getCurrentUser();
    if (!user) return { success: false, error: 'Не авторизован' };

    const { data, error } = await supabase
        .from('tasks')
        .insert({ ...task, owner_id: user.id })
        .select()
        .single();

    if (error) return { success: false, error: error.message };
    return { success: true, task: data };
}

export async function updateTask(id, updates) {
    const { error } = await supabase
        .from('tasks')
        .update(updates)
        .eq('id', id);
    if (error) return { success: false, error: error.message };
    return { success: true };
}

export async function deleteTask(id) {
    const { error } = await supabase
        .from('tasks')
        .delete()
        .eq('id', id);
    if (error) return { success: false, error: error.message };
    return { success: true };
}

// ============================================
// NOTES
// ============================================

export async function getNotes() {
    const user = await getCurrentUser();
    if (!user) return [];

    const { data, error } = await supabase
        .from('notes')
        .select('*')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false });

    if (error) { console.error(error); return []; }
    return data;
}

export async function createNote(note) {
    const user = await getCurrentUser();
    if (!user) return { success: false, error: 'Не авторизован' };

    const { data, error } = await supabase
        .from('notes')
        .insert({ ...note, owner_id: user.id })
        .select()
        .single();

    if (error) return { success: false, error: error.message };
    return { success: true, note: data };
}

export async function deleteNote(id) {
    const { error } = await supabase.from('notes').delete().eq('id', id);
    if (error) return { success: false, error: error.message };
    return { success: true };
}

// ============================================
// INVITATIONS
// ============================================

export async function getAllProfiles() {
    const { data, error } = await supabase
        .from('profiles')
        .select('id, name, email, avatar_url');
    if (error) {
        console.warn('getAllProfiles error (возможно RLS):', error.message);
        return [];
    }
    return data || [];
}

export async function checkUserByEmail(email) {
    // Используем maybeSingle вместо single — не падает если 0 результатов
    const { data, error } = await supabase
        .from('profiles')
        .select('id, name, email')
        .eq('email', email.toLowerCase().trim())
        .maybeSingle();
    if (error) {
        console.error('checkUserByEmail error:', error);
        return { exists: false };
    }
    if (!data) return { exists: false };
    return { exists: true, user: data };
}

export async function updateProfile(userId, updates) {
    const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', userId);
    if (error) return { success: false, error: error.message };
    return { success: true };
}

export async function inviteMember(projectId, email) {
    const user = await getCurrentUser();
    if (!user) return { success: false, error: 'Не авторизован' };

    const { data, error } = await supabase
        .from('invitations')
        .insert({ project_id: projectId, invited_email: email, invited_by: user.id })
        .select()
        .single();

    if (error) return { success: false, error: error.message };
    return { success: true, invitation: data };
}
