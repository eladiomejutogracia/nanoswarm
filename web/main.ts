import {
    ATTRIBUTE_NAMES,
    checkFormula,
    DEFAULT_VIEW,
    defineNanoSwarm,
    detectSourceKind,
    formatMarkup,
    FUNCTIONS,
    INPUTS,
    parseMarkup,
    readOptions,
    type AttributeName,
    type NanoSwarmElement,
    type SwarmMarkup,
} from '../src';
import { SCRIPT_URL } from '../src/ai/reference';
import { checkHtml } from '../src/element/check';
import { PALETTES } from './palettes';
import { decodeShare, encodeShare } from './share';

// ─── The element is the single source of truth ───────────────────
// Controls only edit #swarm's attributes or text. A MutationObserver on the
// element re-renders the panel and the code from what the element now says.

defineNanoSwarm();
const el = document.getElementById('swarm') as NanoSwarmElement;

// Served with the playground by GitHub Pages (always the latest main). Switch to the npm CDN once published.
const SCRIPT_TAG = `<script src="${SCRIPT_URL}"></script>`;
const DEMO_TRACK = 'audio/lofi-sample.mp3';
const PARTICLE_STEPS = [5_000, 10_000, 20_000, 30_000, 60_000, 120_000, 180_000, 260_000];
const FORMULA_DEBOUNCE_MS = 250;
const WIDE_SCREEN = 1200;
/** Your setup, not part of a creation: kept when you switch examples. */
const SESSION_ATTRIBUTES: AttributeName[] = ['audio', 'sensitivity', 'particles', 'renderer'];
const GROUPS = { sound: 'Sound', shapes: 'Shapes', attractors: 'Attractors' } as const;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
    topbar: document.querySelector<HTMLElement>('.topbar')!,
    themeToggle: $<HTMLButtonElement>('theme-toggle'),
    panel: $('panel'),
    panelToggle: $<HTMLButtonElement>('panel-toggle'),
    codePanel: $('code-panel'),
    codeToggle: $<HTMLButtonElement>('code-toggle'),
    code: $('code'),
    copyCode: $<HTMLButtonElement>('copy-code'),
    pasteCode: $<HTMLButtonElement>('paste-code'),
    pasteDialog: $<HTMLDialogElement>('paste-dialog'),
    pasteText: $<HTMLTextAreaElement>('paste-text'),
    pasteReport: $('paste-report'),
    pasteLoad: $<HTMLButtonElement>('paste-load'),
    examples: $('examples'),
    title: $<HTMLInputElement>('title'),
    formula: $<HTMLTextAreaElement>('formula'),
    formulaStatus: $('formula-status'),
    helpToggle: $<HTMLButtonElement>('help-toggle'),
    help: $('help'),
    helpShape: $('help-shape'),
    helpMotion: $('help-motion'),
    helpFunctions: $('help-functions'),
    modelInput: $<HTMLInputElement>('model-input'),
    palettes: $('palettes'),
    colors: [$<HTMLInputElement>('color-0'), $<HTMLInputElement>('color-1'), $<HTMLInputElement>('color-2')],
    background: $<HTMLInputElement>('background'),
    solid: $<HTMLInputElement>('solid'),
    bloom: $<HTMLInputElement>('bloom'),
    speed: $<HTMLInputElement>('speed'),
    speedOut: $<HTMLOutputElement>('speed-out'),
    tilt: $<HTMLInputElement>('tilt'),
    tiltOut: $<HTMLOutputElement>('tilt-out'),
    pointer: $<HTMLInputElement>('pointer'),
    rotate: $<HTMLInputElement>('rotate'),
    play: $<HTMLButtonElement>('play'),
    mic: $<HTMLButtonElement>('mic'),
    audioInput: $<HTMLInputElement>('audio-input'),
    track: $('track'),
    meters: { bass: $('m-bass'), mid: $('m-mid'), treble: $('m-treble'), level: $('m-level') },
    sensitivity: $<HTMLInputElement>('sensitivity'),
    sensitivityOut: $<HTMLOutputElement>('sensitivity-out'),
    particles: $<HTMLInputElement>('particles'),
    particlesOut: $<HTMLOutputElement>('particles-out'),
    rendererButtons: Array.from(document.querySelectorAll<HTMLButtonElement>('[data-renderer]')),
    info: $('info'),
    save: $<HTMLButtonElement>('save'),
    share: $<HTMLButtonElement>('share'),
    toast: $('toast'),
};

