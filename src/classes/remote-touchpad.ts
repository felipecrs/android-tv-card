import { CSSResult, html, css } from 'lit';
import { customElement, property, queryAsync } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { Ripple } from '@material/mwc-ripple';
import { RippleHandlers } from '@material/mwc-ripple/ripple-handlers';

import { IActions, ActionType, DirectionAction } from '../models';

import { BaseRemoteElement } from './base-remote-element';

@customElement('remote-touchpad')
export class RemoteTouchpad extends BaseRemoteElement {
	// https://github.com/home-assistant/frontend/blob/80edeebab9e6dfcd13751b5ed8ff005452826118/src/components/ha-control-button.ts#L31-L77
	@queryAsync('mwc-ripple') private _ripple!: Promise<Ripple | null>;
	private _rippleHandlers: RippleHandlers = new RippleHandlers(() => {
		return this._ripple;
	});

	@property({ attribute: false }) directionActions!: Record<
		DirectionAction,
		IActions
	>;

	clickTimer?: ReturnType<typeof setTimeout>;
	clickCount: number = 0;

	holdTimer?: ReturnType<typeof setTimeout>;
	holdInterval?: ReturnType<typeof setInterval>;
	hold: boolean = false;
	holdStart: boolean = false;
	holdMove: boolean = false;
	holdAction?: DirectionAction;

	targetTouches?: TouchList;

	onClick(e: TouchEvent | MouseEvent) {
		e.stopImmediatePropagation();
		this.clickCount++;
		const doubleTapThreshold = this.targetTouches?.length || 1;

		if (
			('double_tap_action' in this.actions &&
				this.renderTemplate(
					this.actions.double_tap_action?.action as string,
				) != 'none') ||
			('multi_double_tap_action' in this.actions &&
				this.renderTemplate(
					this.actions.multi_double_tap_action?.action as string,
				) != 'none')
		) {
			// Double tap action is defined
			const doubleTapAction: ActionType = `${this.getMultiPrefix()}double_tap_action`;

			if (this.clickCount > doubleTapThreshold) {
				// Double tap action is triggered
				this.fireHapticEvent('success');
				this.sendAction(doubleTapAction);
				this.endAction();
			} else {
				// Single tap action is triggered if double tap is not within 200ms
				if (!this.clickTimer) {
					const doubleTapWindow: number =
						'double_tap_window' in
						(this.actions[doubleTapAction] ?? {})
							? (this.renderTemplate(
									this.actions[doubleTapAction]
										?.double_tap_window as unknown as string,
							  ) as number)
							: 200;
					this.clickTimer = setTimeout(() => {
						this.fireHapticEvent('light');
						this.sendAction(`${this.getMultiPrefix()}tap_action`);
						this.endAction();
					}, doubleTapWindow);
				}
			}
		} else {
			// No double tap action defined, tap action is triggered
			this.fireHapticEvent('light');
			this.sendAction(`${this.getMultiPrefix()}tap_action`);
			this.endAction();
		}
	}

	onStart(e: TouchEvent | MouseEvent) {
		this._rippleHandlers.startPress(e as unknown as Event);
		this.holdStart = true;

		if (
			!this.holdAction &&
			'momentary_start_action' in this.actions &&
			this.renderTemplate(
				this.actions.momentary_start_action?.action ?? 'none',
			) != 'none'
		) {
			this.fireHapticEvent('light');
			this.buttonPressStart = performance.now();
			this.sendAction('momentary_start_action');
		} else if (
			!this.holdAction &&
			'momentary_end_action' in this.actions &&
			this.renderTemplate(
				this.actions.momentary_end_action?.action ?? 'none',
			) != 'none'
		) {
			this.fireHapticEvent('light');
			this.buttonPressStart = performance.now();
		} else if (!this.holdTimer) {
			this.setHoldTimer();
		}

		if ('targetTouches' in e) {
			let totalX = 0;
			let totalY = 0;
			this.targetTouches = e.targetTouches;
			for (const touch of this.targetTouches) {
				totalX += touch.clientX;
				totalY += touch.clientY;
			}
			this.initialX = totalX / this.targetTouches.length;
			this.initialY = totalY / this.targetTouches.length;
		} else {
			this.initialX = e.clientX;
			this.initialY = e.clientY;
		}
	}

	onEnd(e: TouchEvent | MouseEvent) {
		this._rippleHandlers.endPress();

		if (
			!this.holdAction &&
			'momentary_end_action' in this.actions &&
			this.renderTemplate(
				this.actions.momentary_end_action?.action ?? 'none',
			) != 'none'
		) {
			this.buttonPressEnd = performance.now();
			this.fireHapticEvent('selection');
			this.sendAction('momentary_end_action');
			this.endAction();
		} else if (
			!this.holdAction &&
			'momentary_start_action' in this.actions &&
			this.renderTemplate(
				this.actions.momentary_start_action?.action ?? 'none',
			) != 'none'
		) {
			this.endAction();
		} else if (this.hold || this.holdMove) {
			e.stopImmediatePropagation();
			e.preventDefault();
			this.endAction();
			if ('targetTouches' in e && e.targetTouches.length) {
				this.hold = true;
			}
		} else if (!('targetTouches' in e) || !e.targetTouches.length) {
			this.onClick(e);
		}
	}

