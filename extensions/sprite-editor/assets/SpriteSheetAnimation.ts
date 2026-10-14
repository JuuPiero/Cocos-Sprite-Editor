import { _decorator, CCFloat, Component, Enum, Sprite, SpriteAtlas, SpriteFrame, SpriteRenderer } from 'cc';
import { SpriteSheet } from './SpriteSheet';

const { ccclass, disallowMultiple, menu, property } = _decorator;

export enum SheetWrapMode {
    /** Repeat forever. */
    Loop = 0,
    /** Play once and hold the last frame. */
    Once = 1,
    /** Forward then backward, forever. */
    PingPong = 2,
}

/** One named frame sequence, e.g. "idle", "run". */
@ccclass('SpriteSheetClip')
export class SpriteSheetClip {
    @property({ tooltip: 'Tên clip, dùng với play(name).' })
    name = 'idle';

    @property({ type: [SpriteFrame], tooltip: 'Các frame theo thứ tự. Để trống thì lấy từ Atlas + Prefix.' })
    frames: SpriteFrame[] = [];

    @property({ type: SpriteAtlas, tooltip: 'Atlas (.plist do Sprite Editor tạo) dùng khi Frames trống.' })
    atlas: SpriteAtlas | null = null;

    @property({ tooltip: 'Lấy các frame "<Prefix><số>" trong Atlas, VD "hero_run" → hero_run_0, hero_run_1… Để trống = mọi frame.' })
    prefix = '';

    @property({ type: CCFloat, min: 0.01, tooltip: 'Số frame mỗi giây.' })
    fps = 12;

    @property({ type: Enum(SheetWrapMode) })
    wrapMode: SheetWrapMode = SheetWrapMode.Loop;

    /** Frames to play: explicit list, otherwise the atlas filtered by prefix. */
    resolveFrames(): SpriteFrame[] {
        if (this.frames.length) return this.frames.filter((f) => !!f);
        if (!this.atlas) return [];
        return this.prefix ? SpriteSheet.getFrames(this.atlas, this.prefix) : SpriteSheet.frames(this.atlas);
    }
}

/**
 * Plays frame-by-frame animations on a Sprite (UI) or SpriteRenderer (2D in 3D).
 *
 * Events (on the node): FINISHED when a Once clip ends, LOOP each time a looping
 * clip wraps, FRAME every time the displayed frame changes.
 */
@ccclass('SpriteSheetAnimation')
@menu('SpriteSheet/SpriteSheetAnimation')
@disallowMultiple
export class SpriteSheetAnimation extends Component {
    static readonly EventType = {
        FINISHED: 'sprite-sheet-finished',
        LOOP: 'sprite-sheet-loop',
        FRAME: 'sprite-sheet-frame',
    };

    @property({ type: [SpriteSheetClip] })
    clips: SpriteSheetClip[] = [];

    @property({ tooltip: 'Clip tự phát khi bắt đầu. Để trống = clip đầu tiên.' })
    defaultClip = '';

    @property
    playOnLoad = true;

    @property({ type: CCFloat, min: 0, tooltip: 'Hệ số tốc độ phát.' })
    speed = 1;

    private _target: Sprite | SpriteRenderer | null = null;
    private _clip: SpriteSheetClip | null = null;
    private _frames: SpriteFrame[] = [];
    private _time = 0;
    private _index = -1;
    private _cycle = 0;
    private _playing = false;

    get isPlaying(): boolean {
        return this._playing;
    }

    /** Name of the current clip ('' if none). */
    get currentClip(): string {
        return this._clip ? this._clip.name : '';
    }

    get frameIndex(): number {
        return this._index;
    }

    get frameCount(): number {
        return this._frames.length;
    }

    onLoad() {
        this._target = this.getComponent(Sprite) || this.getComponent(SpriteRenderer);
        if (!this._target) console.warn(`[SpriteSheetAnimation] ${this.node.name}: cần Sprite hoặc SpriteRenderer trên cùng node.`);
    }

    start() {
        if (!this.playOnLoad || this._clip) return;
        const name = this.defaultClip || (this.clips[0] ? this.clips[0].name : '');
        if (name) this.play(name);
    }

    getClip(name: string): SpriteSheetClip | null {
        return this.clips.find((c) => c.name === name) || null;
    }

    /** Add (or replace) a clip at runtime. */
    addClip(name: string, frames: SpriteFrame[], fps = 12, wrapMode = SheetWrapMode.Loop): SpriteSheetClip {
        let clip = this.getClip(name);
        if (!clip) {
            clip = new SpriteSheetClip();
            this.clips.push(clip);
        }
        clip.name = name;
        clip.frames = frames.slice();
        clip.fps = fps;
        clip.wrapMode = wrapMode;
        return clip;
    }

    /**
     * Play a clip from `startFrame`. Calling play() with the clip that is already
     * playing restarts it only when `restart` is true.
     */
    play(name: string, startFrame = 0, restart = false): boolean {
        const clip = this.getClip(name);
        if (!clip) {
            console.warn(`[SpriteSheetAnimation] ${this.node.name}: không có clip "${name}".`);
            return false;
        }
        if (clip === this._clip && this._playing && !restart) return true;
        this._clip = clip;
        this._frames = clip.resolveFrames();
        if (!this._frames.length) {
            console.warn(`[SpriteSheetAnimation] ${this.node.name}: clip "${name}" không có frame nào.`);
            this._playing = false;
            return false;
        }
        const start = Math.max(0, Math.min(this._frames.length - 1, Math.floor(startFrame)));
        this._time = start / clip.fps;
        this._cycle = 0;
        this._index = -1;
        this._playing = true;
        this._show(start);
        return true;
    }

    /** Stop and keep the current frame. */
    stop() {
        this._playing = false;
    }

    pause() {
        this._playing = false;
    }

    resume() {
        if (this._clip && this._frames.length) this._playing = true;
    }

    /** Jump to a frame of the current clip without changing the play state. */
    setFrame(index: number) {
        if (!this._clip || !this._frames.length) return;
        const i = Math.max(0, Math.min(this._frames.length - 1, Math.floor(index)));
        this._time = i / this._clip.fps;
        this._show(i);
    }

    update(dt: number) {
        const clip = this._clip;
        if (!this._playing || !clip) return;
        const n = this._frames.length;
        if (!n) return;
        this._time += dt * this.speed;
        const step = Math.floor(this._time * clip.fps);

        if (clip.wrapMode === SheetWrapMode.Once) {
            if (step >= n) {
                this._show(n - 1);
                this._playing = false;
                this.node.emit(SpriteSheetAnimation.EventType.FINISHED, this, clip.name);
                return;
            }
            this._show(step);
            return;
        }

        const period = clip.wrapMode === SheetWrapMode.PingPong ? Math.max(1, 2 * n - 2) : n;
        const cycle = Math.floor(step / period);
        if (cycle !== this._cycle) {
            this._cycle = cycle;
            this.node.emit(SpriteSheetAnimation.EventType.LOOP, this, clip.name);
        }
        const m = step % period;
        this._show(m < n ? m : period - m);
    }

    private _show(index: number) {
        if (index === this._index) return;
        this._index = index;
        if (this._target) this._target.spriteFrame = this._frames[index];
        this.node.emit(SpriteSheetAnimation.EventType.FRAME, this, index);
    }
}