// ─── Reading and writing the element ─────────────────────────────

const attr = (name: AttributeName) => el.getAttribute(name);

function setAttr(name: AttributeName, value: string | null): void {
    if (value === null) el.removeAttribute(name);
    else el.setAttribute(name, value);
}

function readMarkup(): SwarmMarkup {
    return {
        attributes: ATTRIBUTE_NAMES.filter((name) => el.hasAttribute(name)).map((name) => [name, el.getAttribute(name)!]),
        formula: el.hasAttribute('model') ? '' : el.formula,
    };
}

/** Load a creation (an example or a shared link), keeping the session attributes it doesn't set. */
function applyMarkup(markup: SwarmMarkup): void {
    const incoming = new Set(markup.attributes.map(([name]) => name));
    for (const name of ATTRIBUTE_NAMES) {
        if (!incoming.has(name) && !SESSION_ATTRIBUTES.includes(name)) el.removeAttribute(name);
    }
    for (const [name, value] of markup.attributes) el.setAttribute(name, value);
    el.modelFile = null;
    el.formula = markup.formula;
    ui.formula.value = markup.formula;
    checkCurrentFormula();
}

// ─── Examples ────────────────────────────────────────────────────

const files = import.meta.glob('../examples/*/*.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const examples = Object.entries(files)
    .map(([path, html]) => ({ group: path.split('/').at(-2) as keyof typeof GROUPS, markup: parseMarkup(html) }))
    .sort((a, b) => Object.keys(GROUPS).indexOf(a.group) - Object.keys(GROUPS).indexOf(b.group));

const titleOf = (markup: SwarmMarkup) => markup.attributes.find(([name]) => name === 'title')?.[1] ?? 'Untitled';

function renderExampleButtons(): void {
    let group = '';
    for (const example of examples) {
        if (example.group !== group) {
            group = example.group;
            const label = document.createElement('p');
            label.className = 'group-label';
            label.textContent = GROUPS[example.group];
            ui.examples.append(label);
        }
        const button = document.createElement('button');
        button.textContent = titleOf(example.markup);
        button.addEventListener('click', () => applyMarkup(example.markup));
        ui.examples.append(button);
    }
}

// ─── Render: everything on screen comes from the element ─────────

function render(): void {
    const markup = readMarkup();
    ui.code.textContent = `${SCRIPT_TAG}\n\n${formatMarkup(markup)}`;

    const options = readOptions(attr);
    if (document.activeElement !== ui.title) ui.title.value = attr('title') ?? '';
    const model = attr('model');
    if (model && document.activeElement !== ui.formula) {
        ui.formula.value = `# Showing the model ${model}\n# Type a formula to go back.`;
    }

    // Examples: highlight the one whose formula is on screen.
    const buttons = ui.examples.querySelectorAll('button');
    examples.forEach((example, i) => buttons[i].classList.toggle('active', !model && example.markup.formula === el.formula));

    // Look
    options.look.colors.forEach((color, i) => (ui.colors[i].value = color));
    ui.background.value = options.look.background;
    ui.solid.checked = options.look.style === 'solid';
    ui.bloom.checked = options.look.bloom > 0;

    // Motion
    ui.speed.value = String(options.speed);
    ui.speedOut.textContent = `${options.speed}×`;
    const tilt = options.tilt ?? DEFAULT_VIEW.elevation;
    ui.tilt.value = String(tilt);
    ui.tiltOut.textContent = `${tilt}°`;
    ui.pointer.checked = options.interactive;
    ui.rotate.checked = options.autoRotate;

    // Sound & performance
    ui.sensitivity.value = String(options.sensitivity);
    ui.sensitivityOut.textContent = `${options.sensitivity}×`;
    for (const button of ui.rendererButtons) button.classList.toggle('active', button.dataset.renderer === options.backend);
    renderAudio();
    renderPerformance();
}

function renderAudio(): void {
    const audio = attr('audio');
    const element = el.swarm?.audioElement ?? null;
    const playing = element !== null && !element.paused;
    const isFile = audio !== null && audio !== 'mic';
    ui.play.textContent = playing ? '❚❚ Pause' : isFile ? '▶ Play' : '▶ Play demo track';
    ui.play.setAttribute('aria-pressed', String(playing));
    ui.mic.setAttribute('aria-pressed', String(audio === 'mic'));
    ui.track.textContent = audio === 'mic' ? 'Listening to the microphone'
        : isFile ? `${playing ? 'Playing' : 'Paused'}: ${audio}`
            : 'Shapes that read bass, mid, treble or spectrum(k) react to it.';
}

function renderPerformance(): void {
    const info = el.swarm?.info;
    if (!info) return;
    let nearest = 0;
    PARTICLE_STEPS.forEach((step, i) => {
        if (Math.abs(step - info.particles) < Math.abs(PARTICLE_STEPS[nearest] - info.particles)) nearest = i;
    });
    ui.particles.value = String(nearest);
    ui.particlesOut.textContent = info.particles.toLocaleString('en');
    const reduced = info.reduced ? ' · lowered for speed' : '';
    ui.info.textContent = `${info.backend.toUpperCase()} · ${info.fps} fps — ${info.reason}${reduced}`;
}

new MutationObserver(render).observe(el, { attributes: true, childList: true, characterData: true, subtree: true });

// ─── Feedback ────────────────────────────────────────────────────

let toastTimer = 0;
function toast(message: string, isError = false): void {
    ui.toast.textContent = message;
    ui.toast.classList.toggle('error', isError);
    ui.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (ui.toast.hidden = true), isError ? 6000 : 3500);
}

