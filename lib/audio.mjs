import { join } from 'node:path';
import { run } from './core.mjs';
import { mediaProgress } from './progress.mjs';
import { safeWebcam } from './framing.mjs';
import { writeFile } from 'node:fs/promises';
import { EFFECTS, resolveSound } from './mood.mjs';
import { effectWave, backgroundWave, EFFECT_LENGTHS } from './sounds.mjs';

const bound = (value, fallback, max) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(max, Number(value))) : fallback;
export function mediaSettings(input = {}) {
  return { framing: ['auto','preserve','center','streamer'].includes(input.framing) ? input.framing : 'auto', webcam: safeWebcam(input.webcam), contentWidth: Math.max(.5,bound(input.contentWidth,.6,1)), normalize: input.normalize !== false, sourceVolume: bound(input.sourceVolume, 1, 2), background: ['auto','none','ambient','pulse','melancholy','playful','tension','custom'].includes(input.background) ? input.background : 'auto', musicVolume: bound(input.musicVolume, .18, .5), effects: input.effects === 'fahh' ? 'impact' : ['auto','custom',...EFFECTS].includes(input.effects) ? input.effects : 'auto', effectVolume:bound(input.effectVolume,.4,1), effectAt: bound(input.effectAt, .08, 90) };
}

// Compatibility for older clients; the noisy voice imitation was removed.
export const hookWave = () => effectWave('impact');

export async function probeSource(ffmpeg, source) {
  let info = '';
  await run(ffmpeg, ['-hide_banner','-i',source,'-t','0','-f','null','-'], { onLine: line => info += line + '\n' });
  const match=info.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return { hasAudio: /Stream .*Audio:/.test(info), duration: match ? Number(match[1])*3600+Number(match[2])*60+Number(match[3]) : null };
}

export async function prepareAudio({ ffmpeg, source, dir, clip, settings, hasAudio, customMusic, customEffect, onProgress = () => {} }) {
  settings = resolveSound(settings,clip);
  const duration = clip.end - clip.start, voice = `${clip.id}-voice.wav`, mixed = `${clip.id}-mix.wav`;
  const args = ['-y', ...(hasAudio ? ['-ss',String(clip.start),'-i',source] : ['-f','lavfi','-i','anullsrc=r=48000:cl=stereo']), '-t',String(duration),'-vn','-af',`${settings.normalize ? 'highpass=f=60,loudnorm=I=-16:TP=-1.5:LRA=11,' : ''}volume=${settings.sourceVolume}`, '-ar','48000','-ac','2','-c:a','pcm_s16le','-progress','pipe:1','-nostats',voice];
  await run(ffmpeg, args, { cwd: dir, onLine: mediaProgress(duration, p => onProgress({ ...p, percent: p.percent * .6, message: hasAudio ? 'Balancing original speech audio' : 'Source has no audio · preparing sound bed' })) });
  const inputs = ['-y','-i',voice], filters = [];
  let count = 1;
  if (settings.background !== 'none') {
    if (settings.background === 'custom') {
      if (!customMusic) throw new Error('Upload a background audio file, or choose a built-in sound bed.');
      inputs.push('-stream_loop','-1','-i',customMusic);
    } else {
      const bed=join(dir,clip.id+'-background.wav');await writeFile(bed,backgroundWave(settings.background));
      inputs.push('-stream_loop','-1','-i',bed);
    }
    filters.push(`[0:a]asplit=2[voice][key]`, `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${settings.musicVolume},afade=t=in:d=0.4,afade=t=out:st=${Math.max(0,duration-.8)}:d=0.8[music]`, '[music][key]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=500[bed]');
    count++;
  } else filters.push('[0:a]anull[voice]');
  if (settings.effects !== 'none') {
    let length;
    if(settings.effects==='custom'){if(!customEffect)throw new Error('Upload a hook sound effect first.');length=(await probeSource(ffmpeg,customEffect)).duration;inputs.push('-i',customEffect);}
    else {const path=join(dir,clip.id+'-effect.wav');await writeFile(path,effectWave(settings.effects));inputs.push('-i',path);length=EFFECT_LENGTHS[settings.effects];}
    filters.push(`[${count}:a]aformat=sample_rates=48000:channel_layouts=stereo,highpass=f=180,lowpass=f=10000,volume=${settings.effectVolume},afade=t=in:d=0.01,afade=t=out:st=${Math.max(0,length-.08)}:d=0.08,adelay=${Math.round(Math.min(duration-length,settings.effectAt)*1000)}|${Math.round(Math.min(duration-length,settings.effectAt)*1000)},apad,atrim=duration=${duration}[fx]`);
  }
  const mixInputs = '[voice]' + (count > 1 ? '[bed]' : '') + (settings.effects !== 'none' ? '[fx]' : '');
  const total = 1 + (count > 1 ? 1 : 0) + (settings.effects !== 'none' ? 1 : 0);
  filters.push(`${mixInputs}amix=inputs=${total}:duration=first:normalize=0,alimiter=limit=0.95:level=0[aout]`);
  await run(ffmpeg, [...inputs,'-filter_complex',filters.join(';'),'-map','[aout]','-t',String(duration),'-ar','48000','-ac','2','-c:a','pcm_s16le','-progress','pipe:1','-nostats',mixed], { cwd: dir, onLine: mediaProgress(duration,p => onProgress({ ...p, percent: 60 + p.percent * .4, message: 'Mixing speech, background and sound effects' })) });
  return { file: join(dir,mixed), hasSourceAudio: hasAudio, background: settings.background, effects: settings.effects, effectAt:settings.effectAt, mood:settings.suggestedMood, decision:settings.soundReason };
}
