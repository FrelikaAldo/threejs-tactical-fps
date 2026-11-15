// Audio, synthesised: there are no sound files in this entry, so every gunshot, footstep, beep
// and sting is built from one noise buffer and a few oscillators. Positional sounds are panned
// and attenuated against the listener, which makes footsteps on the far side of a wall useful.
import { PALETTE } from './palette.js';

export function createAudio() {
  let context = null;
  let master = null;
  let noise = null;
  const listener = { x: 0, z: 0, yaw: 0 };

  function ensure() {
    if (context) return true;
    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctor) return false;
    context = new Ctor();
    master = context.createGain();
    master.gain.value = 0.32;
    master.connect(context.destination);

    const seconds = 1.2;
    const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    noise = buffer;
    return true;
  }

  function spatial(position) {
    if (!position) return { gain: 1, pan: 0 };
    const dx = position.x - listener.x;
    const dz = position.z - listener.z;
    const distance = Math.hypot(dx, dz);
    const gain = Math.max(0, 1 - distance / 46) ** 1.6;
    // pan by the angle between where the player looks and where the sound is
    const forwardX = -Math.sin(listener.yaw);
    const forwardZ = -Math.cos(listener.yaw);
    const rightX = Math.cos(listener.yaw);
    const rightZ = -Math.sin(listener.yaw);
    const pan = distance > 0.4 ? Math.max(-1, Math.min(1, (dx * rightX + dz * rightZ) / distance)) * 0.8 : 0;
    return { gain, pan };
  }

  function playNoise({ duration, filter, gain, pan, sweep }) {
    const source = context.createBufferSource();
    source.buffer = noise;
    const lowpass = context.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = filter;
    if (sweep) {
      lowpass.frequency.setValueAtTime(filter, context.currentTime);
      lowpass.frequency.exponentialRampToValueAtTime(Math.max(120, filter * 0.18), context.currentTime + duration);
    }
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(gain, context.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    const panner = context.createStereoPanner();
    panner.pan.value = pan;
    source.connect(lowpass).connect(envelope).connect(panner).connect(master);
    source.start();
    source.stop(context.currentTime + duration + 0.02);
  }

  function playTone({ frequency, duration, gain, type = 'sine', pan = 0, to }) {
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    if (to) oscillator.frequency.exponentialRampToValueAtTime(to, context.currentTime + duration);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(gain, context.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    const panner = context.createStereoPanner();
    panner.pan.value = pan;
    oscillator.connect(envelope).connect(panner).connect(master);
    oscillator.start();
    oscillator.stop(context.currentTime + duration + 0.02);
  }

  function play(name, options = {}) {
    if (!ensure()) return;
    if (context.state === 'suspended') context.resume();
    const { position, weapon = 'vk74', enemy = false } = options;
    const { gain, pan } = spatial(position);

    switch (name) {
      case 'shot': {
        if (gain < 0.02) return;
        const heavy = weapon === 'vk74' || weapon === 'kestrel';
        playNoise({ duration: heavy ? 0.17 : 0.11, filter: heavy ? 3200 : 4600, gain: gain * (heavy ? 0.95 : 0.6), pan, sweep: true });
        playTone({ frequency: heavy ? 128 : 190, duration: 0.09, gain: gain * 0.5, type: 'triangle', to: 48, pan });
        return;
      }
      case 'swing':
        playNoise({ duration: 0.16, filter: 900, gain: gain * 0.4, pan, sweep: true });
        return;
      case 'reload':
        playNoise({ duration: 0.05, filter: 2400, gain: gain * 0.5, pan });
        window.setTimeout(() => playNoise({ duration: 0.06, filter: 1700, gain: gain * 0.45, pan }), 190);
        return;
      case 'hit':
        playTone({ frequency: 1180, duration: 0.05, gain: 0.2, type: 'square', pan: 0 });
        return;
      case 'headshot':
        playTone({ frequency: 1720, duration: 0.09, gain: 0.24, type: 'triangle', to: 2300, pan: 0 });
        return;
      case 'hurt':
        playNoise({ duration: 0.22, filter: 620, gain: 0.5, pan: 0 });
        return;
      case 'footstep':
        if (gain < 0.05) return;
        playNoise({ duration: 0.07, filter: 480, gain: gain * 0.3, pan });
        return;
      case 'beep':
        playTone({ frequency: 1560, duration: 0.08, gain: 0.22, type: 'square' });
        return;
      case 'planted':
        playTone({ frequency: 320, duration: 0.5, gain: 0.3, type: 'sawtooth', to: 210 });
        return;
      case 'explosion':
        playNoise({ duration: 0.85, filter: 1400, gain: 0.95, pan: 0, sweep: true });
        playTone({ frequency: 92, duration: 0.6, gain: 0.7, type: 'sine', to: 28 });
        return;
      case 'freeze':
        playTone({ frequency: 520, duration: 0.16, gain: 0.16, type: 'sine' });
        return;
      case 'live':
        playTone({ frequency: 780, duration: 0.2, gain: 0.2, type: 'triangle', to: 1050 });
        return;
      case 'win':
        playTone({ frequency: 620, duration: 0.3, gain: 0.22, type: 'triangle', to: 930 });
        return;
      case 'lose':
        playTone({ frequency: 380, duration: 0.4, gain: 0.22, type: 'sine', to: 190 });
        return;
      default:
        playTone({ frequency: 440, duration: 0.1, gain: 0.15, type: 'sine' });
    }
  }

  return {
    play,
    setListener(position, yaw) {
      listener.x = position.x;
      listener.z = position.z;
      listener.yaw = yaw;
    },
    accent: PALETTE.teal,
  };
}