function setStatus(message: string, kind: 'ok' | 'error' | 'muted' = 'muted'): void {
    ui.formulaStatus.textContent = message;
    ui.formulaStatus.className = `status ${kind}`;
    ui.formula.classList.toggle('invalid', kind === 'error');
}

el.addEventListener('swarm-error', (event) => {
    const message = ((event as CustomEvent<Error>).detail?.message ?? 'Something went wrong').replace('[NanoSwarm] ', '');
    setStatus(message, 'error');
    toast(message, true);
});

// ─── Formula & model ─────────────────────────────────────────────

/** Validate what's in the editor; describe it in the status line. Returns the text if it is valid. */
function checkCurrentFormula(): string | null {
    const text = ui.formula.value;
    const result = checkFormula(text);
    if (!result.ok) {
        setStatus(result.error.message, 'error');
        return null;
    }
    const { kind, usesTime, usesAudio, hasColor } = result.formula.program;
    const traits = [usesTime && 'time', usesAudio && 'sound'].filter(Boolean).join(' + ');
    const what = kind === 'motion' ? 'Motion — particles travel along it' : 'Shape';
    setStatus(`✓ ${what}${traits ? `, reacts to ${traits}` : ''}${hasColor ? ', sets its own colors' : ''}`, 'ok');
    return text;
}

let formulaTimer = 0;
function onFormulaInput(): void {
    clearTimeout(formulaTimer);
    formulaTimer = window.setTimeout(() => {
        const text = checkCurrentFormula();
        if (text === null) return; // keep the last valid shape on screen
        if (el.hasAttribute('model')) {
            el.modelFile = null;
            el.removeAttribute('model');
        }
        el.formula = text;
    }, FORMULA_DEBOUNCE_MS);
}

function loadModel(file: File): void {
    el.modelFile = file;
    el.formula = '';
    setAttr('title', file.name.replace(/\.[^.]+$/, '')); // the previous creation's name no longer fits
    setAttr('model', file.name);
    setStatus(`✓ Model: ${file.name}`, 'ok');
    if (!el.hasAttribute('solid')) toast('Tip: tick Solid to give models more volume');
}

// ─── Sound ───────────────────────────────────────────────────────

function listensToSound(): boolean {
    if (el.hasAttribute('model')) return false;
    const result = checkFormula(el.formula);
    return result.ok && result.formula.program.usesAudio;
}

function startAudio(value: string, file: File | null = null): void {
    el.audioFile = file;
    setAttr('audio', value);
    if (!listensToSound()) toast('This formula ignores sound — try an example from the Sound group');
}

