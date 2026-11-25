// Checks an uploaded file is what the upload page makes: a plain MP4 with one H.264 video track,
// at most one AAC sound track, and at most MAX_SECONDS long. The page does the trimming, but anyone can send the API a
// file directly, so nothing about it is taken on trust. Returns null if fine, else the reason.
export const MAX_SECONDS = 15;
const SLACK = 0.5; // a trim ends on a frame, not exactly on the second

function* boxes(v, start, end) {
  let p = start;
  while (p + 8 <= end) {
    let size = v.getUint32(p), head = 8;
    const type = String.fromCharCode(v.getUint8(p + 4), v.getUint8(p + 5), v.getUint8(p + 6), v.getUint8(p + 7));
    if (size === 1) { if (p + 16 > end) throw 0; size = Number(v.getBigUint64(p + 8)); head = 16; }
    else if (size === 0) size = end - p;
    if (size < head || p + size > end) throw 0;
    yield { type, start: p + head, end: p + size };
    p += size;
  }
}
const find = (v, box, ...path) => path.reduce((b, t) => {
  for (const x of boxes(v, b.start, b.end)) if (x.type === t) return x;
  throw 0;
}, box);
// mvhd and mdhd share this layout.
function lengthOf(v, b) {
  const v1 = v.getUint8(b.start) === 1;
  const scale = v.getUint32(b.start + (v1 ? 20 : 12));
  const ticks = v1 ? Number(v.getBigUint64(b.start + 24)) : v.getUint32(b.start + 16);
  if (!scale) throw 0;
  return { scale, seconds: ticks / scale };
}

// The same file's length in seconds, once it has passed checkMp4.
export function mp4Seconds(buffer) {
  const v = new DataView(buffer);
  return lengthOf(v, find(v, { start: 0, end: v.byteLength }, 'moov', 'mvhd')).seconds;
}

export function checkMp4(buffer) {
  try {
    const v = new DataView(buffer);
    const top = [...boxes(v, 0, v.byteLength)];
    if (top[0]?.type !== 'ftyp') return 'That is not an MP4 video';
    const moovs = top.filter(b => b.type === 'moov');
    if (moovs.length !== 1 || top.some(b => b.type === 'moof')) return 'That kind of MP4 is not supported';
    const moov = moovs[0];
    const kids = [...boxes(v, moov.start, moov.end)];
    const traks = kids.filter(b => b.type === 'trak');
    if (kids.some(b => b.type === 'mvex')) return 'That kind of MP4 is not supported';
    let longest = lengthOf(v, find(v, moov, 'mvhd')).seconds, video = 0, sound = 0;
    for (const trak of traks) {
      const mdia = find(v, trak, 'mdia');
      const kind = v.getUint32(find(v, mdia, 'hdlr').start + 8);
      const stbl = find(v, mdia, 'minf', 'stbl');
      const stsd = find(v, stbl, 'stsd');
      const codec = v.getUint32(stsd.start + 12), one = v.getUint32(stsd.start + 4) === 1;
      if (kind === 0x76696465) { // 'vide'
        video++;
        if (!one || ![0x61766331, 0x61766333].includes(codec)) return 'The video must be H.264'; // avc1, avc3
      } else if (kind === 0x736f756e) { // 'soun'
        sound++;
        if (!one || codec !== 0x6d703461) return 'The sound must be AAC'; // mp4a
      } else return 'That kind of MP4 is not supported';
      // The headers could claim anything; adding up the frames gives the real length.
      const media = lengthOf(v, find(v, mdia, 'mdhd'));
      const stts = find(v, stbl, 'stts');
      const n = v.getUint32(stts.start + 4);
      if (stts.start + 8 + n * 8 > stts.end) throw 0;
      let ticks = 0;
      for (let i = 0; i < n; i++) ticks += v.getUint32(stts.start + 8 + i * 8) * v.getUint32(stts.start + 12 + i * 8);
      const real = ticks / media.scale;
      longest = Math.max(longest, real, media.seconds);
      if (kind === 0x76696465 && real < 0.5) return 'That clip is too short';
    }
    if (video !== 1) return 'The clip must have one video track';
    if (sound > 1) return 'The clip can have only one sound track';
    if (longest > MAX_SECONDS + SLACK) return `Clips can be up to ${MAX_SECONDS} seconds`;
    return null;
  } catch {
    return 'That video file is damaged or not supported';
  }
}
