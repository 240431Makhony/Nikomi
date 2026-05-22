function sendJson(res, status, body) {
    res.status(status);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
}

function buildPrompt(type, data = {}) {
    if (type === 'decompose') {
        return [
            'You are a senior project manager.',
            'Create a practical project decomposition. All user-facing text must be in Russian.',
            `Project title: ${data.title || 'New project'}`,
            `Project description: ${data.description || ''}`,
            `Deadline in days: ${data.days || 30}`,
            '',
            'Rules:',
            '- Split the work into 4-5 phases.',
            '- Each phase should contain 3-5 short tasks.',
            '- Use priorities exactly: high, medium, low.',
            '- Leave assignee as an empty string.',
            '- Return only valid JSON. No markdown, no comments.',
            '',
            'JSON shape:',
            '{"phases":[{"name":"string","days":7,"tasks":[{"title":"string","priority":"high","assignee":""}]}]}'
        ].join('\n');
    }

    if (type === 'dayplan') {
        const tasks = Array.isArray(data.tasks) ? data.tasks : [];
        const taskList = tasks
            .map(task => {
                const meta = [
                    `priority: ${task.priority || 'medium'}`,
                    task.due_date ? `due: ${task.due_date}` : '',
                    task.project_deadline ? `project deadline: ${task.project_deadline}` : '',
                    task.description ? `description: ${task.description}` : ''
                ].filter(Boolean).join(', ');

                return `- ${task.title || 'Task'} (${meta})`;
            })
            .join('\n');

        return [
            'You are a productivity planner.',
            'Build a realistic daily schedule. All user-facing text must be in Russian.',
            `Planning date: ${data.date || 'today'}`,
            `Work day: ${data.startTime || '09:00'} - ${data.endTime || '18:00'}`,
            `User notes: ${data.notes || 'none'}`,
            '',
            'Tasks:',
            taskList || '- No tasks provided',
            '',
            'Rules:',
            '- Keep the schedule inside the work day.',
            '- Estimate task size realistically before scheduling. Do not give the same duration to every task.',
            '- Database work, schema design, migrations, authorization/RLS, backend APIs, frontend implementation, and component integration are deep development tasks.',
            '- Deep development tasks need long uninterrupted blocks: database 150-240 minutes, backend 120-180 minutes, frontend 120-180 minutes, integration 90-150 minutes, architecture/planning 60-120 minutes.',
            '- Small tasks like review, notes, simple fixes, meetings, or requirements clarification can be 30-75 minutes.',
            '- Do not schedule more than 2-3 deep development tasks in one normal work day.',
            '- If a deep task cannot fit honestly, schedule only the first realistic focus block and mention continuation in the tip, or move the whole task to carryover.',
            '- If there are too many tasks, set overload to true. In that case, schedule only a feasible subset and put moved tasks into carryover; do not still put every moved task into schedule.',
            '- Use the work day efficiently. If there is more than 45 minutes free before the end of the work day, schedule another suitable task or extend an active deep work block.',
            '- The final scheduled work block should normally end within 30 minutes of the work day end. A larger empty gap is allowed only if the user notes explicitly ask for free time, low energy, or meetings.',
            '- Do not move tasks to carryover while leaving 60+ minutes unused in the current work day, unless every remaining task is too large to start safely; explain that exact reason in suggestion.',
            '- Carryover items must name the exact original task title, a date in YYYY-MM-DD format, and a short reason.',
            '- Use the next calendar day for urgent carryover. If the deadline is still far away and there is enough slack, you may leave one rest day and move the task to the day after tomorrow; explain that in reason.',
            '- If a task has no deadline, prefer the next calendar day for carryover.',
            '- Add breaks after deep blocks and lunch only when useful.',
            '- Summary should explain the planning logic, not just repeat that work exists.',
            '- Suggestion should be a useful paragraph with advice for tomorrow/later, including which task to start with next.',
            '- Return only valid JSON. No markdown, no comments.',
            '',
            'JSON shape:',
            '{"schedule":[{"time":"09:00","endTime":"09:45","title":"string","duration":45,"priority":"medium","tip":"string","type":"task"}],"summary":"string","overload":false,"suggestion":"string","carryover":[{"title":"original task title","date":"YYYY-MM-DD","reason":"string"}]}',
            'Allowed type values: task, break, lunch.',
            'Allowed priority values: high, medium, low.'
        ].join('\n');
    }

    throw new Error('Unknown AI request type');
}

function parseJsonFromText(text) {
    const cleaned = String(text || '')
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .replace(/,\s*([}\]])/g, '$1')
        .trim();

    try {
        return JSON.parse(cleaned);
    } catch (firstError) {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('Groq returned text without JSON');

        try {
            return JSON.parse(match[0].replace(/,\s*([}\]])/g, '$1'));
        } catch (_) {
            throw new Error(`Groq returned invalid JSON: ${firstError.message}`);
        }
    }
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return sendJson(res, 200, {});
    if (req.method !== 'POST') return sendJson(res, 405, { success: false, error: 'Method not allowed' });

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const { type, data = {} } = body;
        const apiKey = process.env.GROQ_API_KEY;
        const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

        if (!apiKey) {
            return sendJson(res, 500, {
                success: false,
                error: 'GROQ_API_KEY is not set in Vercel environment variables'
            });
        }

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model,
                messages: [
                    {
                        role: 'system',
                        content: 'Return only valid JSON. Do not use markdown. All user-facing string values must be in Russian.'
                    },
                    {
                        role: 'user',
                        content: buildPrompt(type, data)
                    }
                ],
                temperature: 0.2,
                max_tokens: 3000,
                response_format: { type: 'json_object' }
            })
        });

        const payload = await response.json().catch(async () => ({ raw: await response.text() }));
        if (!response.ok) {
            return sendJson(res, response.status, {
                success: false,
                error: payload?.error?.message || payload.raw || 'Groq API request failed'
            });
        }

        const text = payload.choices?.[0]?.message?.content || '';
        if (!text) {
            return sendJson(res, 500, {
                success: false,
                error: 'Groq returned an empty response'
            });
        }

        return sendJson(res, 200, {
            success: true,
            result: parseJsonFromText(text)
        });
    } catch (error) {
        return sendJson(res, 500, {
            success: false,
            error: error.message || 'Unexpected Groq function error'
        });
    }
}