function onPlayClick(): void {
    const element = el.swarm?.audioElement;
    const audio = attr('audio');
    if (element && audio && audio !== 'mic') {
        if (element.paused) void element.play();
        else element.pause();
        setTimeout(renderAudio, 50);
        return;
    }
    startAudio(DEMO_TRACK);
}

// ─── Save & share ────────────────────────────────────────────────

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function savePage(): void {
    const markup = readMarkup();
    const title = attr('title') || 'NanoSwarm';
    const background = readOptions(attr).look.background;
    const page = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  ${SCRIPT_TAG}
  <style>body { margin: 0; background: ${background} } nano-swarm { height: 100vh }</style>
</head>
<body>
${formatMarkup(markup)}
</body>
</html>
`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([page], { type: 'text/html' }));
    link.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'nano-swarm'}.html`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast(el.hasAttribute('model') ? 'Saved — put the model file next to the page' : 'Saved');
}

async function copyLink(): Promise<void> {
    history.replaceState(null, '', `#${encodeShare(readMarkup())}`);
    try {
        await navigator.clipboard.writeText(location.href);
        toast(el.hasAttribute('model') ? 'Link copied (the model file itself is not included)' : 'Link copied');
    } catch {
        toast('Copy the link from the address bar');
    }
}

// ─── Paste HTML ──────────────────────────────────────────────────

/** Check the pasted HTML as you type; only a valid element can be loaded. */
function reviewPaste(): void {
    const text = ui.pasteText.value;
    ui.pasteReport.replaceChildren();
    if (!text.trim()) {
        ui.pasteLoad.disabled = true;
        return;
    }
    const result = checkHtml(text);
    const line = (kind: string, message: string) => {
        const item = document.createElement('li');
        item.className = kind;
        item.textContent = message;
        ui.pasteReport.append(item);
    };
    if (result.ok) line('ok', `✓ ${result.title ?? 'Untitled'} — ${result.summary.join(', ')}`);
    for (const error of result.errors) line('error', `✗ ${error}`);
    for (const warning of result.warnings) line('warning', `! ${warning}`);
    ui.pasteLoad.disabled = !result.ok;
}

function loadPaste(): void {
    applyMarkup(parseMarkup(ui.pasteText.value));
    ui.pasteText.value = '';
    reviewPaste();
    toast('Loaded');
}

// ─── Layout ──────────────────────────────────────────────────────

const isOpen = (panel: HTMLElement) => !panel.classList.contains('hidden');

/** Center the swarm in the space the top bar and the open panels leave free (layout offsets, not mid-animation rects). */
function centerInFreeSpace(): void {
    const swarm = el.swarm;
    if (!swarm) return;
    const top = ui.topbar.offsetHeight;
    if (window.innerWidth <= 640) {
        const sheet = [ui.panel, ui.codePanel].find(isOpen);
        const bottom = sheet ? sheet.offsetTop : window.innerHeight;
        swarm.setCenterOffset(0, (top + bottom - window.innerHeight) / 2);
        return;
    }
    const left = isOpen(ui.panel) ? ui.panel.offsetLeft + ui.panel.offsetWidth : 0;
    const right = isOpen(ui.codePanel) ? ui.codePanel.offsetLeft : window.innerWidth;
    swarm.setCenterOffset((left + right - window.innerWidth) / 2, top / 2);
}

// ─── Theme: follows the system until you pick one ────────────────
// The theme styles the playground only; a creation keeps its own `background`.

const THEME_KEY = 'nanoswarm-theme';
const systemLight = window.matchMedia('(prefers-color-scheme: light)');
const currentTheme = () => document.documentElement.dataset.theme ?? (systemLight.matches ? 'light' : 'dark');

function renderThemeToggle(): void {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    ui.themeToggle.textContent = next === 'light' ? 'Light' : 'Dark';
    ui.themeToggle.setAttribute('aria-label', `Switch to the ${next} theme`);
}

function toggleTheme(): void {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
        localStorage.setItem(THEME_KEY, next);
    } catch {
        // storage blocked: the choice lasts until the page closes
    }
    renderThemeToggle();
}

