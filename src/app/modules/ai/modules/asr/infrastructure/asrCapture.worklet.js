class AsrCaptureProcessor extends AudioWorkletProcessor {
  constructor({ processorOptions }) {
    super();
    this.ratio = sampleRate / processorOptions.targetSampleRate;
    this.phase = 0;
    this.sum = 0;
    this.weight = 0;
    this.frame = new Float32Array(512);
    this.offset = 0;
  }

  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    const channels = inputs[0];
    if (!channels?.length) return true;
    // Preserve fractional resampling state across render quanta (e.g. 44.1 kHz).
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] / channels.length;
      let remaining = 1;
      while (remaining > 1e-8) {
        const take = Math.min(remaining, this.ratio - this.phase);
        this.sum += value * take;
        this.weight += take;
        this.phase += take;
        remaining -= take;
        if (this.phase >= this.ratio - 1e-8) {
          this.frame[this.offset++] = this.sum / this.weight;
          this.phase = 0;
          this.sum = 0;
          this.weight = 0;
          if (this.offset === this.frame.length) {
            this.port.postMessage(this.frame, [this.frame.buffer]);
            this.frame = new Float32Array(512);
            this.offset = 0;
          }
        }
      }
    }
    return true;
  }
}

registerProcessor('asr-capture', AsrCaptureProcessor);
