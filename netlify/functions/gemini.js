const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8'
};

function json(statusCode, body) {
    return {
        statusCode,
        headers,
        body: JSON.stringify(body)
    };
}

function buildPrompt(type, data) {
    if (type === 'decompose') {
        return [
            'You are a project manager. Create a practical project decomposition in Russian.',
            `Project title: ${data.title || 'New project'}`,
            `Project description: ${data.description || ''}`,
            `Deadline in days: ${data.days || 30}`,
            'Use short task titles. Use priorities: high, medium, low.',
            'Return data that matches the provided JSON schema exactly.'
        ].join('\n');
    }

    if (type === 'dayplan') {
        const taskList = (data.tasks || [])
            .map(t => `- ${t.title} (priority: ${t.priority || 'medium'}${t.due_date ? `, due: ${t.due_date}` : ''})`)
            .join('\n');

        return [
            'You are a productivity planner. Build a realistic daily schedule in Russian.',
            `Work day: ${data.startTime || '09:00'} - ${data.endTime || '18:00'}`,
            `User notes: ${data.notes || 'none'}`,
            'Tasks:',
            taskList,
            'Rules:',
            '- Keep the schedule inside the work day.',
            '- Prefer 45-120 minute focused blocks for hard tasks.',
            '- Add short breaks and lunch only when useful.',
            '- If there are too many tasks, set overload to true and explain what to move.',
            '- Return data that matches the provided JSON schema exactly.'
        ].join('\n');
    }

    throw new Error('Unknown AI request type');
}

function buildResponseSchema(type) {
    if (type === 'decompose') {
        return {
            type: 'OBJECT',
            properties: {
                phases: {
                    type: 'ARRAY',
                    items: {
                        type: 'OBJECT',
                        properties: {
                            name: { type: 'STRING' },
                            days: { type: 'INTEGER' },
                            tasks: {
                                type: 'ARRAY',
                                items: {
                                    type: 'OBJECT',
                                    properties: {
                                        title: { type: 'STRING' },
                                        priority: { type: 'STRING', enum: ['high', 'medium', 'low'] },
                                        assignee: { type: 'STRING' }
                                    },
                                    required: ['title', 'priority', 'assignee']
                                }
                            }
                        },
                        required: ['name', 'days', 'tasks']
                    }
                }
            },
            required: ['phases']
        };
    }

    if (type === 'dayplan') {
        return {
            type: 'OBJECT',
            properties: {
                schedule: {
                    type: 'ARRAY',
                    items: {
                        type: 'OBJECT',
                        properties: {
                            time: { type: 'STRING' },
                            endTime: { type: 'STRING' },
                            title: { type: 'STRING' },
                            duration: { type: 'INTEGER' },
                            priority: { type: 'STRING', enum: ['high', 'medium', 'low'] },
                            tip: { type: 'STRING' },
                            type: { type: 'STRING', enum: ['task', 'break', 'lunch'] }
                        },
                        required: ['time', 'endTime', 'title', 'duration', 'priority', 'tip', 'type']
                    }
                },
                summary: { type: 'STRING' },
                overload: { type: 'BOOLEAN' },
                suggestion: { type: 'STRING' }
            },
            required: ['schedule', 'summary', 'overload', 'suggestion']
        };
    }

    throw new Error('Unknown AI request type');
}

function parseJsonFromText(text) {
    const cleaned = text
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
        if (!match) throw new Error('Gemini returned text without JSON');

        try {
            return JSON.parse(match[0].replace(/,\s*([}\]])/g, '$1'));
        } catch (_) {
            throw new Error(`Gemini returned invalid JSON: ${firstError.message}`);
        }
    }
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
    if (event.httpMethod !== 'POST') return json(405, { success: false, error: 'Method not allowed' });

    try {
        const { type, data = {} } = JSON.parse(event.body || '{}');
        const apiKey = process.env.GEMINI_API_KEY;
        const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

        if (!apiKey) {
            return json(500, {
                success: false,
                error: 'GEMINI_API_KEY is not set in Netlify environment variables'
            });
        }

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: buildPrompt(type, data) }] }],
                generationConfig: {
                    temperature: 0.2,
                    maxOutputTokens: 8192,
                    responseMimeType: 'application/json',
                    responseSchema: buildResponseSchema(type)
                }
            })
        });

        const payload = await response.json().catch(async () => ({ raw: await response.text() }));
        if (!response.ok) {
            return json(response.status, {
                success: false,
                error: payload?.error?.message || payload.raw || 'Gemini API request failed'
            });
        }

        const text = payload.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (!text) {
            return json(500, {
                success: false,
                error: 'Gemini returned an empty response'
            });
        }

        return json(200, {
            success: true,
            result: parseJsonFromText(text)
        });
    } catch (error) {
        return json(500, {
            success: false,
            error: error.message || 'Unexpected Gemini function error'
        });
    }
};
