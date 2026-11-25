import { ATTRIBUTE_NAMES, defineNanoSwarm, type AttributeName, type NanoSwarmElement } from '../../src';
import { checkFormula, parseFormula } from '../../src/formula';
import { toGLSL, toJavaScriptSource } from '../../src/formula/emit';
import { formatMarkup } from '../../src/element/markup';
import { DEMO_TRACK, INSIDE_LINE, LANGS, SLIDES, UI, type Lang, type Slide } from './slides';

// ─── One <nano-swarm> behind every slide ─────────────────────────
// Each slide copies its own element (attributes + formula) onto #swarm, so the
// particles fly from one creation to the next. What you see is the library itself.

defineNanoSwarm();
const el = document.getElementById('swarm') as NanoSwarmElement;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const BACKGROUND = '#000000'; // the page's own ground, so the element has no visible edge
/** Your setup, not part of a slide: kept when the slide changes. */
const SESSION: AttributeName[] = ['audio', 'renderer'];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

const edits = new Map<string, string>(); // live-edited formulas, per slide
let cur = 0;
let lang: Lang = pickLang();

function pickLang(): Lang {
    const asked = new URLSearchParams(location.search).get('lang');
    if (LANGS.includes(asked as Lang)) return asked as Lang;
    try {
        const saved = localStorage.getItem('nanoswarm-deck-lang');
        if (LANGS.includes(saved as Lang)) return saved as Lang;
    } catch { /* storage blocked: fall through */ }
    return navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en';
}

function applySwarm(slide: Slide): void {
    for (const name of ATTRIBUTE_NAMES) {
        if (!SESSION.includes(name) && !slide.swarm.attributes.some(([n]) => n === name)) el.removeAttribute(name);
    }
    for (const [name, value] of slide.swarm.attributes) {
        if (name !== 'background' && !SESSION.includes(name)) el.setAttribute(name, value);
    }
    el.setAttribute('background', BACKGROUND);
    el.formula = edits.get(slide.id) ?? slide.swarm.formula;
}

// ─── Slides ──────────────────────────────────────────────────────

const deck = $('deck');
// Safe in text and in quoted attributes.
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function codeFor(slide: Slide): string {
    // The element as written: what the slide shows is exactly what is drawn.
    const attributes = slide.swarm.attributes.filter(([n]) => n !== 'title' && n !== 'background');
    return formatMarkup({ attributes, formula: slide.swarm.formula });
}

/** The code the library generates, on each engine, for one line of a formula. */
function insideCode(slide: Slide): string {
    const program = parseFormula(slide.swarm.formula);
    const line = slide.swarm.formula.split('\n').find((l) => l.trim().startsWith(`${INSIDE_LINE} =`))?.trim() ?? '';
    const pick = (src: string) => src.split('\n').find((l) => l.includes(` l_${INSIDE_LINE} =`))?.trim() ?? '';
    const t = UI[lang];
    return `<span class="c"># ${escape(t.oneLine)}</span>\n${escape(line)}\n\n`
        + `<span class="c">// CPU · JavaScript</span>\n${escape(pick(toJavaScriptSource(program)))}\n\n`
        + `<span class="c">// GPU · GLSL</span>\n${escape(pick(toGLSL(program)))}`
        + `\n\n<span class="c">// ${escape(t.cpuCap)}</span>`;
}

