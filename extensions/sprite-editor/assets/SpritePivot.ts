import { _decorator, Component, Sprite, SpriteFrame, UITransform } from 'cc';
import { EDITOR } from 'cc/env';

const { ccclass, disallowMultiple, executeInEditMode, menu, requireComponent } = _decorator;

/**
 * Unity-style pivot for UI Sprites.
 *
 * Keeps `UITransform.anchorPoint` equal to the pivot of the current SpriteFrame
 * (the Pivot you set in Sprite Editor), including while an animation swaps
 * frames, so every frame lines up on its pivot like in Unity.
 *
 * Not needed for SpriteRenderer (2D sprite in a 3D scene): it uses the pivot natively.
 */
@ccclass('SpritePivot')
@menu('SpriteSheet/SpritePivot')
@requireComponent(Sprite)
@disallowMultiple
@executeInEditMode
export class SpritePivot extends Component {
    private _sprite: Sprite | null = null;
    private _frame: SpriteFrame | null = null;
    private _pivotX = NaN;
    private _pivotY = NaN;

    onEnable() {
        this._sprite = this.getComponent(Sprite);
        this.node.on(Sprite.EventType.SPRITE_FRAME_CHANGED, this.apply, this);
        this.apply();
    }

    onDisable() {
        this.node.off(Sprite.EventType.SPRITE_FRAME_CHANGED, this.apply, this);
    }

    /** Copy the pivot of the current SpriteFrame to the anchor point. */
    apply() {
        const frame = this._sprite ? this._sprite.spriteFrame : null;
        this._frame = frame;
        if (!frame) return;
        const pivot = frame.pivot;
        this._pivotX = pivot.x;
        this._pivotY = pivot.y;
        const transform = this.node.getComponent(UITransform);
        if (transform && (transform.anchorX !== pivot.x || transform.anchorY !== pivot.y)) {
            transform.setAnchorPoint(pivot.x, pivot.y);
        }
    }

    lateUpdate() {
        // In the editor a SpriteFrame can be re-imported (pivot edited in Sprite
        // Editor) without the Sprite emitting an event, so poll there.
        if (!EDITOR || !this._sprite) return;
        const frame = this._sprite.spriteFrame;
        if (frame !== this._frame || (frame && (frame.pivot.x !== this._pivotX || frame.pivot.y !== this._pivotY))) {
            this.apply();
        }
    }
}