function togglePanel(panel: HTMLElement, button: HTMLButtonElement, open: boolean, labels: [string, string]): void {
    panel.classList.toggle('hidden', !open);
    button.textContent = open ? labels[1] : labels[0];
    button.setAttribute('aria-expanded', String(open));
    if (open && window.innerWidth <= 640) { // phones: one sheet at a time
        const other = panel === ui.panel ? ui.codePanel : ui.panel;
        if (isOpen(other)) (other === ui.panel ? ui.panelToggle : ui.codeToggle).click();
    }
    centerInFreeSpace();
}

// Top-bar toggles keep one label; aria-expanded (shown as brightness) says whether the panel is open.
const PANEL_LABELS: [string, string] = ['Controls', 'Controls'];
const CODE_LABELS: [string, string] = ['</> Code', '</> Code'];

// ─── Static parts of the panel ───────────────────────────────────

function renderHelp(): void {
    for (const [list, inputs] of [[ui.helpShape, INPUTS.shape], [ui.helpMotion, INPUTS.motion]] as const) {
        // Merge rows that say the same thing ("x, y, z — where the point is now").
        const rows: [string[], string][] = [];
        for (const [name, description] of Object.entries(inputs)) {
            const last = rows.at(-1);
            if (last && last[1] === description) last[0].push(name);
            else rows.push([[name], description]);
        }
        for (const [names, description] of rows) {
            const dt = document.createElement('dt');
            dt.textContent = names.join(', ');
            const dd = document.createElement('dd');
            dd.textContent = description;
            list.append(dt, dd);
        }
    }
    const math = Object.keys(FUNCTIONS).filter((fn) => fn !== 'noise' && fn !== 'spectrum');
    ui.helpFunctions.innerHTML = `Plus the usual math: ${math.map((fn) => `<code>${fn}</code>`).join(' ')}`;
}

function renderPaletteButtons(): void {
    for (const palette of PALETTES) {
        const button = document.createElement('button');
        button.title = palette.name;
        button.setAttribute('aria-label', `${palette.name} colors`);
        const [a, b, c] = palette.colors.split(' ');
        button.style.background = `linear-gradient(90deg, ${a} 0 33.3%, ${b} 33.3% 66.7%, ${c} 66.7%)`; // three bands, not a blend
        button.addEventListener('click', () => {
            setAttr('colors', palette.colors);
            setAttr('background', palette.background);
        });
        ui.palettes.append(button);
    }
}

// ─── Wiring ──────────────────────────────────────────────────────

