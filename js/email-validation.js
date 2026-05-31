const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const BLOCKED_TLDS = new Set(['example', 'invalid', 'localhost', 'local', 'test']);
const DISPOSABLE_DOMAINS = new Set([
    '10minutemail.com',
    'guerrillamail.com',
    'mailinator.com',
    'tempmail.com',
    'temp-mail.org',
    'trashmail.com',
    'yopmail.com'
]);

export function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function checkEmailSyntax(email) {
    if (!email) return 'Введите email';
    if (email.length > 254 || !EMAIL_RE.test(email)) return 'Введите корректный email';
    if (email.includes('..')) return 'Email не должен содержать две точки подряд';

    const parts = email.split('@');
    if (parts.length !== 2) return 'Введите корректный email';

    const [local, domain] = parts;
    if (!local || local.length > 64) return 'Введите корректный email';
    if (!domain || domain.length > 253) return 'Введите корректный домен email';
    if (domain.startsWith('-') || domain.endsWith('-')) return 'Введите корректный домен email';

    const labels = domain.split('.');
    if (labels.some(label => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-'))) {
        return 'Введите корректный домен email';
    }
    if (labels.some(label => !/^[a-z0-9-]+$/i.test(label))) return 'Введите корректный домен email';
    if (BLOCKED_TLDS.has(labels[labels.length - 1])) return 'Введите настоящий email-домен';
    if (DISPOSABLE_DOMAINS.has(domain)) return 'Одноразовые почтовые адреса не подходят';

    return null;
}

async function hasMailExchange(domain) {
    const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`;
    const response = await fetch(url, {
        headers: { accept: 'application/dns-json' }
    });

    if (!response.ok) throw new Error('dns_request_failed');

    const result = await response.json();
    if (result.Status !== 0) return false;

    const answers = Array.isArray(result.Answer) ? result.Answer : [];
    return answers.some(answer => answer.type === 15 && answer.data && answer.data !== '.');
}

export async function validateEmailAddress(email, options = {}) {
    const normalizedEmail = normalizeEmail(email);
    const syntaxError = checkEmailSyntax(normalizedEmail);

    if (syntaxError) {
        return { valid: false, email: normalizedEmail, message: syntaxError };
    }

    if (options.checkDns === false) {
        return { valid: true, email: normalizedEmail };
    }

    const domain = normalizedEmail.split('@')[1];

    try {
        const acceptsMail = await hasMailExchange(domain);
        if (!acceptsMail) {
            return {
                valid: false,
                email: normalizedEmail,
                message: 'Домен этой почты не принимает письма'
            };
        }
    } catch (error) {
        return {
            valid: true,
            verified: false,
            email: normalizedEmail,
            message: 'Не удалось проверить домен почты, но формат выглядит корректно'
        };
    }

    return { valid: true, verified: true, email: normalizedEmail };
}
