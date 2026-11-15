// Input: one place that knows what the keyboard and the mouse are doing this frame.
// Keys are polled (held state), edges (pressed this frame) are consumed by whoever asks
// first, and the mouse reports look deltas that the caller drains after it has read them.
const CODE_TO_ACTION = {
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  KeyR: 'reload',
  KeyE: 'use',
  KeyB: 'buy',
  KeyG: 'grenade',
  KeyQ: 'lastWeapon',
  KeyF: 'flashlight',
  Tab: 'scores',
  Space: 'jump',
  ShiftLeft: 'walk',
  ShiftRight: 'walk',
  ControlLeft: 'crouch',
  ControlRight: 'crouch',
  Digit1: 'slot1',
  Digit2: 'slot2',
  Digit3: 'slot3',
  Digit4: 'slot4',
};

export function createInput(canvas, onLockChange) {
  const held = new Set();
  const pressed = new Set();
  let lookX = 0;
  let lookY = 0;
  let firing = false;
  let locked = false;

  function actionFor(event) {
    // Number keys inside the buy menu are the menu's own: the menu reads them itself, so
    // input only reports the slot actions while the pointer is locked (in the round).
    const action = CODE_TO_ACTION[event.code];
    return action ?? null;
  }

  function onKeyDown(event) {
    const action = actionFor(event);
    if (!action) return;
    if (action === 'scores' || action === 'buy') event.preventDefault();
    if (!held.has(action)) pressed.add(action);
    held.add(action);
  }

  function onKeyUp(event) {
    const action = actionFor(event);
    if (action) held.delete(action);
  }

  function onMouseMove(event) {
    if (!locked) return;
    lookX += event.movementX;
    lookY += event.movementY;
  }

  function onMouseDown(event) {
    if (event.button === 0) firing = true;
  }

  function onMouseUp(event) {
    if (event.button === 0) firing = false;
  }

  function onLock() {
    locked = document.pointerLockElement === canvas;
    if (!locked) {
      held.clear();
      pressed.clear();
      firing = false;
    }
    if (onLockChange) onLockChange(locked);
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('blur', () => { held.clear(); firing = false; });
  document.addEventListener('pointerlockchange', onLock);

  return {
    requestLock() {
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
    },
    releaseLock() {
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    },
    isLocked() {
      return locked;
    },
    down(action) {
      return held.has(action);
    },
    take(action) {
      if (!pressed.has(action)) return false;
      pressed.delete(action);
      return true;
    },
    clearEdges() {
      pressed.clear();
    },
    drainLook() {
      const out = { x: lookX, y: lookY };
      lookX = 0;
      lookY = 0;
      return out;
    },
    isFiring() {
      return firing;
    },
  };
}