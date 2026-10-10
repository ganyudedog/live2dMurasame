export const mixToMono = (channels: Float32Array[]): Float32Array => {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0].slice(0);

  const frameLength = channels[0]?.length ?? 0;
  const mixed = new Float32Array(frameLength);
  for (let i = 0; i < frameLength; i += 1) {
    let sum = 0;
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
      sum += channels[channelIndex]?.[i] ?? 0;
    }
    mixed[i] = sum / channels.length;
  }
  return mixed;
};

export const downsampleToTargetRate = (samples: Float32Array, sourceSampleRate: number, targetSampleRate: number): Float32Array => {
  if (!samples.length) return new Float32Array(0);
  if (!Number.isFinite(sourceSampleRate) || !Number.isFinite(targetSampleRate) || sourceSampleRate <= 0 || targetSampleRate <= 0) {
    return samples.slice(0);
  }
  if (sourceSampleRate <= targetSampleRate) {
    return samples.slice(0);
  }

  const ratio = sourceSampleRate / targetSampleRate;
  const outputLength = Math.max(1, Math.floor(samples.length / ratio));
  const output = new Float32Array(outputLength);

  let cursor = 0;
  let outputIndex = 0;
  while (outputIndex < output.length) {
    const leftIndex = Math.min(samples.length - 1, Math.floor(cursor));
    const rightIndex = Math.min(samples.length - 1, leftIndex + 1);
    const interpolation = cursor - leftIndex;
    const left = samples[leftIndex] ?? 0;
    const right = samples[rightIndex] ?? left;
    output[outputIndex] = left + (right - left) * interpolation;
    cursor += ratio;
    outputIndex += 1;
  }

  return output;
};