function render(): void {
    const t = UI[lang];
    document.documentElement.lang = lang;
    deck.innerHTML = '';
    SLIDES.forEach((slide, i) => {
        const x = slide.text[lang];
        const s = document.createElement('section');
        s.className = 'slide';
        s.id = `slide-${slide.id}`;
        s.setAttribute('aria-roledescription', 'slide');
        s.setAttribute('aria-label', `${i + 1} / ${SLIDES.length}: ${x.name}`);
        const heading = i === 0 ? `<h1>${x.title}</h1>` : `<h2>${x.title}</h2>`;
        let extra = '';
        if (slide.showFormula) extra += `<pre>${escape(codeFor(slide))}</pre>`;
        if (slide.editable) {
            extra += `<label class="editor"><span class="sr">${escape(x.name)}</span>`
                + `<textarea id="edit-${slide.id}" spellcheck="false" autocapitalize="off" autocomplete="off" rows="7">${escape(edits.get(slide.id) ?? slide.swarm.formula)}</textarea></label>`
                + `<p class="status" id="status-${slide.id}" role="status"></p>`;
        }
        if (slide.id === 'sound') {
            extra += `<div class="actions"><button type="button" class="pill primary" data-audio="track"></button>`
                + `<button type="button" class="pill" data-audio="mic"></button></div><p class="tag">${escape(t.credit)}</p>`;
        }
        if (slide.id === 'inside') {
            extra += `<pre>${insideCode(slide)}</pre><div class="actions" role="group" aria-label="${escape(t.engine)}">`
                + ['', 'gpu', 'cpu'].map((r) => `<button type="button" class="pill" data-renderer="${r}">${r ? r.toUpperCase() : escape(t.auto)}</button>`).join('')
                + '</div>';
        }
        s.innerHTML = `<span class="eyebrow">${x.eyebrow}</span>${heading}${x.body}${extra}`;
        [...s.children].forEach((c, k) => (c as HTMLElement).style.setProperty('--i', String(k)));
        deck.append(s);
    });

    deck.querySelectorAll<HTMLTextAreaElement>('textarea[id^="edit-"]').forEach((area) => {
        const id = area.id.slice(5);
        area.addEventListener('input', () => {
            edits.set(id, area.value);
            const check = checkFormula(area.value);
            $(`status-${id}`).textContent = check.ok ? '' : `${UI[lang].formulaError} ${check.error.message}`;
            if (check.ok && SLIDES[cur].id === id) el.formula = area.value;
        });
        area.addEventListener('keydown', (e) => e.stopPropagation()); // typing is not navigating
    });
    deck.querySelectorAll<HTMLButtonElement>('[data-audio]').forEach((b) => b.addEventListener('click', () => {
        const want = b.dataset.audio === 'mic' ? 'mic' : DEMO_TRACK;
        if (el.getAttribute('audio') === want) el.removeAttribute('audio');
        else el.setAttribute('audio', want);
        syncControls();
    }));
    deck.querySelectorAll<HTMLButtonElement>('[data-renderer]').forEach((b) => b.addEventListener('click', () => {
        if (b.dataset.renderer) el.setAttribute('renderer', b.dataset.renderer);
        else el.removeAttribute('renderer');
        syncControls();
    }));

    // chrome
    $('prev').setAttribute('aria-label', t.prev);
    $('next').setAttribute('aria-label', t.next);
    $('b-notes').firstChild!.textContent = `${t.notes} `;
    $('b-index').firstChild!.textContent = `${t.index} `;
    $('b-help').setAttribute('aria-label', t.help);
    $('b-lang').textContent = t.langCode;
    $('b-lang').setAttribute('aria-label', t.lang);
    $('notes-title').textContent = t.notesTitle;
    $('close-index').textContent = `${t.close} (Esc)`;
    $('help-title').textContent = t.help;
    $('help-list').innerHTML = ([
        ['→ · space', t.next_k], ['←', t.prev_k], ['Home · End', t.first_last], [`1–${SLIDES.length}`, t.goto],
        ['M', t.sound_k], ['N', t.notesTitle], ['G', t.index], ['L', t.lang], ['F', t.fullscreen], ['?', t.this_help], ['Esc', t.close_k],
    ] as const).map(([k, v]) => `<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join('');
    $('index-grid').innerHTML = SLIDES.map((s, i) => `<button type="button" class="thumb" data-go="${i}">`
        + `<small>${String(i + 1).padStart(2, '0')}</small><strong>${escape(s.text[lang].name)}</strong>`
        + `<code>${escape(firstLine(s))}</code></button>`).join('');
    $('index-grid').querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) => b.addEventListener('click', () => {
        toggle('index', false);
        go(Number(b.dataset.go));
    }));
    show(cur);
    syncControls();
}

function firstLine(s: Slide): string {
    const model = s.swarm.attributes.find(([n]) => n === 'model');
    if (model) return `model="${model[1].split('/').pop()}"`;
    return s.swarm.formula.split('\n').find((l) => l.trim() && !l.trim().startsWith('#'))?.trim() ?? '';
}

function syncControls(): void {
    const t = UI[lang];
    const audio = el.getAttribute('audio');
    deck.querySelectorAll<HTMLButtonElement>('[data-audio]').forEach((b) => {
        const mic = b.dataset.audio === 'mic';
        const on = mic ? audio === 'mic' : audio === DEMO_TRACK;
        b.textContent = mic ? (on ? t.micOff : t.mic) : (on ? t.pause : t.play);
        b.setAttribute('aria-pressed', String(on));
    });
    $('b-sound').setAttribute('aria-pressed', String(audio === DEMO_TRACK));
    const renderer = el.getAttribute('renderer') ?? '';
    deck.querySelectorAll<HTMLButtonElement>('[data-renderer]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.renderer === renderer)));
}

// ─── Navigation ──────────────────────────────────────────────────

function show(i: number): void {
    const sections = [...deck.children] as HTMLElement[];
    sections.forEach((s, k) => {
        const on = k === i;
        s.classList.toggle('on', on);
        s.setAttribute('aria-hidden', String(!on));
        s.inert = !on;
    });
    const slide = SLIDES[i];
    $('count').textContent = `${i + 1} / ${SLIDES.length}`;
    $('progress').style.width = `${((i + 1) / SLIDES.length) * 100}%`;
    $('notes-text').textContent = slide.text[lang].notes;
    document.title = `${slide.text[lang].name} · NanoSwarm`;
    $('index-grid').querySelectorAll('.thumb').forEach((b, k) => b.classList.toggle('cur', k === i));
}

function go(i: number): void {
    i = Math.max(0, Math.min(SLIDES.length - 1, i));
    if (i === cur) return;
    cur = i;
    applySwarm(SLIDES[i]);
    show(i);
    if (!reduceMotion.matches) {
        el.classList.remove('warp');
        void el.offsetWidth; // restart the animation
        el.classList.add('warp');
    }
    const hash = `#${i + 1}`;
    if (location.hash !== hash) history.replaceState(null, '', hash);
}

function fromHash(): number {
    const n = Number(location.hash.slice(1));
    return Number.isInteger(n) && n >= 1 && n <= SLIDES.length ? n - 1 : 0;
}

function setLang(next: Lang): void {
    lang = next;
    try { localStorage.setItem('nanoswarm-deck-lang', lang); } catch { /* fine */ }
    const url = new URL(location.href);
    url.searchParams.set('lang', lang);
    history.replaceState(null, '', url);
    render();
}

const panels = { notes: $('notes'), index: $('index'), help: $('help') };
function toggle(name: keyof typeof panels, force?: boolean): void {
    const panel = panels[name];
    const open = force ?? panel.hidden;
    panel.hidden = !open;
    if (name === 'notes') $('b-notes').setAttribute('aria-expanded', String(open));
    if (name === 'index' && open) (panel.querySelector('.thumb.cur') as HTMLElement | null)?.focus();
}

$('prev').addEventListener('click', () => go(cur - 1));
$('next').addEventListener('click', () => go(cur + 1));
$('b-notes').addEventListener('click', () => toggle('notes'));
$('b-index').addEventListener('click', () => toggle('index'));
$('b-help').addEventListener('click', () => toggle('help'));
$('b-lang').addEventListener('click', () => setLang(lang === 'en' ? 'es' : 'en'));
$('b-sound').addEventListener('click', toggleTrack);
$('close-index').addEventListener('click', () => toggle('index', false));
panels.help.addEventListener('click', () => toggle('help', false));

function toggleTrack(): void {
    if (el.getAttribute('audio') === DEMO_TRACK) el.removeAttribute('audio');
    else el.setAttribute('audio', DEMO_TRACK);
    syncControls();
}

addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === 'Escape') { toggle('index', false); toggle('help', false); toggle('notes', false); return; }
    if (!panels.index.hidden) return;
    if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') { e.preventDefault(); go(cur + 1); }
    else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); go(cur - 1); }
    else if (k === 'Home') go(0);
    else if (k === 'End') go(SLIDES.length - 1);
    else if (/^[1-9]$/.test(k) && Number(k) <= SLIDES.length) go(Number(k) - 1);
    else if (k === 'm' || k === 'M') toggleTrack();
    else if (k === 'n' || k === 'N') toggle('notes');
    else if (k === 'g' || k === 'G') toggle('index');
    else if (k === 'l' || k === 'L') setLang(lang === 'en' ? 'es' : 'en');
    else if (k === '?') toggle('help');
    else if (k === 'f' || k === 'F') {
        if (document.fullscreenElement) void document.exitFullscreen();
        else document.documentElement.requestFullscreen?.().catch(() => { /* not allowed here */ });
    }
});

let touchX: number | null = null;
let touchY = 0;
addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; }, { passive: true });
addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) && panels.index.hidden) go(cur + (dx < 0 ? 1 : -1));
    touchX = null;
}, { passive: true });

addEventListener('hashchange', () => go(fromHash()));

// start where the link points
cur = fromHash();
applySwarm(SLIDES[cur]);
render();