	onMove(e: TouchEvent | MouseEvent) {
		if (!this.initialX || !this.initialY || !this.holdStart) {
			return;
		}

		let currentX: number = 0;
		let currentY: number = 0;
		if ('targetTouches' in e) {
			this.targetTouches = e.targetTouches;
			for (const touch of this.targetTouches) {
				currentX += touch.clientX;
				currentY += touch.clientY;
			}
			currentX = currentX / this.targetTouches.length;
			currentY = currentY / this.targetTouches.length;
		} else {
			currentX = e.clientX || 0;
			currentY = e.clientY || 0;
		}

		const diffX = this.initialX - currentX;
		const diffY = this.initialY - currentY;

		// Only consider significant enough movement
		const sensitivity = 2;
		if (Math.abs(Math.abs(diffX) - Math.abs(diffY)) > sensitivity) {
			if (Math.abs(diffX) > Math.abs(diffY)) {
				// Sliding horizontally
				this.holdAction = diffX > 0 ? 'left' : 'right';
			} else {
				// Sliding vertically
				this.holdAction = diffY > 0 ? 'up' : 'down';
			}
			if (!this.holdMove) {
				this.fireHapticEvent('light');
				this.sendAction(
					`${this.getMultiPrefix()}tap_action`,
					this.getActions(),
				);
				this.holdMove = true;

				if (this.holdTimer) {
					clearTimeout(this.holdTimer);
					this.holdTimer = undefined;
					this.setHoldTimer();
				}
			}
		}
	}

	onMouseLeave(_e: MouseEvent) {
		this._rippleHandlers.endHover();
		this.endAction();
	}

	onTouchCancel(_e: TouchEvent) {
		this._rippleHandlers.endPress();
		this.endAction();
	}

	endAction() {
		clearTimeout(this.holdTimer as ReturnType<typeof setTimeout>);
		clearInterval(this.holdInterval as ReturnType<typeof setInterval>);
		clearTimeout(this.clickTimer as ReturnType<typeof setTimeout>);

		this.holdTimer = undefined;
		this.holdInterval = undefined;
		this.clickTimer = undefined;

		this.hold = false;
		this.holdStart = false;
		this.holdMove = false;
		this.holdAction = undefined;
		this.clickCount = 0;

		this.initialX = undefined;
		this.initialY = undefined;
		this.targetTouches = undefined;

		super.endAction();
	}

	getActions(): IActions {
		return this.holdAction
			? this.directionActions[this.holdAction]
			: this.actions;
	}

	getMultiPrefix(): 'multi_' | '' {
		return this.targetTouches && this.targetTouches.length > 1
			? 'multi_'
			: '';
	}

	setHoldTimer() {
		const holdAction = `${this.getMultiPrefix()}hold_action`;
		const actions = this.getActions();

		const holdTime =
			'hold_time' in (actions[holdAction as ActionType] ?? {})
				? (this.renderTemplate(
						actions[holdAction as ActionType]
							?.hold_time as unknown as string,
				  ) as number)
				: 500;

		this.holdTimer = setTimeout(() => {
			this.hold = true;

			const actions = this.getActions();

			const actionType = this.getMultiPrefix();

			let repeat =
				this.renderTemplate(actions.hold_action?.action as string) ==
				'repeat';
			let repeat_delay =
				'repeat_delay' in (actions.hold_action ?? {})
					? (this.renderTemplate(
							actions.hold_action
								?.repeat_delay as unknown as string,
					  ) as number)
					: 100;
			if (actionType == 'multi_' && 'multi_hold_action' in actions) {
				repeat =
					this.renderTemplate(
						actions.multi_hold_action?.action as string,
					) == 'repeat';
				repeat_delay =
					'repeat_delay' in (actions.multi_hold_action ?? {})
						? (this.renderTemplate(
								actions.multi_hold_action
									?.repeat_delay as unknown as string,
						  ) as number)
						: 100;
			}

			if (repeat) {
				if (!this.holdInterval) {
					this.holdInterval = setInterval(() => {
						this.fireHapticEvent('selection');
						this.sendAction(
							`${this.getMultiPrefix()}tap_action`,
							this.getActions(),
						);
					}, repeat_delay);
				}
			} else {
				this.fireHapticEvent('medium');
				this.sendAction(`${this.getMultiPrefix()}hold_action`, actions);
			}
		}, holdTime);
	}

	render() {
		return html`
			<toucharea
				style=${styleMap(this.buildStyle(this.actions.style ?? {}))}
				@mousedown=${this.onMouseDown}
				@mouseup=${this.onMouseUp}
				@mousemove=${this.onMouseMove}
				@mouseenter=${this._rippleHandlers.startHover}
				@mouseleave=${this.onMouseLeave}
				@touchstart=${this.onTouchStart}
				@touchend=${this.onTouchEnd}
				@touchmove=${this.onTouchMove}
				@touchcancel=${this.onTouchCancel}
				@focus=${this._rippleHandlers.startFocus}
				@blur=${this._rippleHandlers.endFocus}
				@contextmenu=${this.onContextMenu}
			>
				<mwc-ripple></mwc-ripple>
			</toucharea>
		`;
	}

	static get styles(): CSSResult | CSSResult[] {
		return [
			super.styles as CSSResult,
			css`
				:host {
					display: contents;
				}
				toucharea {
					border-radius: 32px;
					flex-grow: 1;
					height: 250px;
					width: -moz-available;
					width: -webkit-fill-available;
					width: fill-available;
					background: var(
						--primary-background-color,
						rgb(111, 118, 125)
					);
					touch-action: none;
					text-align: center;
					position: relative;
					z-index: 0;
					overflow: hidden;
					--mdc-ripple-press-opacity: 0.04;
				}
				mwc-ripple {
					top: unset;
					left: unset;
					height: inherit;
					width: inherit;
				}
			`,
		];
	}
}