function wire(): void {
    ui.title.addEventListener('input', () => setAttr('title', ui.title.value.trim() || null));
    ui.formula.addEventListener('input', onFormulaInput);
    ui.helpToggle.addEventListener('click', () => {
        ui.help.hidden = !ui.help.hidden;
        ui.helpToggle.setAttribute('aria-expanded', String(!ui.help.hidden));
    });
    ui.modelInput.addEventListener('change', () => {
        const file = ui.modelInput.files?.[0];
        if (file) loadModel(file);
        ui.modelInput.value = '';
    });

    const writeColors = () => setAttr('colors', ui.colors.map((input) => input.value).join(' '));
    for (const input of ui.colors) input.addEventListener('input', writeColors);
    ui.background.addEventListener('input', () => setAttr('background', ui.background.value));
    ui.solid.addEventListener('change', () => setAttr('solid', ui.solid.checked ? '' : null));
    ui.bloom.addEventListener('change', () => setAttr('bloom', ui.bloom.checked ? '' : null));

    ui.speed.addEventListener('input', () => setAttr('speed', ui.speed.value === '1' ? null : ui.speed.value));
    ui.tilt.addEventListener('change', () => setAttr('tilt', ui.tilt.value));
    ui.tilt.addEventListener('input', () => (ui.tiltOut.textContent = `${ui.tilt.value}°`));
    ui.pointer.addEventListener('change', () => setAttr('no-pointer', ui.pointer.checked ? null : ''));
    ui.rotate.addEventListener('change', () => setAttr('no-rotate', ui.rotate.checked ? null : ''));

    ui.play.addEventListener('click', onPlayClick);
    ui.mic.addEventListener('click', () => (attr('audio') === 'mic' ? setAttr('audio', null) : startAudio('mic')));
    ui.audioInput.addEventListener('change', () => {
        const file = ui.audioInput.files?.[0];
        if (file) startAudio(file.name, file);
        ui.audioInput.value = '';
    });
    ui.sensitivity.addEventListener('change', () => setAttr('sensitivity', ui.sensitivity.value === '1' ? null : ui.sensitivity.value));

    ui.particles.max = String(PARTICLE_STEPS.length - 1);
    ui.particles.addEventListener('change', () => setAttr('particles', String(PARTICLE_STEPS[Number(ui.particles.value)])));
    for (const button of ui.rendererButtons) {
        button.addEventListener('click', () => setAttr('renderer', button.dataset.renderer === 'auto' ? null : button.dataset.renderer!));
    }

    ui.save.addEventListener('click', savePage);
    ui.share.addEventListener('click', () => void copyLink());
    ui.pasteCode.addEventListener('click', () => {
        ui.pasteDialog.showModal();
        ui.pasteText.focus();
    });
    ui.pasteText.addEventListener('input', reviewPaste);
    ui.pasteDialog.addEventListener('close', () => {
        if (ui.pasteDialog.returnValue === 'load' && !ui.pasteLoad.disabled) loadPaste();
    });
    ui.copyCode.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(ui.code.textContent ?? '');
            toast('Code copied — paste it into any HTML page');
        } catch {
            toast('Select the code and copy it by hand');
        }
    });

    ui.themeToggle.addEventListener('click', toggleTheme);
    systemLight.addEventListener('change', renderThemeToggle);
    ui.panelToggle.addEventListener('click', () => togglePanel(ui.panel, ui.panelToggle, !isOpen(ui.panel), PANEL_LABELS));
    ui.codeToggle.addEventListener('click', () => togglePanel(ui.codePanel, ui.codeToggle, !isOpen(ui.codePanel), CODE_LABELS));
    window.addEventListener('resize', centerInFreeSpace);

    // Space toggles play/pause when not typing.
    window.addEventListener('keydown', (event) => {
        const target = event.target;
        const typing = target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;
        if (event.code === 'Space' && !typing && !(target instanceof HTMLButtonElement)) {
            event.preventDefault();
            onPlayClick();
        }
    });

    // Drop a model or a song anywhere on the page.
    window.addEventListener('dragover', (event) => {
        event.preventDefault();
        document.body.classList.add('dragging');
    });
    window.addEventListener('dragleave', (event) => {
        if (event.relatedTarget === null) document.body.classList.remove('dragging');
    });
    window.addEventListener('drop', (event) => {
        event.preventDefault();
        document.body.classList.remove('dragging');
        const file = event.dataTransfer?.files[0];
        if (!file) return;
        const kind = detectSourceKind(file);
        if (kind === 'audio') startAudio(file.name, file);
        else if (kind === 'model') loadModel(file);
        else toast(`Can't use "${file.name}" — drop a 3D model or an audio file`, true);
    });
}

const METER_SEGMENTS = 8; // matches the 12.5% segments in style.css

function animateMeters(): void {
    const bands = el.swarm?.bands;
    if (bands) {
        for (const band of ['bass', 'mid', 'treble', 'level'] as const) {
            const lit = Math.round(Math.min(bands[band], 1) * METER_SEGMENTS) / METER_SEGMENTS; // whole segments only
            ui.meters[band].style.setProperty('--level', String(lit));
        }
    }
    requestAnimationFrame(animateMeters);
}

// ─── Start ───────────────────────────────────────────────────────

renderExampleButtons();
renderPaletteButtons();
renderHelp();
renderThemeToggle();
wire();
const FIRST_EXAMPLE = 'Lorenz'; // shows the newest idea first: a formula that moves
applyMarkup(decodeShare(location.hash) ?? (examples.find((e) => titleOf(e.markup) === FIRST_EXAMPLE) ?? examples[0]).markup);
togglePanel(ui.codePanel, ui.codeToggle, window.innerWidth >= WIDE_SCREEN, CODE_LABELS);
render();
setInterval(() => {
    renderAudio();
    renderPerformance();
}, 500);
animateMeters();
