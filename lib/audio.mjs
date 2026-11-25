import { join } from 'node:path';
import { run } from './core.mjs';
import { mediaProgress } from './progress.mjs';
import { safeWebcam } from './framing.mjs';
import { writeFile } from 'node:fs/promises';
import { EFFECTS, resolveSound } from './mood.mjs';
import { effectWave, backgroundWave, EFFECT_LENGTHS, BACKGROUNDS } from './sounds.mjs';
import { CAPTION_STYLES } from './captions.mjs';

const bound = (value, fallback, max) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(max, Number(value))) : fallback;
export function mediaSettings(input = {}) {
  return { framing: ['auto','preserve','center','streamer'].includes(input.framing) ? input.framing : 'auto', webcam: safeWebcam(input.webcam), contentWidth: Math.max(.5,bound(input.contentWidth,.6,1)), normalize: input.normalize !== false, sourceVolume: bound(input.sourceVolume, 1, 2), background: ['auto','none',...BACKGROUNDS,'custom'].includes(input.background) ? input.background : 'auto', musicVolume: bound(input.musicVolume, .18, .5), effects: input.effects === 'fahh' ? 'impact' : ['auto','custom',...EFFECTS].includes(input.effects) ? input.effects : 'auto', effectVolume:bound(input.effectVolume,.4,1), effectAt: bound(input.effectAt, .08, 90), captionStyle:CAPTION_STYLES.includes(input.captionStyle)?input.captionStyle:'kinetic', soundSeed:Math.floor(bound(input.soundSeed,0,4294967295)) };
}

// Compatibility for older clients; the noisy voice imitation was removed.
export const hookWave = () => effectWave('impact');
export function musicEnvelope(level,energy,payoffAt,duration) {
  const at=Math.max(.4,Math.min(duration-.4,Number(payoffAt)||duration*.7));
  if(energy==='build')return `${level}*if(lt(t,${at}),0.4+0.6*t/${at},1)`;
  if(energy==='release')return `${level}*if(lt(t,${at}),1,0.4)`;
  if(energy==='punctuate')return `${level}*if(lt(t,${at}),0.7,if(lt(t,${at+.6}),1,0.25))`;
  return String(level*(energy==='gentle'?.75:1));
}

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
  const events=Array.isArray(settings.effectEvents)?settings.effectEvents.filter(event=>EFFECT_LENGTHS[event.effect]&&Number.isFinite(event.at)&&event.at>=0&&event.at<duration).slice(0,3):settings.effects!=='none'?[{effect:settings.effects,at:settings.effectAt}]:[];
  const keys=[...(settings.background!=='none'?['musicKey']:[]),...events.map((_,index)=>'fxKey'+index)];
  filters.push(keys.length?`[0:a]asplit=${keys.length+1}[voice]${keys.map(key=>'['+key+']').join('')}`:'[0:a]anull[voice]');
  let count = 1;
  if (settings.background !== 'none') {
    if (settings.background === 'custom') {
      if (!customMusic) throw new Error('Upload a background audio file, or choose a built-in sound bed.');
      inputs.push('-stream_loop','-1','-i',customMusic);
    } else {
      const bed=join(dir,clip.id+'-background.wav');await writeFile(bed,backgroundWave(settings.background,settings.soundSeed));
      inputs.push('-stream_loop','-1','-i',bed);
    }
    filters.push(`[1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume='${musicEnvelope(settings.musicVolume,settings.musicEnergy,settings.payoffAt,duration)}':eval=frame,afade=t=in:d=0.12,afade=t=out:st=${Math.max(0,duration-.8)}:d=0.8[music]`, '[musicKey]highpass=f=150,lowpass=f=3500[key]', '[music][key]sidechaincompress=threshold=0.02:ratio=8:attack=10:release=260[bed]');
    count++;
  }
  for (const [index,event] of events.entries()) {
    let length;
    if(event.effect==='custom'){if(!customEffect)throw new Error('Upload a hook sound effect first.');length=Math.min(3,(await probeSource(ffmpeg,customEffect)).duration||3);inputs.push('-i',customEffect);}
    else {const path=join(dir,`${clip.id}-effect-${index}.wav`);await writeFile(path,effectWave(event.effect));inputs.push('-i',path);length=EFFECT_LENGTHS[event.effect];}
    const delay=Math.round(Math.max(0,Math.min(duration-length,event.at))*1000),lowCut=event.effect==='bass_drop'?35:180;
    filters.push(`[${count}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=duration=${length},highpass=f=${lowCut},lowpass=f=10000,volume=${settings.effectVolume},afade=t=in:d=0.01,afade=t=out:st=${Math.max(0,length-.08)}:d=0.08,adelay=${delay}|${delay},apad,atrim=duration=${duration}[fxRaw${index}]`,`[fxKey${index}]highpass=f=150,lowpass=f=3500[fxDuck${index}]`,`[fxRaw${index}][fxDuck${index}]sidechaincompress=threshold=0.035:ratio=4:attack=5:release=100[fx${index}]`);
    count++;
  }
  const mixInputs = '[voice]' + (settings.background!=='none' ? '[bed]' : '') + events.map((_,index)=>`[fx${index}]`).join('');
  const total = 1 + (settings.background!=='none' ? 1 : 0) + events.length;
  filters.push(`${mixInputs}amix=inputs=${total}:duration=first:normalize=0,alimiter=limit=0.95:level=0[aout]`);
  await run(ffmpeg, [...inputs,'-filter_complex',filters.join(';'),'-map','[aout]','-t',String(duration),'-ar','48000','-ac','2','-c:a','pcm_s16le','-progress','pipe:1','-nostats',mixed], { cwd: dir, onLine: mediaProgress(duration,p => onProgress({ ...p, percent: 60 + p.percent * .4, message: 'Mixing speech, background and sound effects' })) });
  return { file: join(dir,mixed), hasSourceAudio: hasAudio, background: settings.background, soundSeed:settings.soundSeed, effects: settings.effects, effectAt:settings.effectAt, effectEvents:events,musicEnergy:settings.musicEnergy||'steady',payoffAt:settings.payoffAt,mood:settings.suggestedMood,decision:settings.soundReason };
}
