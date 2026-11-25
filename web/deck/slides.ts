// The deck's content: one <nano-swarm> per slide, plus its text in English and Spanish.
// Pure data (no DOM), so tests can check every slide's element and both languages.
import { parseMarkup, type SwarmMarkup } from '../../src/element/markup';

export const LANGS = ['en', 'es'] as const;
export type Lang = (typeof LANGS)[number];

export interface SlideText {
    /** Short name, used in the index and the browser tab. */
    name: string;
    eyebrow: string;
    title: string;
    /** HTML: paragraphs, lists. Written here, never user input. */
    body: string;
    notes: string;
}

export interface Slide {
    id: string;
    /** The swarm behind the slide: an example file, or markup written here. */
    swarm: SwarmMarkup;
    /** Show the swarm's own formula on the slide (the code you see is what is drawn). */
    showFormula?: boolean;
    /** The slide lets you edit the formula live. */
    editable?: boolean;
    text: Record<Lang, SlideText>;
}

// Same loader as the playground and the tests: the deck reads the very same files.
const files = import.meta.glob('../../examples/*/*.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
export function example(name: string): SwarmMarkup {
    const entry = Object.entries(files).find(([path]) => path.endsWith(`/examples/${name}.html`));
    if (!entry) throw new Error(`[deck] No example called ${name}`);
    return parseMarkup(entry[1]);
}

const markup = (html: string) => parseMarkup(html);

/** Where the playground keeps its demo files, seen from deck/. */
export const DEMO_TRACK = '../audio/lofi-sample.mp3';
export const DEMO_MODEL = '../models/fox.glb';

export const SLIDES: Slide[] = [
    {
        id: 'what',
        swarm: example('shapes/galaxy'),
        text: {
            en: {
                name: 'What it is',
                eyebrow: 'Open source · TypeScript · MIT',
                title: 'NanoSwarm',
                body: '<p>Particle swarms shaped by <strong>formulas</strong>, <strong>3D models</strong> and <strong>sound</strong>, as <strong>one HTML element</strong>: <code>&lt;nano-swarm&gt;</code>.</p><p class="tag">Every background in this deck is a real &lt;nano-swarm&gt;. Most are the examples in the repository.</p>',
                notes: 'NanoSwarm is an open source TypeScript library, MIT licensed. Everything behind these slides is the library itself: one <nano-swarm> element whose formula and attributes change from slide to slide. This galaxy is examples/shapes/galaxy.html.',
            },
            es: {
                name: 'Qué es',
                eyebrow: 'Open source · TypeScript · MIT',
                title: 'NanoSwarm',
                body: '<p>Enjambres de partículas a partir de <strong>fórmulas</strong>, <strong>modelos 3D</strong> y <strong>sonido</strong>, en <strong>un solo elemento HTML</strong>: <code>&lt;nano-swarm&gt;</code>.</p><p class="tag">Todos los fondos de esta presentación son un &lt;nano-swarm&gt; de verdad. Casi todos son los ejemplos del repositorio.</p>',
                notes: 'NanoSwarm es una librería open source en TypeScript, con licencia MIT. Lo que hay detrás de las diapositivas es la propia librería: un único elemento <nano-swarm> cuya fórmula y atributos cambian de una diapositiva a otra. Esta galaxia es examples/shapes/galaxy.html.',
            },
        },
    },
    {
        id: 'idea',
        swarm: markup(`<nano-swarm title="Galaxy" colors="#ff3d00 #ff9100 #ffe57f" tilt="40">
  R = 4.5 * (v / TAU)^1.5
  a = 1.2*R - 0.2*t + floor(r*3) * TAU/3
  x = R * cos(a)
  y = 0.3 * sin(3*u)
  z = R * sin(a)
</nano-swarm>`),
        showFormula: true,
        text: {
            en: {
                name: 'The idea',
                eyebrow: 'The idea',
                title: 'The formula is the text. Everything else is an attribute.',
                body: '<p>One script, a height and one element. Change an attribute and the swarm follows: particles fly to the new shape.</p>',
                notes: 'The design rule is a single one: the formula is the element\'s text, everything else is an attribute. The code on this slide is exactly what is drawn behind it, the five-line galaxy from the README. The script includes three.js and picks the GPU or the CPU on its own.',
            },
            es: {
                name: 'La idea',
                eyebrow: 'La idea',
                title: 'La fórmula es el texto. Lo demás son atributos.',
                body: '<p>Un script, una altura y un elemento. Cambias un atributo y el enjambre lo sigue: las partículas vuelan a la nueva forma.</p>',
                notes: 'La regla de diseño es una sola: la fórmula es el texto del elemento y todo lo demás son atributos. El código de esta diapositiva es exactamente lo que se dibuja detrás, la galaxia de cinco líneas del README. El script ya incluye three.js y elige GPU o CPU solo.',
            },
        },
    },
    {
        id: 'shapes',
        swarm: markup(`<nano-swarm title="Breathing sphere" colors="#3d5afe #00b0ff #a7ffeb" bloom tilt="20">
  # A sphere that breathes with the music
  h = v / PI - 1
  ring = sqrt(1 - h*h)
  R = 3.5 + bass * 1.5 + 0.3 * sin(3*t)
  x = R * ring * cos(u)
  y = R * h
  z = R * ring * sin(u)
</nano-swarm>`),
        editable: true,
        text: {
            en: {
                name: 'Shapes',
                eyebrow: 'Formulas · shapes',
                title: 'Where each particle goes',
                body: '<p>Write <strong>x, y, z</strong>. Every particle brings its own <strong>u</strong> and <strong>v</strong> (0 → 2π) and a random <strong>r</strong>. Edit it: the swarm follows as you type.</p>',
                notes: 'First kind of formula: shapes. You write x, y, z and every particle brings its own u and v, spread from 0 to 2π, and a random r. t is time; bass, mid and treble are sound. This one is live: change a number and the particles fly to the new shape. Try 3.5 → 2, or cos(u) → cos(2*u).',
            },
            es: {
                name: 'Formas',
                eyebrow: 'Fórmulas · formas',
                title: 'Dónde va cada partícula',
                body: '<p>Escribes <strong>x, y, z</strong>. Cada partícula trae su <strong>u</strong> y su <strong>v</strong> (de 0 a 2π) y una <strong>r</strong> aleatoria. Edítala: el enjambre te sigue mientras escribes.</p>',
                notes: 'Primer tipo de fórmula: formas. Escribes x, y, z y cada partícula trae su u y su v, de 0 a 2π, y una r aleatoria. t es el tiempo; bass, mid y treble, el sonido. Esta está en directo: cambia un número y las partículas vuelan a la nueva forma. Prueba 3.5 → 2, o cos(u) → cos(2*u).',
            },
        },
    },
    {
        id: 'motions',
        swarm: example('attractors/lorenz'),
        showFormula: true,
        text: {
            en: {
                name: 'Motions',
                eyebrow: 'Formulas · motions',
                title: 'How a point moves',
                body: '<p>Write <strong>dx, dy, dz</strong> and particles travel along that field. That is exactly what a strange attractor is. No time step or scale to set: NanoSwarm traces the motion, measures it and frames it.</p>',
                notes: 'Second kind: motions. You write the velocity of a point and the particles keep travelling along it. There is no time step or scale: the library traces the motion once, measures where it lives and how fast it moves, and frames it. If it runs off to infinity or stops at a point, you get a message saying so. This is examples/attractors/lorenz.html.',
            },
            es: {
                name: 'Movimientos',
                eyebrow: 'Fórmulas · movimientos',
                title: 'Cómo se mueve un punto',
                body: '<p>Escribes <strong>dx, dy, dz</strong> y las partículas viajan por ese campo. Eso es justo un atractor extraño. Sin paso de tiempo ni escala que ajustar: NanoSwarm traza el movimiento, lo mide y lo encuadra.</p>',
                notes: 'Segundo tipo: movimientos. Escribes la velocidad de un punto y las partículas viajan por ella. No hay paso de tiempo ni escala: la librería traza el movimiento una vez, mide dónde vive y a qué velocidad, y lo encuadra. Si se escapa al infinito o se para, te lo dice. Es examples/attractors/lorenz.html.',
            },
        },
    },
    {
        id: 'sound',
        swarm: example('sound/equalizer'),
        showFormula: true,
        text: {
            en: {
                name: 'Sound',
                eyebrow: 'Inputs · sound',
                title: 'Particles that listen',
                body: '<p>With <strong>audio="song.mp3"</strong> or <strong>audio="mic"</strong>, the formula reads <code>bass</code>, <code>mid</code>, <code>treble</code>, <code>level</code> and <code>spectrum(k)</code>.</p>',
                notes: 'Sound comes into the formula as variables. This is examples/sound/equalizer.html, unchanged: 12 by 12 bars, frequency rising from one corner to the other. Play the track, or use your microphone and talk or clap. Browsers only start sound after a click.',
            },
            es: {
                name: 'Sonido',
                eyebrow: 'Entradas · sonido',
                title: 'Partículas que escuchan',
                body: '<p>Con <strong>audio="song.mp3"</strong> o <strong>audio="mic"</strong>, la fórmula lee <code>bass</code>, <code>mid</code>, <code>treble</code>, <code>level</code> y <code>spectrum(k)</code>.</p>',
                notes: 'El sonido entra en la fórmula como variables. Es examples/sound/equalizer.html, sin tocar: 12 por 12 barras y la frecuencia sube de una esquina a la otra. Pon la pista o usa el micrófono y habla o da palmas. Los navegadores solo arrancan el sonido tras un clic.',
            },
        },
    },
    {
        id: 'models',
        swarm: markup(`<nano-swarm title="Fox" model="${DEMO_MODEL}" animation="Run" colors="#ff6d00 #ffab40 #fff3e0" tilt="15"></nano-swarm>`),
        text: {
            en: {
                name: '3D models',
                eyebrow: 'Inputs · 3D models',
                title: 'A model, made of particles',
                body: '<p>With <strong>model="fox.glb"</strong> the swarm takes the shape of a GLB, GLTF, OBJ, STL or PLY model. <strong>If it is animated, it plays</strong> and the particles follow.</p><pre>&lt;nano-swarm model="fox.glb" animation="Run"&gt;&lt;/nano-swarm&gt;</pre><p class="tag">Fox: model by PixelMannen (CC0), rigging and animation by tomkranis, glTF by AsoboStudio and scurest. CC BY 4.0.</p>',
                notes: 'The other input is a 3D model instead of a formula. If it is animated, the library plays its animation in a loop and the particles follow; animation picks which one. This is the playground\'s fox running its Run animation. With solid, particles turn opaque and shaded and the model gains volume.',
            },
            es: {
                name: 'Modelos 3D',
                eyebrow: 'Entradas · modelos 3D',
                title: 'Un modelo, hecho enjambre',
                body: '<p>Con <strong>model="fox.glb"</strong> el enjambre toma la forma de un modelo GLB, GLTF, OBJ, STL o PLY. <strong>Si está animado, lo reproduce</strong> y las partículas lo siguen.</p><pre>&lt;nano-swarm model="fox.glb" animation="Run"&gt;&lt;/nano-swarm&gt;</pre><p class="tag">Zorro: modelo de PixelMannen (CC0), rig y animación de tomkranis, glTF de AsoboStudio y scurest. CC BY 4.0.</p>',
                notes: 'La otra entrada es un modelo 3D en lugar de una fórmula. Si está animado, la librería reproduce su animación en bucle y las partículas la siguen; animation elige cuál. Es el zorro del playground con su animación Run. Con solid las partículas se vuelven opacas y sombreadas y el modelo gana volumen.',
            },
        },
    },
    {
        id: 'inside',
        swarm: example('shapes/trefoil-knot'),
        text: {
            en: {
                name: 'Inside',
                eyebrow: 'Inside',
                title: 'One formula, two engines',
                body: '<p>The text <strong>never runs as written</strong>: it is parsed into a tree, and JavaScript for the CPU or GLSL for the GPU is generated from it. That is why a formula from a shared link is safe. This is the code generated for one line of the knot behind:</p>',
                notes: 'The code on this slide is generated live by the library from one line of the trefoil knot. In JavaScript every value is rounded to float32 with fr, so the CPU gives the same result as the GPU. Switch the renderer with the buttons: it is the same swarm, same physics. On the CPU the cap is 40,000 particles; at that cap a galaxy costs 7 ms per frame, an animated jellyfish 13 and a Lorenz attractor 3, measured on an i7-9750H.',
            },
            es: {
                name: 'Por dentro',
                eyebrow: 'Por dentro',
                title: 'Una fórmula, dos motores',
                body: '<p>El texto <strong>nunca se ejecuta tal cual</strong>: se parsea a un árbol y desde él se genera JavaScript para la CPU o GLSL para la GPU. Por eso una fórmula de un enlace compartido es segura. Este es el código generado para una línea del nudo de detrás:</p>',
                notes: 'El código de esta diapositiva lo genera la librería en directo a partir de una línea del nudo de trébol. En JavaScript cada valor se redondea a float32 con fr, para que la CPU dé lo mismo que la GPU. Cambia de motor con los botones: es el mismo enjambre y la misma física. En CPU el tope son 40.000 partículas; a ese tope una galaxia cuesta 7 ms por fotograma, una medusa animada 13 y un Lorenz 3, medido en un i7-9750H.',
            },
        },
    },
    {
        id: 'ai',
        swarm: example('shapes/jellyfish'),
        text: {
            en: {
                name: 'Made for AI',
                eyebrow: 'With AI assistants',
                title: 'It ships its own skill',
                body: '<ul><li>An <strong>Agent Skill</strong> for Claude Code and GitHub Copilot: it teaches the element and the formula language.</li><li><strong>check.mjs</strong>: a validator, so the assistant checks its work before showing it to you.</li><li><strong>llms.txt</strong> for any other assistant.</li><li>Both are <strong>generated from the code</strong>, and CI fails if they drift.</li></ul><pre>"make me a nano-swarm that looks like\n a jellyfish pulsing with the bass"</pre><p class="tag"><a href="../">Open the playground</a> · <a href="https://github.com/eladiomejutogracia/nanoswarm">GitHub</a></p>',
                notes: 'NanoSwarm ships an Agent Skill that works in Claude Code and GitHub Copilot, with a validator so the assistant checks its own work before showing it. llms.txt covers any other assistant. Both are generated from the code, so they never drift: CI fails if they are out of date. The jellyfish behind is examples/shapes/jellyfish.html.',
            },
            es: {
                name: 'Hecho para IA',
                eyebrow: 'Con asistentes de IA',
                title: 'Trae su propia skill',
                body: '<ul><li>Una <strong>Agent Skill</strong> para Claude Code y GitHub Copilot: enseña el elemento y el lenguaje de fórmulas.</li><li><strong>check.mjs</strong>: un validador, para que el asistente revise su trabajo antes de enseñártelo.</li><li><strong>llms.txt</strong> para cualquier otro asistente.</li><li>Ambos <strong>se generan desde el código</strong> y CI falla si se desfasan.</li></ul><pre>"hazme un nano-swarm que parezca una medusa\n latiendo con el bajo"</pre><p class="tag"><a href="../">Abrir el playground</a> · <a href="https://github.com/eladiomejutogracia/nanoswarm">GitHub</a></p>',
                notes: 'NanoSwarm trae una Agent Skill para Claude Code y GitHub Copilot, con un validador para que el asistente revise su trabajo antes de enseñártelo. llms.txt cubre cualquier otro asistente. Ambos se generan desde el código, así que no se desfasan: CI falla si están desactualizados. La medusa de fondo es examples/shapes/jellyfish.html.',
            },
        },
    },
];

/** The words around the slides. */
export const UI: Record<Lang, Record<string, string>> = {
    en: {
        prev: 'Previous slide', next: 'Next slide', notes: 'Notes', index: 'Index', help: 'Keyboard shortcuts',
        notesTitle: 'Speaker notes', close: 'Close', play: 'Play the track', pause: 'Stop the track', mic: 'Use the microphone',
        micOff: 'Stop the microphone', credit: 'Track: “Chill lofi inspired” by omfgdude (CC0).', engine: 'Engine',
        auto: 'Auto', next_k: 'Next', prev_k: 'Previous', first_last: 'First · last', goto: 'Go to that slide',
        sound_k: 'Track on / off', fullscreen: 'Full screen', this_help: 'This help', close_k: 'Close panels',
        formulaError: 'Not drawn yet:', lang: 'Español', langCode: 'ES', cpuCap: 'The CPU tops out at 40,000 particles.', oneLine: 'one line of the knot',
    },
    es: {
        prev: 'Diapositiva anterior', next: 'Diapositiva siguiente', notes: 'Notas', index: 'Índice', help: 'Atajos de teclado',
        notesTitle: 'Notas del presentador', close: 'Cerrar', play: 'Reproducir la pista', pause: 'Parar la pista', mic: 'Usar el micrófono',
        micOff: 'Parar el micrófono', credit: 'Pista: «Chill lofi inspired», de omfgdude (CC0).', engine: 'Motor',
        auto: 'Auto', next_k: 'Siguiente', prev_k: 'Anterior', first_last: 'Primera · última', goto: 'Ir a esa diapositiva',
        sound_k: 'Pista on / off', fullscreen: 'Pantalla completa', this_help: 'Esta ayuda', close_k: 'Cerrar paneles',
        formulaError: 'Aún no se dibuja:', lang: 'English', langCode: 'EN', cpuCap: 'La CPU llega como mucho a 40.000 partículas.', oneLine: 'una línea del nudo',
    },
};

/** One line of a formula, and the code the library generates for it. */
export const INSIDE_LINE = 'x';
