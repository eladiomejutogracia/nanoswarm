import { BandSmoother, rawBands, rawSpectrum, SILENCE, SPECTRUM_BINS, SpectrumSmoother, type AudioBands } from './bands';

const SILENT_SPECTRUM = new Float32Array(SPECTRUM_BINS);

/**
 *   'mic'                    microphone (asks for permission)
 *   'song.mp3' | File | Blob an audio file, played in a loop
 *   HTMLMediaElement         an <audio>/<video> you already control
 *   null                     no audio
 */
export type AudioSource = 'mic' | (string & {}) | File | Blob | HTMLMediaElement | null;

/** Owns the Web Audio graph for one swarm. */
export class AudioInput {
    private context: AudioContext | null = null;
    private analyser: AnalyserNode | null = null;
    private node: AudioNode | null = null;
    private stream: MediaStream | null = null;
    private ownedElement: HTMLAudioElement | null = null;
    private objectUrl: string | null = null;
    private freq = new Uint8Array(0);
    private readonly smoother = new BandSmoother();
    private readonly spectrumSmoother = new SpectrumSmoother();
    private readonly rawSpectrumBuffer = new Float32Array(SPECTRUM_BINS);
    private bandsNow: AudioBands = { ...SILENCE };
    private spectrumNow: Float32Array = SILENT_SPECTRUM;

    get bands(): AudioBands {
        return this.bandsNow;
    }

    /** Log-spaced spectrum, 0–1 per slice (bass → treble). Valid after update(). */
    get spectrum(): Float32Array {
        return this.spectrumNow;
    }

    /** The <audio> element NanoSwarm created for a file source (for play/pause UI). */
    get element(): HTMLAudioElement | null {
        return this.ownedElement;
    }

    set sensitivity(value: number) {
        this.smoother.sensitivity = value;
        this.spectrumSmoother.sensitivity = value;
    }

    async connect(source: AudioSource): Promise<void> {
        this.disconnect();
        if (source === null) return;

        const context = this.context ?? new AudioContext();
        this.context = context;
        if (context.state === 'suspended') await context.resume();

        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.6;

        if (source === 'mic') {
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.node = context.createMediaStreamSource(this.stream);
            this.node.connect(analyser); // not to destination: no feedback loop
        } else {
            const element = source instanceof HTMLMediaElement ? source : this.createElement(source);
            this.node = context.createMediaElementSource(element);
            this.node.connect(analyser);
            analyser.connect(context.destination);
            if (element === this.ownedElement) await element.play();
        }

        this.analyser = analyser;
        this.freq = new Uint8Array(analyser.frequencyBinCount);
        this.smoother.reset();
        this.spectrumSmoother.reset();
    }

    private createElement(source: string | Blob): HTMLAudioElement {
        const element = new Audio();
        element.crossOrigin = 'anonymous';
        element.loop = true;
        if (typeof source === 'string') {
            element.src = source;
        } else {
            this.objectUrl = URL.createObjectURL(source);
            element.src = this.objectUrl;
        }
        this.ownedElement = element;
        return element;
    }

    /** Read the current FFT frame. Call once per animation frame. */
    update(dt: number): AudioBands {
        if (!this.analyser || !this.context) {
            this.bandsNow = SILENCE;
            this.spectrumNow = SILENT_SPECTRUM;
            return this.bandsNow;
        }
        this.analyser.getByteFrequencyData(this.freq);
        const rate = this.context.sampleRate;
        this.bandsNow = this.smoother.update(rawBands(this.freq, rate), dt);
        this.spectrumNow = this.spectrumSmoother.update(rawSpectrum(this.freq, rate, this.rawSpectrumBuffer), dt);
        return this.bandsNow;
    }

    disconnect(): void {
        this.node?.disconnect();
        this.analyser?.disconnect();
        this.stream?.getTracks().forEach((track) => track.stop());
        if (this.ownedElement) {
            this.ownedElement.pause();
            this.ownedElement.removeAttribute('src');
            this.ownedElement.load();
        }
        if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
        this.node = null;
        this.analyser = null;
        this.stream = null;
        this.ownedElement = null;
        this.objectUrl = null;
        this.bandsNow = SILENCE;
        this.spectrumNow = SILENT_SPECTRUM;
    }

    dispose(): void {
        this.disconnect();
        void this.context?.close();
        this.context = null;
    }
}
