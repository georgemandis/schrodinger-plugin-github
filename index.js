// GitHub plugin for Schrodinger
//
// When the clip is a GitHub link:
//   Titled reference   [tauri-apps/tauri#1: feat(readme) init](https://github.com/…)
//                      (issues, pull requests, commits and repositories)
//   Details            title, state, author and labels; or a repository's
//                      description, language and stars
//   Permanent link     a file link on a branch, rewritten to the commit that
//                      branch points at now, so it keeps showing these lines
//
// When the clip is code copied from a file on GitHub (in Chrome or Safari,
// which record the page a clip came from):
//   Code with link     a fenced block, followed by a permanent link to the file
//
// Uses GitHub's public API without signing in: public repositories only, and
// GitHub allows 60 lookups an hour per network address.

// --- recognizing GitHub links -------------------------------------------------

const RESERVED = new Set(['settings', 'notifications', 'pulls', 'issues', 'marketplace', 'explore', 'topics', 'sponsors',
    'orgs', 'organizations', 'login', 'join', 'features', 'about', 'pricing', 'search', 'new', 'codespaces', 'collections', 'trending']);

function parseGitHub(raw) {
    if (!raw) return null;
    const t = raw.trim();
    if (!t || /\s/.test(t) || t.length > 700) return null;
    let url;
    try { url = new URL(/^https?:\/\//i.test(t) ? t : 'https://' + t); } catch { return null; }
    if (url.hostname.toLowerCase().replace(/^www\./, '') !== 'github.com') return null;
    const parts = url.pathname.split('/').filter(Boolean).map(p => { try { return decodeURIComponent(p); } catch { return p; } });
    if (parts.length < 2 || RESERVED.has(parts[0].toLowerCase())) return null;
    const [owner, repo, kind, ...rest] = parts;
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
    const base = { owner, repo: repo.replace(/\.git$/, ''), hash: url.hash };
    if (!kind) return { ...base, type: 'repo' };
    if ((kind === 'issues' || kind === 'pull') && /^\d+$/.test(rest[0] || '')) return { ...base, type: 'issue', number: +rest[0] };
    if (kind === 'commit' && /^[0-9a-f]{7,40}$/i.test(rest[0] || '')) return { ...base, type: 'commit', sha: rest[0] };
    if ((kind === 'blob' || kind === 'tree') && rest.length) return { ...base, type: 'file', view: kind, rest };
    return null;
}

const repoUrl = g => `https://github.com/${g.owner}/${g.repo}`;

// --- GitHub API ---------------------------------------------------------------

async function api(path, accept) {
    const res = await schrodinger.fetch('https://api.github.com' + path, {
        headers: { Accept: accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (res.status === 403 || res.status === 429) {
        if (res.headers.get('x-ratelimit-remaining') === '0') {
            const reset = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000;
            const minutes = reset ? Math.max(1, Math.ceil((reset - Date.now()) / 60000)) : null;
            throw new Error(`GitHub's hourly limit for lookups without signing in is used up` + (minutes ? `; try again in ${minutes} min` : ''));
        }
        throw new Error('GitHub refused the request (403)');
    }
    return res;
}

async function json(path, what) {
    const res = await api(path);
    if (res.status === 404) throw new Error(`${what} was not found, or is in a private repository`);
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    return res.json();
}

// A branch name can contain slashes, so in /blob/feature/x/src/a.rs the ref
// could be "feature" or "feature/x". Ask GitHub which prefix is a real ref.
async function resolveRef(g) {
    const max = Math.min(g.rest.length, 4);
    for (let n = 1; n <= max; n++) {
        const ref = g.rest.slice(0, n).join('/');
        if (n === 1 && /^[0-9a-f]{40}$/i.test(ref)) return { sha: ref, path: g.rest.slice(1), pinned: true };
        const res = await api(`/repos/${g.owner}/${g.repo}/commits/${encodeURIComponent(ref)}`, 'application/vnd.github.sha');
        if (res.ok) return { sha: (await res.text()).trim(), path: g.rest.slice(n), pinned: false };
        if (res.status === 404 && n === 1) {
            // Distinguish "no such repository" from "no such ref" once.
            const repo = await api(`/repos/${g.owner}/${g.repo}`);
            if (repo.status === 404) throw new Error(`${g.owner}/${g.repo} was not found, or is a private repository`);
        }
    }
    throw new Error('could not work out which branch this link points at');
}

async function permalink(g) {
    const ref = await resolveRef(g);
    const path = ref.path.map(encodeURIComponent).join('/');
    return `${repoUrl(g)}/${g.view}/${ref.sha}${path ? '/' + path : ''}${g.hash || ''}`;
}

// --- output -------------------------------------------------------------------

const escapeHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mdText = s => s.replace(/([\\[\]])/g, '\\$1');
const text = value => ({ format: schrodinger.textFormat(), data: schrodinger.encode(value) });
const linked = (label, url, suffix = '') => [
    { format: schrodinger.htmlFormat(), data: schrodinger.encode(`<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>${escapeHtml(suffix)}`) },
    text(`[${mdText(label)}](${url})${suffix}`),
];

function issueState(d) {
    if (d.pull_request) return d.pull_request.merged_at ? 'merged' : (d.draft ? 'draft' : d.state);
    return d.state === 'closed' && d.state_reason === 'not_planned' ? 'closed as not planned' : d.state;
}

const firstLine = s => (s || '').split('\n')[0].trim();

const LANGUAGES = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx', py: 'python', rb: 'ruby',
    rs: 'rust', go: 'go', zig: 'zig', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cs: 'csharp', java: 'java', kt: 'kotlin',
    swift: 'swift', m: 'objectivec', php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'fish', ps1: 'powershell',
    json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'toml', xml: 'xml', html: 'html', css: 'css', scss: 'scss', md: 'markdown',
    sql: 'sql', lua: 'lua', ex: 'elixir', exs: 'elixir', hs: 'haskell', scala: 'scala', dart: 'dart', vue: 'vue', svelte: 'svelte',
    tf: 'hcl', nix: 'nix', r: 'r', jl: 'julia', pl: 'perl', gradle: 'groovy', proto: 'protobuf', graphql: 'graphql',
};

function fence(code, filename) {
    const base = (filename || '').toLowerCase();
    const ext = base.includes('.') ? base.split('.').pop() : '';
    const lang = base === 'dockerfile' ? 'dockerfile' : base === 'makefile' ? 'makefile' : (LANGUAGES[ext] || '');
    const longest = Math.max(2, ...(code.match(/`+/g) || []).map(run => run.length));
    const ticks = '`'.repeat(longest + 1);
    return `${ticks}${lang}\n${code}\n${ticks}`;
}

const MODES = {
    async reference(ctx) {
        const g = ctx.link;
        if (g.type === 'issue') {
            const d = await json(`/repos/${g.owner}/${g.repo}/issues/${g.number}`, `${g.owner}/${g.repo}#${g.number}`);
            return linked(`${g.owner}/${g.repo}#${g.number}: ${d.title}`, d.html_url);
        }
        if (g.type === 'commit') {
            const d = await json(`/repos/${g.owner}/${g.repo}/commits/${g.sha}`, 'this commit');
            return linked(`${g.owner}/${g.repo}@${d.sha.slice(0, 7)}: ${firstLine(d.commit.message)}`, d.html_url);
        }
        if (g.type === 'repo') {
            const d = await json(`/repos/${g.owner}/${g.repo}`, `${g.owner}/${g.repo}`);
            return linked(d.full_name, d.html_url, d.description ? `: ${d.description}` : '');
        }
        const ref = await resolveRef(g);
        const path = ref.path.join('/');
        const lines = (g.hash || '').replace(/^#/, '');
        const label = `${g.owner}/${g.repo}` + (path ? `: ${path}` : '') + (lines ? ` (${lines.replace(/L/g, '').replace('-', '–')})` : '');
        return linked(label, await permalink(g));
    },
    async details(ctx) {
        const g = ctx.link;
        if (g.type === 'issue') {
            const d = await json(`/repos/${g.owner}/${g.repo}/issues/${g.number}`, `${g.owner}/${g.repo}#${g.number}`);
            const kind = d.pull_request ? 'Pull request' : 'Issue';
            const labels = (d.labels || []).map(l => l.name).filter(Boolean);
            return [text([
                `${g.owner}/${g.repo}#${g.number}: ${d.title}`,
                `${kind}, ${issueState(d)}, opened by ${d.user ? d.user.login : 'unknown'} on ${String(d.created_at).slice(0, 10)}`,
                ...(labels.length ? [`Labels: ${labels.join(', ')}`] : []),
                d.html_url,
            ].join('\n'))];
        }
        if (g.type === 'commit') {
            const d = await json(`/repos/${g.owner}/${g.repo}/commits/${g.sha}`, 'this commit');
            const author = (d.commit.author && d.commit.author.name) || (d.author && d.author.login) || 'unknown';
            return [text(`${g.owner}/${g.repo}@${d.sha.slice(0, 7)}: ${firstLine(d.commit.message)}\n${author}, ${String(d.commit.author.date).slice(0, 10)}\n${d.html_url}`)];
        }
        const d = await json(`/repos/${g.owner}/${g.repo}`, `${g.owner}/${g.repo}`);
        const facts = [d.language, `${Number(d.stargazers_count).toLocaleString('en-US')} stars`, d.license && d.license.spdx_id !== 'NOASSERTION' ? d.license.spdx_id : null].filter(Boolean);
        return [text([d.full_name, ...(d.description ? [d.description] : []), facts.join(', '), d.html_url].join('\n'))];
    },
    async permalink(ctx) {
        return [text(await permalink(ctx.link))];
    },
    async code(ctx) {
        const g = ctx.source;
        const link = await permalink(g);
        const filename = g.rest[g.rest.length - 1];
        const code = ctx.text.replace(/\r\n?/g, '\n').replace(/^\n+|\s+$/g, '');
        return [text(`${fence(code, filename)}\n${link}`)];
    },
};

// --- plugin -------------------------------------------------------------------

let cache = { changeCount: null, ctx: null };

async function context(entry) {
    if (cache.changeCount === entry.changeCount) return cache.ctx;
    const format = entry.formats.find(f => f.format === schrodinger.textFormat());
    let ctx = null;
    if (format && format.size > 0 && format.size <= 200000) {
        const clip = schrodinger.decode(await schrodinger.readFormat(entry, format.format));
        const link = parseGitHub(clip);
        // Text copied from a file's page; a copied link is handled as a link.
        const from = link ? null : parseGitHub(entry.sourceUrl);
        const source = from && from.type === 'file' && from.view === 'blob' ? from : null;
        if (link || source) ctx = { link, source, text: clip };
    }
    cache = { changeCount: entry.changeCount, ctx };
    return ctx;
}

export default {
    id: "github",
    label: "GitHub",
    modes: [
        { id: "reference", label: "Titled reference", default: true },
        { id: "details", label: "Details" },
        { id: "permalink", label: "Permanent link" },
        { id: "code", label: "Code with link" }
    ],
    async appliesTo(entry, mode) {
        const ctx = await context(entry);
        if (!ctx) return false;
        if (mode === 'code') return !!ctx.source;
        if (!ctx.link) return mode === undefined;
        if (mode === 'details') return ctx.link.type !== 'file';
        // A link that already names a full commit is as permanent as it gets.
        if (mode === 'permalink') return ctx.link.type === 'file' && !/^[0-9a-f]{40}$/i.test(ctx.link.rest[0]);
        return true;
    },
    async apply(entry, mode) {
        const ctx = await context(entry);
        if (!ctx) throw new Error('this clip is not from GitHub');
        const chosen = mode || (ctx.link ? 'reference' : 'code');
        if (chosen === 'code' && !ctx.source) throw new Error('this clip was not copied from a file on GitHub');
        if (chosen !== 'code' && !ctx.link) throw new Error('this clip is not a GitHub link');
        return MODES[chosen](ctx);
    }
};
