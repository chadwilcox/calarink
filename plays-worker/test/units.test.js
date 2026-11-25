// node --test plays-worker/test/units.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { weekOf, contestWeek } from '../src/weeks.js';
import { checkMp4 } from '../src/mp4.js';

test('weeks start Monday, Eastern', () => {
  assert.equal(weekOf(new Date('2026-11-25T12:00Z')), '2026-11-23');
  assert.equal(weekOf(new Date('2026-11-30T04:59Z')), '2026-11-23'); // Sunday 11:59 PM EST
  assert.equal(weekOf(new Date('2026-11-30T05:00Z')), '2026-11-30');
  assert.equal(weekOf(new Date('2026-07-06T04:00Z')), '2026-07-06'); // daylight time
  assert.equal(weekOf(new Date('2027-01-01T12:00Z')), '2026-12-28');
});
test('weekend approvals wait for Monday', () => {
  assert.equal(contestWeek(new Date('2026-11-28T04:59Z')), '2026-11-23'); // Friday night
  assert.equal(contestWeek(new Date('2026-11-28T05:00Z')), '2026-11-30'); // Saturday
  assert.equal(contestWeek(new Date('2026-11-29T20:00Z')), '2026-11-30');
});

// A minimal MP4, to bend one thing at a time.
const u32 = n => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const str = s => [...s].map(c => c.charCodeAt(0));
const box = (t, ...b) => { const d = b.flat(); return [...u32(d.length + 8), ...str(t), ...d]; };
const hd = s => [...u32(0), ...u32(0), ...u32(0), ...u32(1000), ...u32(s * 1000)];
function mp4({ claim = 10, real = 10, codec = 'avc1', handler = 'vide', tracks = 1, sound = 0, soundCodec = 'mp4a', soundReal = 10 } = {}) {
  const aud = box('trak', box('mdia', box('mdhd', hd(claim)), box('hdlr', u32(0), u32(0), str('soun')),
    box('minf', box('stbl', box('stsd', u32(0), u32(1), box(soundCodec)), box('stts', u32(0), u32(1), u32(soundReal * 10), u32(100))))));
  const trak = box('trak', box('mdia', box('mdhd', hd(claim)), box('hdlr', u32(0), u32(0), str(handler)),
    box('minf', box('stbl', box('stsd', u32(0), u32(1), box(codec)), box('stts', u32(0), u32(1), u32(real * 10), u32(100))))));
  return new Uint8Array([...box('ftyp', str('isom')), ...box('moov', box('mvhd', hd(claim)), ...Array(tracks).fill(trak), ...Array(sound).fill(aud))]).buffer;
}
test('mp4 check', () => {
  assert.equal(checkMp4(mp4()), null);
  assert.equal(checkMp4(mp4({ claim: 15, real: 15 })), null);
  assert.match(checkMp4(mp4({ claim: 20, real: 20 })), /15 seconds/);
  assert.match(checkMp4(mp4({ claim: 5, real: 60 })), /15 seconds/); // header lies
  assert.match(checkMp4(mp4({ codec: 'hvc1' })), /H\.264/);
  assert.equal(checkMp4(mp4({ sound: 1 })), null);
  assert.match(checkMp4(mp4({ sound: 2 })), /one sound/);
  assert.match(checkMp4(mp4({ sound: 1, soundCodec: 'ac-3' })), /AAC/);
  assert.match(checkMp4(mp4({ sound: 1, soundReal: 60 })), /15 seconds/);
  assert.match(checkMp4(mp4({ tracks: 2 })), /one video/);
  assert.match(checkMp4(mp4({ tracks: 0, sound: 1 })), /one video/);
  assert.match(checkMp4(mp4({ handler: 'text' })), /not supported/);
  assert.match(checkMp4(mp4().slice(0, 90)), /damaged/);
  assert.ok(checkMp4(new TextEncoder().encode('<html>hello there</html>').buffer));
  assert.ok(checkMp4(new ArrayBuffer(0)));
});
